package expo.modules.vescapecore.faults

import android.content.Context
import expo.modules.vescapecore.database.VescapeDatabase
import expo.modules.vescapecore.database.VescFaultOccurrenceEntity
import expo.modules.vescapecore.recording.RecordingStorageFailure
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `VescFaultOccurrence`
 * @parity /modules/vescape-core/src/index.ts `VescFaultOccurrence`
 */
data class VescFaultOccurrence(
  val id: String,
  val boardId: String,
  val code: Int,
  val occurredAtMs: Long,
  val lastObservedAtMs: Long,
  val clearedAtMs: Long?,
  val dismissed: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "boardId" to boardId,
    "code" to code,
    "occurredAtMs" to occurredAtMs,
    "lastObservedAtMs" to lastObservedAtMs,
    "clearedAtMs" to clearedAtMs,
    "dismissed" to dismissed,
  )
}

interface VescFaultStore {
  suspend fun getForBoard(boardId: String): List<VescFaultOccurrence>
  suspend fun getAll(): List<VescFaultOccurrence>
  suspend fun openLive(boardId: String): VescFaultOccurrence?
  suspend fun upsert(occurrence: VescFaultOccurrence)
  suspend fun setDismissed(id: String, dismissed: Boolean): Boolean
}

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift
 */
class VescFaultCoordinator(
  private val store: VescFaultStore,
  private val now: () -> Long = { System.currentTimeMillis() },
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  @Volatile
  var collectionEnabled: Boolean = true

  @Volatile
  var onChange: ((boardId: String, faults: List<VescFaultOccurrence>) -> Unit)? = null

  /**
   * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `onOccurrenceOpened`
   */
  @Volatile
  var onOccurrenceOpened: (suspend (VescFaultOccurrence) -> Unit)? = null

  private val lock = Any()
  private val active = HashMap<String, VescFaultOccurrence>()
  private val hydrated = HashSet<String>()

  suspend fun onActiveFault(boardId: String, code: Int) {
    if (!collectionEnabled) return
    if (!hydrate(boardId)) return
    val timestamp = now()
    val current = synchronized(lock) { active[boardId] }
    if (current != null && current.code == code) {
      if (timestamp - current.lastObservedAtMs < OBSERVATION_WRITE_INTERVAL_MS) return
      val updated = current.copy(lastObservedAtMs = timestamp)
      store.upsert(updated)
      synchronized(lock) { active[boardId] = updated }
      return
    }
    if (current != null) {
      store.upsert(current.copy(clearedAtMs = timestamp, lastObservedAtMs = timestamp))
    }
    val opened = VescFaultOccurrence(
      id = newId(),
      boardId = boardId,
      code = code,
      occurredAtMs = timestamp,
      lastObservedAtMs = timestamp,
      clearedAtMs = null,
      dismissed = false,
    )
    store.upsert(opened)
    synchronized(lock) { active[boardId] = opened }
    onOccurrenceOpened?.invoke(opened)
    emit(boardId)
  }

  suspend fun onFaultCleared(boardId: String) {
    if (!collectionEnabled) return
    if (!hydrate(boardId)) return
    val current = synchronized(lock) { active[boardId] } ?: return
    val timestamp = now()
    store.upsert(current.copy(clearedAtMs = timestamp, lastObservedAtMs = maxOf(current.lastObservedAtMs, timestamp)))
    synchronized(lock) { active.remove(boardId) }
    emit(boardId)
  }

  suspend fun setDismissed(id: String, dismissed: Boolean) {
    if (!store.setDismissed(id, dismissed)) return
    synchronized(lock) {
      for ((boardId, occurrence) in active) {
        if (occurrence.id == id) active[boardId] = occurrence.copy(dismissed = dismissed)
      }
    }
    try {
      val boardId = store.getAll().firstOrNull { it.id == id }?.boardId ?: return
      emit(boardId)
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (failure: Throwable) {
      RecordingStorageFailure.reportRead("vesc_fault_reload_after_dismiss", failure)
    }
  }

  suspend fun allFaults(): List<VescFaultOccurrence> = store.getAll()

  suspend fun emitSnapshot() {
    for ((boardId, faults) in store.getAll().groupBy { it.boardId }) {
      onChange?.invoke(boardId, faults)
    }
  }

  private suspend fun hydrate(boardId: String): Boolean {
    synchronized(lock) { if (hydrated.contains(boardId)) return true }
    val open = try {
      store.openLive(boardId)
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (failure: Throwable) {
      RecordingStorageFailure.reportRead("vesc_fault_open_read", failure)
      return false
    }
    synchronized(lock) {
      hydrated.add(boardId)
      if (open != null) active.putIfAbsent(boardId, open)
    }
    return true
  }

  private suspend fun emit(boardId: String) {
    onChange?.invoke(boardId, store.getForBoard(boardId))
  }

  companion object {
    internal const val OBSERVATION_WRITE_INTERVAL_MS = 1_000L

    @Volatile
    private var instance: VescFaultCoordinator? = null

    fun get(context: Context): VescFaultCoordinator {
      return instance ?: synchronized(this) {
        instance ?: run {
          val appContext = context.applicationContext
          val dao = VescapeDatabase.get(appContext).vescapeDao()
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
  occurredAtMs = occurredAtMs,
  lastObservedAtMs = lastObservedAtMs,
  clearedAtMs = clearedAtMs,
  dismissed = dismissed,
)

private fun VescFaultOccurrence.toEntity(): VescFaultOccurrenceEntity = VescFaultOccurrenceEntity(
  id = id,
  boardId = boardId,
  code = code,
  occurredAtMs = occurredAtMs,
  lastObservedAtMs = lastObservedAtMs,
  clearedAtMs = clearedAtMs,
  dismissed = dismissed,
)

private class RoomVescFaultStore(
  private val dao: expo.modules.vescapecore.database.VescapeDao,
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
