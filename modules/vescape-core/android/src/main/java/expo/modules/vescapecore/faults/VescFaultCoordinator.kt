package expo.modules.vescapecore.faults

import android.content.Context
import expo.modules.vescapecore.telemetry.TelemetryDatabase
import expo.modules.vescapecore.telemetry.VescFaultOccurrenceEntity
import java.util.UUID

/**
 * Where a VESC Fault Occurrence came from.
 *
 * - [LIVE]: Refloat `ALLDATA` fault mode observed during a Board Session. Occurrence time is known.
 * - [REGISTER]: reconciled from the controller's retained `faults` register (#432). Occurrence time
 *   is unknown; only discovery time is.
 * - [BASELINE]: register content already present when the Board was linked. Kept as evidence, never
 *   drives the Board health indicator.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `VescFaultSource`
 * @parity /modules/vescape-core/src/index.ts `VescFaultSource`
 */
enum class VescFaultSource(val wire: String) {
  LIVE("live"),
  REGISTER("register"),
  BASELINE("baseline");

  companion object {
    fun fromWire(value: String): VescFaultSource = entries.firstOrNull { it.wire == value } ?: LIVE
  }
}

/**
 * One VESC Fault Occurrence as it crosses the bridge and lives in the durable store.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `VescFaultOccurrence`
 * @parity /modules/vescape-core/src/index.ts `VescFaultOccurrence`
 */
data class VescFaultOccurrence(
  val id: String,
  val boardId: String,
  val code: Int,
  val source: VescFaultSource,
  val occurredAtMs: Long?,
  val discoveredAtMs: Long,
  val lastObservedAtMs: Long,
  val clearedAtMs: Long?,
  val registerPosition: Int?,
  val dismissed: Boolean,
  /** Register snapshot this occurrence's controller context came from (#432), when any. */
  val registerSnapshotId: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "boardId" to boardId,
    "code" to code,
    "source" to source.wire,
    "occurredAtMs" to occurredAtMs,
    "discoveredAtMs" to discoveredAtMs,
    "lastObservedAtMs" to lastObservedAtMs,
    "clearedAtMs" to clearedAtMs,
    "registerPosition" to registerPosition,
    "dismissed" to dismissed,
    "registerSnapshotId" to registerSnapshotId,
  )
}

/**
 * Narrow durable persistence for VESC Fault Occurrences. Production delegates to the Room DAO; tests
 * supply an in-memory fake so the transition rules are exercised without a database or BLE.
 */
interface VescFaultStore {
  suspend fun getForBoard(boardId: String): List<VescFaultOccurrence>
  suspend fun getAll(): List<VescFaultOccurrence>
  /** Newest still-open live occurrence for a Board, used to rehydrate state after a restart. */
  suspend fun openLive(boardId: String): VescFaultOccurrence?
  suspend fun upsert(occurrence: VescFaultOccurrence)
  suspend fun setDismissed(id: String, dismissed: Boolean): Boolean
}

/** Result of folding one register entry into occurrence storage. */
enum class VescFaultRegisterOutcome { ENRICHED, CREATED, SKIPPED }

/**
 * Deterministic owner of VESC Fault Occurrence transitions.
 *
 * Refloat's `ALLDATA` fault mode is a **state signal**, not a Telemetry Sample: this coordinator
 * turns a stream of observed active codes into distinct durable activations, independent of Ride
 * Recording, Ride History, and Board Warnings.
 *
 * Rules:
 * - active code changes from none or another code -> close any open occurrence, open a new one;
 * - the same code repeating -> one occurrence, its `lastObservedAt` advanced (write-throttled);
 * - a normal `ALLDATA` frame -> the open occurrence is cleared;
 * - Board Session loss -> **nothing**. Losing the session proves neither a clear nor a second
 *   activation, so the occurrence stays open and the same code returning continues it.
 *
 * Every input is injected (clock, id minting, store, collection switch), so clear, code change,
 * repetition, disconnect, restart, and setting changes are all testable without hardware.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift
 */
