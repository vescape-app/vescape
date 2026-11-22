package expo.modules.vescapecore.warnings

import android.content.Context
import expo.modules.vescapecore.database.BoardWarningEntity
import expo.modules.vescapecore.database.VescapeDatabase
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.recording.RecordingStorageFailure
import kotlinx.coroutines.CancellationException

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningKind.swift `BoardWarningSeverity`
 * @parity /modules/vescape-core/src/index.ts `BoardWarningSeverity`
 */
/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift `BoardWarning`
 * @parity /modules/vescape-core/src/index.ts `BoardWarning`
 */
data class BoardWarning(
  val boardId: String,
  val kind: String,
  val severity: BoardWarningSeverity,
  val firstDetectedAtMs: Long,
  val lastDetectedAtMs: Long,
  val payloadJson: String,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "boardId" to boardId,
    "kind" to kind,
    "severity" to severity.wire,
    "firstDetectedAtMs" to firstDetectedAtMs,
    "lastDetectedAtMs" to lastDetectedAtMs,
    "payloadJson" to payloadJson,
  )
}

private fun BoardWarningEntity.toModel(): BoardWarning = BoardWarning(
  boardId = boardId,
  kind = kind,
  severity = BoardWarningSeverity.fromWire(severity),
  firstDetectedAtMs = firstDetectedAt,
  lastDetectedAtMs = lastDetectedAt,
  payloadJson = payloadJson,
)

interface BoardWarningStore {
  suspend fun get(boardId: String, kind: String): BoardWarning?
  suspend fun getForBoard(boardId: String): List<BoardWarning>
  suspend fun getAll(): List<BoardWarning>
  suspend fun upsert(warning: BoardWarning)
  suspend fun delete(boardId: String, kind: String): Boolean
  suspend fun deleteForBoard(boardId: String): Boolean
}

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningRegistry.swift
 */
class BoardWarningRegistry(
  private val store: BoardWarningStore,
  private val recordDiagnostic: (eventName: String, properties: Map<String, Any?>) -> Unit,
  private val now: () -> Long = { System.currentTimeMillis() },
) {
  @Volatile
  var onChange: ((boardId: String, warnings: List<BoardWarning>) -> Unit)? = null

  @Volatile
  var onManualClear: ((boardId: String, kind: String?) -> Unit)? = null

  private val lock = Any()
  private val firedThisSession = HashSet<String>()

  private fun sessionKey(boardId: String, kind: String) = "$boardId\u0000$kind"

  fun beginSession(boardId: String) {
    synchronized(lock) {
      firedThisSession.removeAll { it.startsWith("$boardId\u0000") }
    }
  }

  suspend fun reportFinding(
    boardId: String,
    kind: BoardWarningKind,
    severity: BoardWarningSeverity,
    payloadJson: String,
  ) = reportFinding(boardId, kind.wire, severity, payloadJson)

  suspend fun reportFinding(
    boardId: String,
    kind: String,
    severity: BoardWarningSeverity,
    payloadJson: String,
  ) {
    val timestamp = now()
    val existing = store.get(boardId, kind)
    val warning = BoardWarning(
      boardId = boardId,
      kind = kind,
      severity = severity,
      firstDetectedAtMs = existing?.firstDetectedAtMs ?: timestamp,
      lastDetectedAtMs = timestamp,
      payloadJson = payloadJson,
    )
    store.upsert(warning)

    val isFirstFireThisSession = synchronized(lock) { firedThisSession.add(sessionKey(boardId, kind)) }
    if (isFirstFireThisSession) {
      recordDiagnostic(
        "board_warning_detected",
        mapOf(
          "operation" to "warning",
          "board_id" to boardId,
          "kind" to kind,
          "severity" to severity.wire,
          "message" to "Board warning: $kind (${severity.wire})",
        ),
      )
    }
    emit(boardId)
  }

  suspend fun reportCleanEvaluation(boardId: String, kind: BoardWarningKind) =
    reportCleanEvaluation(boardId, kind.wire)

  suspend fun reportCleanEvaluation(boardId: String, kind: String) {
    if (store.delete(boardId, kind)) {
      reportReloadFailure("board_warnings_reload_after_clean") { emit(boardId) }
    }
  }

  suspend fun clearWarning(boardId: String, kind: String) {
    if (store.delete(boardId, kind)) reportReloadFailure("board_warnings_reload_after_clear") { emit(boardId) }
    onManualClear?.invoke(boardId, kind)
  }

  suspend fun clearAllWarnings(boardId: String) {
    if (store.deleteForBoard(boardId)) reportReloadFailure("board_warnings_reload_after_clear_all") { emit(boardId) }
    onManualClear?.invoke(boardId, null)
  }

  suspend fun warningsForBoard(boardId: String): List<BoardWarning> = store.getForBoard(boardId)

  suspend fun allWarnings(): List<BoardWarning> = store.getAll()

  suspend fun emitSnapshot() {
    val byBoard = store.getAll().groupBy { it.boardId }
    for ((boardId, warnings) in byBoard) {
      onChange?.invoke(boardId, warnings)
    }
  }

  private suspend fun emit(boardId: String) {
    onChange?.invoke(boardId, store.getForBoard(boardId))
  }

  private suspend fun reportReloadFailure(operation: String, block: suspend () -> Unit) {
    try { block() }
    catch (cancellation: CancellationException) { throw cancellation }
    catch (failure: Throwable) { RecordingStorageFailure.reportRead(operation, failure) }
  }

  companion object {
    @Volatile
    private var instance: BoardWarningRegistry? = null

    fun get(context: Context): BoardWarningRegistry {
      return instance ?: synchronized(this) {
        instance ?: run {
          val appContext = context.applicationContext
          val dao = VescapeDatabase.get(appContext).vescapeDao()
          val repository = TelemetryRepository.get(appContext)
          BoardWarningRegistry(
            store = RoomBoardWarningStore(dao),
            recordDiagnostic = { name, props -> repository.recordDiagnosticEvent(name, props) },
          ).also { instance = it }
        }
      }
    }
  }
}

private class RoomBoardWarningStore(
  private val dao: expo.modules.vescapecore.database.VescapeDao,
) : BoardWarningStore {
  override suspend fun get(boardId: String, kind: String): BoardWarning? =
    dao.getBoardWarning(boardId, kind)?.toModel()

  override suspend fun getForBoard(boardId: String): List<BoardWarning> =
    dao.getBoardWarnings(boardId).map { it.toModel() }

  override suspend fun getAll(): List<BoardWarning> =
    dao.getAllBoardWarnings().map { it.toModel() }

  override suspend fun upsert(warning: BoardWarning) {
    dao.upsertBoardWarning(
      BoardWarningEntity(
        boardId = warning.boardId,
        kind = warning.kind,
        severity = warning.severity.wire,
        firstDetectedAt = warning.firstDetectedAtMs,
        lastDetectedAt = warning.lastDetectedAtMs,
        payloadJson = warning.payloadJson,
      ),
    )
  }

  override suspend fun delete(boardId: String, kind: String): Boolean =
    dao.deleteBoardWarning(boardId, kind) > 0

  override suspend fun deleteForBoard(boardId: String): Boolean =
    dao.deleteBoardWarnings(boardId) > 0
}
