package expo.modules.vescapecore.reconnect

internal const val RECONNECT_BACKOFF_STEP_MS = 500L
internal const val RECONNECT_BACKOFF_MAX_MS = 5_000L
internal const val RECONNECT_SCAN_TIMEOUT_MS = 6_000L

/**
 * Attempts spent chasing a board before the retry loop decides this is not a dropout.
 *
 * One attempt costs roughly a capped backoff plus a scan window, so this lands around two minutes —
 * the same order as the ride dropout grace that stands GPS down, because it is the same judgement
 * about the same board.
 *
 * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `RECONNECT_SLOW_AFTER_ATTEMPTS`
 */
internal const val RECONNECT_SLOW_AFTER_ATTEMPTS = 12

/**
 * Backoff once the loop is chasing a board that is almost certainly off. Still unbounded — a board
 * left charging overnight reconnects when it comes back — but at a duty cycle that costs a parked
 * phone a scan every half minute instead of one every five seconds.
 *
 * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `RECONNECT_SLOW_BACKOFF_MS`
 */
internal const val RECONNECT_SLOW_BACKOFF_MS = 30_000L
internal const val BOARD_READY_TIMEOUT_BASE_MS = 4_000L
internal const val BOARD_READY_TIMEOUT_MAX_MS = 15_000L
internal const val BOARD_READY_TIMEOUT_STEP_MS = 2_000L

/** The next reconnect attempt index and the backoff delay to wait before it fires. */
internal data class ReconnectRetry(val attempt: Int, val delayMs: Long)

internal object ReconnectPolicy {
    /**
     * Reconnect retries are unbounded, matching iOS (CoreBluetooth persistent connect): a board
     * that is simply powered off must keep being retried until it returns, never giving up.
     *
     * The cadence is not uniform, because the two situations it covers are not the same. A mid-ride
     * dropout is recovered within seconds and is worth hammering the radio for, so backoff grows
     * linearly to a 5s cap. Past [RECONNECT_SLOW_AFTER_ATTEMPTS] the board has been unreachable for
     * minutes — the ordinary way a ride ends is the rider powering it off — and a phone in a pocket
     * should not keep low-latency scanning for it, so the loop drops to
     * [RECONNECT_SLOW_BACKOFF_MS] and stays there.
     *
     * @parity /modules/vescape-core/ios/connection/ReconnectPolicy.swift `rescanIdleMs`
     */
    fun nextRetry(currentAttempt: Int): ReconnectRetry {
        val next = currentAttempt + 1
        val delay = if (next > RECONNECT_SLOW_AFTER_ATTEMPTS) {
            RECONNECT_SLOW_BACKOFF_MS
        } else {
            (RECONNECT_BACKOFF_STEP_MS * next).coerceAtMost(RECONNECT_BACKOFF_MAX_MS)
        }
        return ReconnectRetry(attempt = next, delayMs = delay)
    }

    fun scanTimeoutMs(): Long = RECONNECT_SCAN_TIMEOUT_MS

    fun boardReadyTimeoutMs(attempt: Int): Long {
        val ms = BOARD_READY_TIMEOUT_BASE_MS + (attempt * BOARD_READY_TIMEOUT_STEP_MS)
        return ms.coerceAtMost(BOARD_READY_TIMEOUT_MAX_MS)
    }
}