class VescFaultCoordinator(
  private val store: VescFaultStore,
  private val now: () -> Long = { System.currentTimeMillis() },
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  /**
   * `VESC Fault Collection` App Setting, mirrored here by the session controller. Off stops live
   * trigger handling and every new write; stored occurrences stay readable and dismissible.
   * Independent of `boardWarningsEnabled`.
   */
  @Volatile
  var collectionEnabled: Boolean = true

  /** Set by the bridge to push the full fault list for one Board to JS on every change. */
  @Volatile
  var onChange: ((boardId: String, faults: List<VescFaultOccurrence>) -> Unit)? = null

  /**
   * VESC Fault Capture lifecycle hooks, wired by the Board Session to [VescFaultCaptureCoordinator].
   * The occurrence id is the capture's foreign key, so the capture window can only be opened here —
   * at the exact transition that mints it.
   * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `onOccurrenceOpened`
   */
  @Volatile
  var onOccurrenceOpened: (suspend (VescFaultOccurrence) -> Unit)? = null

  /**
   * The occurrence stopped being active (clear or a direct code change). The capture keeps appending
   * through its post-clear tail; this only tells it when the tail starts.
   * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `onOccurrenceClosed`
   */
  @Volatile
  var onOccurrenceClosed: (suspend (occurrenceId: String, clearedAtMs: Long) -> Unit)? = null

  private val lock = Any()
  private val active = HashMap<String, VescFaultOccurrence>()
  private val hydrated = HashSet<String>()

  /**
   * Refloat reported an active fault code. Idempotent per code: repeated frames extend the same
   * occurrence instead of creating rows.
   */
  suspend fun onActiveFault(boardId: String, code: Int) {
    if (!collectionEnabled) return
    hydrate(boardId)
    val timestamp = now()
    val current = synchronized(lock) { active[boardId] }
    if (current != null && current.code == code) {
      // Same continuously active fault. Only persist when the observation moved the needle, so a
      // 30 Hz fault stream is not a 30 Hz write loop.
      if (timestamp - current.lastObservedAtMs < OBSERVATION_WRITE_INTERVAL_MS) return
      val updated = current.copy(lastObservedAtMs = timestamp)
      // Persist first: a throwing write must not leave memory claiming a transition the durable
      // store never took, because the controller-level edge dedupe would never retry it.
      store.upsert(updated)
      synchronized(lock) { active[boardId] = updated }
      return
    }
    // A direct code change closes the old activation and opens a new one — two distinct faults.
    if (current != null) {
      store.upsert(current.copy(clearedAtMs = timestamp, lastObservedAtMs = timestamp))
      onOccurrenceClosed?.invoke(current.id, timestamp)
    }
    val opened = VescFaultOccurrence(
      id = newId(),
      boardId = boardId,
      code = code,
      source = VescFaultSource.LIVE,
      occurredAtMs = timestamp,
      discoveredAtMs = timestamp,
      lastObservedAtMs = timestamp,
      clearedAtMs = null,
      registerPosition = null,
      dismissed = false,
    )
    store.upsert(opened)
    synchronized(lock) { active[boardId] = opened }
    onOccurrenceOpened?.invoke(opened)
    emit(boardId)
  }

  /** Refloat reported normal `ALLDATA` — any open occurrence for this Board is cleared. */
  suspend fun onFaultCleared(boardId: String) {
    if (!collectionEnabled) return
    hydrate(boardId)
    val current = synchronized(lock) { active[boardId] } ?: return
    val timestamp = now()
    // Persist the clear before forgetting the occurrence: if the write throws, the occurrence stays
    // active in memory and the next clear observation retries it.
    store.upsert(current.copy(clearedAtMs = timestamp, lastObservedAtMs = maxOf(current.lastObservedAtMs, timestamp)))
    synchronized(lock) { active.remove(boardId) }
    onOccurrenceClosed?.invoke(current.id, timestamp)
    emit(boardId)
  }

  /**
   * The Board Session ended while a fault may have been active. Deliberately does not close the
   * occurrence: the controller never said "cleared", and inventing one would fabricate evidence.
   * In-memory continuity is kept so the same code seen after a reconnect is the same activation.
   */
  fun onSessionLost(@Suppress("UNUSED_PARAMETER") boardId: String) = Unit

  /**
   * The occurrence a register read should try to enrich: the Board's currently open live
   * activation. In-memory state wins over the store, because a fault opened moments ago is the whole
   * point of the immediate post-trigger read.
   */
  suspend fun openLiveOccurrence(boardId: String): VescFaultOccurrence? {
    hydrate(boardId)
    return synchronized(lock) { active[boardId] } ?: store.openLive(boardId)
  }

  /**
   * Attach controller register context to an already-open live occurrence. Only ever called for the
   * unambiguous case decided by [VescFaultRegisterCoordinator]; this method does no matching itself.
   */
  suspend fun enrichFromRegister(occurrenceId: String, registerPosition: Int, snapshotId: String) {
    if (!collectionEnabled) return
    val current = store.getAll().firstOrNull { it.id == occurrenceId } ?: return
    val enriched = current.copy(registerPosition = registerPosition, registerSnapshotId = snapshotId)
    store.upsert(enriched)
    synchronized(lock) {
      val live = active[current.boardId]
      if (live != null && live.id == occurrenceId) active[current.boardId] = enriched
    }
    emit(current.boardId)
  }

  /**
   * Mint an occurrence Vescape only ever learned about from the controller's register.
   *
   * `occurredAtMs` stays null on purpose: the register carries no timestamp, and inventing one would
   * fabricate precision the controller never gave. Link baselines are recorded pre-dismissed so they
   * stay inspectable evidence without ever driving the Board health indicator.
   */
  suspend fun addRegisterOccurrence(
    boardId: String,
    code: Int,
    source: VescFaultSource,
    registerPosition: Int,
    snapshotId: String,
  ): VescFaultOccurrence? {
    if (!collectionEnabled) return null
    val timestamp = now()
    val occurrence = VescFaultOccurrence(
      id = newId(),
      boardId = boardId,
      code = code,
      source = source,
      occurredAtMs = null,
      discoveredAtMs = timestamp,
      lastObservedAtMs = timestamp,
      // The register holds faults the controller already finished reporting; there is nothing open
      // to close later, and leaving `clearedAt` null would render them as still active.
      clearedAtMs = timestamp,
      registerPosition = registerPosition,
      dismissed = source == VescFaultSource.BASELINE,
      registerSnapshotId = snapshotId,
    )
    store.upsert(occurrence)
    return occurrence
  }

  /** Push the current list for a Board after a batch of register writes. */
  suspend fun emitFor(boardId: String) = emit(boardId)

  suspend fun setDismissed(id: String, dismissed: Boolean) {
    if (!store.setDismissed(id, dismissed)) return
    synchronized(lock) {
      for ((boardId, occurrence) in active) {
        if (occurrence.id == id) active[boardId] = occurrence.copy(dismissed = dismissed)
      }
    }
    val boardId = store.getAll().firstOrNull { it.id == id }?.boardId ?: return
    emit(boardId)
  }

  suspend fun faultsForBoard(boardId: String): List<VescFaultOccurrence> = store.getForBoard(boardId)

  /** Every occurrence across all Boards — the JS foreground catch-up pull. */
  suspend fun allFaults(): List<VescFaultOccurrence> = store.getAll()

  /** Emit the current faults for every Board that has any — used on late subscribe. */
  suspend fun emitSnapshot() {
    for ((boardId, faults) in store.getAll().groupBy { it.boardId }) {
      onChange?.invoke(boardId, faults)
    }
  }

  /**
   * Adopt the newest still-open live occurrence as in-memory state the first time a Board is seen.
   * Without this, an app restart mid-fault would open a duplicate activation for the same fault.
   */
  private suspend fun hydrate(boardId: String) {
    synchronized(lock) { if (!hydrated.add(boardId)) return }
    val open = store.openLive(boardId) ?: return
    synchronized(lock) { active.putIfAbsent(boardId, open) }
  }

  private suspend fun emit(boardId: String) {
    onChange?.invoke(boardId, store.getForBoard(boardId))
  }

  companion object {
    /** A continuously active fault refreshes its `lastObservedAt` at most this often. */
    internal const val OBSERVATION_WRITE_INTERVAL_MS = 1_000L

    @Volatile
    private var instance: VescFaultCoordinator? = null

    fun get(context: Context): VescFaultCoordinator {
      return instance ?: synchronized(this) {
        instance ?: run {
          val appContext = context.applicationContext
          val dao = TelemetryDatabase.get(appContext).telemetryDao()
          VescFaultCoordinator(store = RoomVescFaultStore(dao)).also { instance = it }
        }
      }
    }
  }
}

