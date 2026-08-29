package expo.modules.vescapecore.faults

import android.content.Context
import expo.modules.vescapecore.telemetry.TelemetryDao
import expo.modules.vescapecore.telemetry.TelemetryDatabase
import expo.modules.vescapecore.telemetry.VescFaultRegisterSnapshotEntity
import java.util.UUID

/**
 * Narrow durable persistence for retained controller register reads.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegisterStore.swift `VescFaultRegisterStoring`
 */
interface VescFaultRegisterSnapshotStore {
  suspend fun insert(snapshot: VescFaultRegisterSnapshot)
  suspend fun getForBoard(boardId: String, limit: Int): List<VescFaultRegisterSnapshot>
  suspend fun get(id: String): VescFaultRegisterSnapshot?
  /** Newest snapshot that finished cleanly — the comparison point for "what is new". */
  suspend fun latestComplete(boardId: String): VescFaultRegisterSnapshot?
  /** True once this Board has a link baseline, so later reads are discoveries and not baselines. */
  suspend fun hasBaseline(boardId: String): Boolean
}

/** What one recorded read did. Purely informational; the durable effects are already persisted. */
data class VescFaultRegisterRecord(
  val snapshot: VescFaultRegisterSnapshot?,
  /** The read was byte-identical to the last complete one: evidence, but nothing new. */
  val unchanged: Boolean,
  /** Entries persisted as discarded link-baseline occurrences. */
  val baselineCount: Int,
  /** New register-discovered occurrences created. */
  val createdCount: Int,
  /** The open live occurrence this read enriched, when the match was unambiguous. */
  val enrichedOccurrenceId: String?,
)

/**
 * Folds retained controller register reads into Board-owned fault evidence.
 *
 * Three rules carry the whole design:
 *
 * 1. **Raw bytes are the authority.** Every read that changed anything is stored whole, including
 *    incomplete ones. A parser that cannot read the output loses the projection, never the bytes.
 * 2. **Incomplete proves nothing.** A partial read is retained as evidence and stops there — it can
 *    neither create an occurrence nor establish that the register is empty.
 * 3. **Code is not an identity.** New entries are found by diffing against the previous complete
 *    read, not by matching codes across history.
 *
 * ### Reconciliation with a live trigger
 *
 * The immediate post-trigger read enriches the open live occurrence only when the read produced
 * **exactly one** previously unseen entry. That single new block is the one the activation just
 * caused; two or more is ambiguous and every entry stays a separate register-discovered occurrence.
 *
 * The match is deliberately *not* made on the fault code. Refloat's live `ALLDATA` fault codes and
 * the controller's `mc_fault_code` register are different code spaces — comparing them numerically
 * would merge unrelated evidence, which is exactly the fabrication this feature exists to avoid.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegisterCoordinator.swift
 */
