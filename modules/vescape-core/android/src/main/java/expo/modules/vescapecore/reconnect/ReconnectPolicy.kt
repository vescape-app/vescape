package expo.modules.vescapecore.reconnect

internal const val RECONNECT_BACKOFF_STEP_MS = 500L
internal const val RECONNECT_BACKOFF_MAX_MS = 5_000L
internal const val RECONNECT_SCAN_TIMEOUT_MS = 6_000L

/**
 * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `slowAfterAttempts`
 */
internal const val RECONNECT_SLOW_AFTER_ATTEMPTS = 12

/**
 * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `slowIdleMs`
 */
internal const val RECONNECT_SLOW_BACKOFF_MS = 30_000L
internal const val BOARD_READY_TIMEOUT_BASE_MS = 4_000L
internal const val BOARD_READY_TIMEOUT_MAX_MS = 15_000L
internal const val BOARD_READY_TIMEOUT_STEP_MS = 2_000L

internal data class ReconnectRetry(val attempt: Int, val delayMs: Long)

internal object ReconnectPolicy {
    /**
     * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `rescanIdleMs`
     * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `failureRetryDelayMs`
     */
    fun nextRetry(currentAttempt: Int, appForeground: Boolean = false): ReconnectRetry {
        val next = currentAttempt + 1
        val fast = (RECONNECT_BACKOFF_STEP_MS * next).coerceAtMost(RECONNECT_BACKOFF_MAX_MS)
        val delay = if (!appForeground && next > RECONNECT_SLOW_AFTER_ATTEMPTS) {
            RECONNECT_SLOW_BACKOFF_MS
        } else {
            fast
        }
        return ReconnectRetry(attempt = next, delayMs = delay)
    }

    fun scanTimeoutMs(): Long = RECONNECT_SCAN_TIMEOUT_MS

    fun boardReadyTimeoutMs(attempt: Int): Long {
        val ms = BOARD_READY_TIMEOUT_BASE_MS + (attempt * BOARD_READY_TIMEOUT_STEP_MS)
        return ms.coerceAtMost(BOARD_READY_TIMEOUT_MAX_MS)
    }
}
