package expo.modules.vescapecore.connection

import expo.modules.vescapecore.service.TELEMETRY_STALE_MS

import expo.modules.vescapecore.reconnect.BOARD_READY_TIMEOUT_BASE_MS
import expo.modules.vescapecore.reconnect.BOARD_READY_TIMEOUT_MAX_MS
import expo.modules.vescapecore.reconnect.ReconnectPolicy

internal const val BOARD_READY_TIMEOUT_BASE = BOARD_READY_TIMEOUT_BASE_MS
internal const val BOARD_READY_TIMEOUT_MAX = BOARD_READY_TIMEOUT_MAX_MS
internal const val DETECT_CAN_PING_TIMEOUT_MS = 3_500L

/** Per-candidate window a detection probe waits for one valid Telemetry Sample. */
internal const val DETECT_PROBE_TIMEOUT_MS = 2_500L

internal fun boardReadyTimeoutMs(attempt: Int): Long = ReconnectPolicy.boardReadyTimeoutMs(attempt)

/** A Board can only be polled once its Board Link carries a detected transport. */
internal fun isPollingCapable(transport: BoardTransport?): Boolean = transport != null

internal fun shouldStartPollingOnReady(
    transport: BoardTransport?,
    pollRunnable: Any?,
): Boolean =
    pollRunnable == null && isPollingCapable(transport)

/** Raw service state needed to report one rider-facing Board phase. */
internal data class ReportedBoardPhaseInput(
    val rawPhase: BoardPhase,
    val hasBoardConfig: Boolean,
    val hasActiveBoardSession: Boolean,
    val isStoppingService: Boolean,
    val lastTelemetryAt: Long,
    val nowMs: Long,
)

/**
 * Only authority for rider-facing Board phase.
 *
 * `Connected` means active Board Session with current telemetry. A raw Connected
 * written by an in-flight callback after teardown is therefore never reported.
 */
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