private fun VescFaultOccurrenceEntity.toModel(): VescFaultOccurrence = VescFaultOccurrence(
  id = id,
  boardId = boardId,
  code = code,
  source = VescFaultSource.fromWire(source),
  occurredAtMs = occurredAtMs,
  discoveredAtMs = discoveredAtMs,
  lastObservedAtMs = lastObservedAtMs,
  clearedAtMs = clearedAtMs,
  registerPosition = registerPosition,
  dismissed = dismissed,
  registerSnapshotId = registerSnapshotId,
)

private fun VescFaultOccurrence.toEntity(): VescFaultOccurrenceEntity = VescFaultOccurrenceEntity(
  id = id,
  boardId = boardId,
  code = code,
  source = source.wire,
  occurredAtMs = occurredAtMs,
  discoveredAtMs = discoveredAtMs,
  lastObservedAtMs = lastObservedAtMs,
  clearedAtMs = clearedAtMs,
  registerPosition = registerPosition,
  dismissed = dismissed,
  registerSnapshotId = registerSnapshotId,
)

/** Production [VescFaultStore] backed by the shared Room DAO. */
private class RoomVescFaultStore(
  private val dao: expo.modules.vescapecore.telemetry.TelemetryDao,
) : VescFaultStore {
  override suspend fun getForBoard(boardId: String): List<VescFaultOccurrence> =
    dao.getVescFaults(boardId).map { it.toModel() }

  override suspend fun getAll(): List<VescFaultOccurrence> = dao.getAllVescFaults().map { it.toModel() }

  override suspend fun openLive(boardId: String): VescFaultOccurrence? =
    dao.getOpenVescFault(boardId)?.toModel()

  override suspend fun upsert(occurrence: VescFaultOccurrence) = dao.upsertVescFault(occurrence.toEntity())

  override suspend fun setDismissed(id: String, dismissed: Boolean): Boolean =
    dao.setVescFaultDismissed(id, dismissed) > 0
}
