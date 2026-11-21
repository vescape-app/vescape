package expo.modules.vescapecore.connection

import expo.modules.vescapecore.service.TELEMETRY_STALE_MS

import expo.modules.vescapecore.reconnect.BOARD_READY_TIMEOUT_BASE_MS
import expo.modules.vescapecore.reconnect.BOARD_READY_TIMEOUT_MAX_MS
import expo.modules.vescapecore.reconnect.ReconnectPolicy

internal const val BOARD_READY_TIMEOUT_BASE = BOARD_READY_TIMEOUT_BASE_MS
internal const val BOARD_READY_TIMEOUT_MAX = BOARD_READY_TIMEOUT_MAX_MS
internal const val DETECT_CAN_PING_TIMEOUT_MS = 3_500L

internal const val DETECT_PROBE_TIMEOUT_MS = 2_500L

internal fun boardReadyTimeoutMs(attempt: Int): Long = ReconnectPolicy.boardReadyTimeoutMs(attempt)

internal fun isPollingCapable(transport: BoardTransport?): Boolean = transport != null

internal fun shouldStartPollingOnReady(
    transport: BoardTransport?,
    pollRunnable: Any?,
): Boolean =
    pollRunnable == null && isPollingCapable(transport)

internal data class ReportedBoardPhaseInput(
    val rawPhase: BoardPhase,
    val hasBoardConfig: Boolean,
    val hasActiveBoardSession: Boolean,
    val isStoppingService: Boolean,
    val lastTelemetryAt: Long,
    val nowMs: Long,
)

internal fun deriveReportedBoardPhase(input: ReportedBoardPhaseInput): BoardPhase {
    if (input.rawPhase != BoardPhase.Connected) return input.rawPhase
    if (!input.hasBoardConfig || !input.hasActiveBoardSession || input.isStoppingService) {
        return BoardPhase.Idle
    }
    return if (input.nowMs - input.lastTelemetryAt >= TELEMETRY_STALE_MS) {
        BoardPhase.Stale
    } else {
        BoardPhase.Connected
    }
}