class VescFaultRegisterCoordinator(
  private val snapshots: VescFaultRegisterSnapshotStore,
  private val faults: VescFaultCoordinator,
  private val now: () -> Long = { System.currentTimeMillis() },
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val lock = Any()
  private val baselineRequested = HashSet<String>()

  /**
   * A link or re-link happened: the next successful read for this Board becomes its new comparison
   * baseline, because a re-addressed controller's register has nothing to do with the old one.
   */
  fun requestBaseline(boardId: String) {
    synchronized(lock) { baselineRequested.add(boardId) }
  }

  /**
   * Reason to use for this Board's next read. A Board that has never had a baseline — including one
   * saved before this feature existed — gets one on its first successful connection.
   */
  suspend fun connectReason(boardId: String): VescFaultRegisterReason {
    val requested = synchronized(lock) { baselineRequested.contains(boardId) }
    if (requested || !snapshots.hasBaseline(boardId)) return VescFaultRegisterReason.BASELINE
    return VescFaultRegisterReason.CONNECT
  }

  /** Persist one finished read and fold whatever it proved into occurrence storage. */
  suspend fun record(boardId: String, read: VescFaultRegisterRead): VescFaultRegisterRecord {
    if (!faults.collectionEnabled) return EMPTY
    val complete = read.status == VescFaultRegisterStatus.COMPLETE
    // Nothing arrived at all. That is a failed read, not partial evidence: there are no bytes worth
    // retaining, and a later safe audit will try again.
    if (!complete && read.raw.isEmpty()) return EMPTY
    val previous = snapshots.latestComplete(boardId)
    if (complete && previous != null && previous.raw.contentEquals(read.raw)) {
      // Unchanged evidence. Storing it again would grow the table with duplicates and re-running
      // reconciliation against it would duplicate occurrences, which is the one thing audits must
      // never do.
      return EMPTY.copy(snapshot = previous, unchanged = true)
    }
    // Only complete output is parsed. A partial block could name a fault whose context is truncated,
    // and half a fault must not become a durable occurrence.
    val entries = if (complete) VescFaultRegisterParser.parse(read.text) else null
    val snapshot = VescFaultRegisterSnapshot(
      id = newId(),
      boardId = boardId,
      readAtMs = now(),
      reason = read.reason,
      status = read.status,
      raw = read.raw,
      text = read.text,
      entries = entries,
    )
    snapshots.insert(snapshot)
    if (entries == null) return EMPTY.copy(snapshot = snapshot)

    if (read.reason == VescFaultRegisterReason.BASELINE) {
      for (entry in entries) {
        faults.addRegisterOccurrence(
          boardId = boardId,
          code = entry.code ?: UNKNOWN_REGISTER_CODE,
          source = VescFaultSource.BASELINE,
          registerPosition = entry.position,
          snapshotId = snapshot.id,
        )
      }
      synchronized(lock) { baselineRequested.remove(boardId) }
      if (entries.isNotEmpty()) faults.emitFor(boardId)
      return EMPTY.copy(snapshot = snapshot, baselineCount = entries.size)
    }

    val seen = previous?.entries?.map { it.rawBlock }?.toSet() ?: emptySet()
    val unseen = entries.filter { it.rawBlock !in seen }
    if (unseen.isEmpty()) return EMPTY.copy(snapshot = snapshot)

    if (read.reason == VescFaultRegisterReason.LIVE && unseen.size == 1) {
      val open = faults.openLiveOccurrence(boardId)
      if (open != null) {
        faults.enrichFromRegister(open.id, unseen[0].position, snapshot.id)
        return EMPTY.copy(snapshot = snapshot, enrichedOccurrenceId = open.id)
      }
    }
    for (entry in unseen) {
      faults.addRegisterOccurrence(
        boardId = boardId,
        code = entry.code ?: UNKNOWN_REGISTER_CODE,
        source = VescFaultSource.REGISTER,
        registerPosition = entry.position,
        snapshotId = snapshot.id,
      )
    }
    faults.emitFor(boardId)
    return EMPTY.copy(snapshot = snapshot, createdCount = unseen.size)
  }

  suspend fun snapshotsForBoard(boardId: String, limit: Int = SNAPSHOT_PAGE): List<VescFaultRegisterSnapshot> =
    snapshots.getForBoard(boardId, limit)

  suspend fun snapshot(id: String): VescFaultRegisterSnapshot? = snapshots.get(id)

  /**
   * The newest link baseline for a Board, or null while none has landed. Linking polls this so it
   * can show the rider how many faults the controller already held — informational only, and its
   * absence never fails a Board Link.
   */
  suspend fun latestBaseline(boardId: String): VescFaultRegisterSnapshot? =
    snapshots.getForBoard(boardId, SNAPSHOT_PAGE)
      .firstOrNull { it.reason == VescFaultRegisterReason.BASELINE }

  companion object {
    /**
     * Stand-in code for a register entry whose firmware fault name this build does not know. The
     * real name is preserved verbatim in the snapshot; this only keeps the non-null occurrence
     * column honest about "unknown" instead of guessing a numeric code.
     */
    internal const val UNKNOWN_REGISTER_CODE = -1

    /** Snapshots returned to JS per Board. Read models show recent evidence, not all history. */
    internal const val SNAPSHOT_PAGE = 20

    private val EMPTY = VescFaultRegisterRecord(null, false, 0, 0, null)

    @Volatile
    private var instance: VescFaultRegisterCoordinator? = null

    fun get(context: Context): VescFaultRegisterCoordinator {
      return instance ?: synchronized(this) {
        instance ?: run {
          val appContext = context.applicationContext
          val dao = TelemetryDatabase.get(appContext).telemetryDao()
          VescFaultRegisterCoordinator(
            snapshots = RoomVescFaultRegisterSnapshotStore(dao),
            faults = VescFaultCoordinator.get(appContext),
          ).also { instance = it }
        }
      }
    }
  }
}

/** Production [VescFaultRegisterSnapshotStore] backed by the shared Room DAO. */
private class RoomVescFaultRegisterSnapshotStore(
  private val dao: TelemetryDao,
) : VescFaultRegisterSnapshotStore {
  override suspend fun insert(snapshot: VescFaultRegisterSnapshot) =
    dao.insertVescFaultRegisterSnapshot(
      VescFaultRegisterSnapshotEntity(
        id = snapshot.id,
        boardId = snapshot.boardId,
        readAtMs = snapshot.readAtMs,
        reason = snapshot.reason.wire,
        status = snapshot.status.wire,
        raw = snapshot.raw,
        text = snapshot.text,
        entriesJson = encodeRegisterEntries(snapshot.entries),
      ),
    )

  override suspend fun getForBoard(boardId: String, limit: Int): List<VescFaultRegisterSnapshot> =
    dao.getVescFaultRegisterSnapshots(boardId, limit).map { it.toModel() }

  override suspend fun get(id: String): VescFaultRegisterSnapshot? =
    dao.getVescFaultRegisterSnapshot(id)?.toModel()

  override suspend fun latestComplete(boardId: String): VescFaultRegisterSnapshot? =
    dao.getLatestCompleteVescFaultRegisterSnapshot(boardId)?.toModel()

  override suspend fun hasBaseline(boardId: String): Boolean =
    dao.countVescFaultRegisterBaselines(boardId) > 0
}

private fun VescFaultRegisterSnapshotEntity.toModel() = VescFaultRegisterSnapshot(
  id = id,
  boardId = boardId,
  readAtMs = readAtMs,
  reason = VescFaultRegisterReason.fromWire(reason),
  status = VescFaultRegisterStatus.fromWire(status),
  raw = raw,
  text = text,
  entries = decodeRegisterEntries(entriesJson),
)
