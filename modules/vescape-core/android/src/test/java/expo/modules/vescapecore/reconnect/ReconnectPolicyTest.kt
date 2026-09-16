package expo.modules.vescapecore.reconnect

import org.junit.Assert.assertEquals
import org.junit.Test

class ReconnectPolicyTest {
    @Test
    fun `backoff grows linearly then caps while the drop still looks recoverable`() {
        assertEquals(ReconnectRetry(attempt = 1, delayMs = 500L), ReconnectPolicy.nextRetry(0))
        assertEquals(ReconnectRetry(attempt = 2, delayMs = 1_000L), ReconnectPolicy.nextRetry(1))
        assertEquals(ReconnectRetry(attempt = 10, delayMs = 5_000L), ReconnectPolicy.nextRetry(9))
        assertEquals(
            ReconnectRetry(attempt = RECONNECT_SLOW_AFTER_ATTEMPTS, delayMs = 5_000L),
            ReconnectPolicy.nextRetry(RECONNECT_SLOW_AFTER_ATTEMPTS - 1),
        )
    }

    @Test
    fun `backoff drops to the slow tier once the board is plainly off`() {
        assertEquals(
            ReconnectRetry(attempt = RECONNECT_SLOW_AFTER_ATTEMPTS + 1, delayMs = RECONNECT_SLOW_BACKOFF_MS),
            ReconnectPolicy.nextRetry(RECONNECT_SLOW_AFTER_ATTEMPTS),
        )
        assertEquals(
            ReconnectRetry(attempt = 60, delayMs = RECONNECT_SLOW_BACKOFF_MS),
            ReconnectPolicy.nextRetry(59),
        )
    }

    @Test
    fun `retries never give up`() {
        assertEquals(
            ReconnectRetry(attempt = 1_000, delayMs = RECONNECT_SLOW_BACKOFF_MS),
            ReconnectPolicy.nextRetry(999),
        )
    }

    @Test
    fun `board ready timeout follows reconnect attempt and caps`() {
        assertEquals(4_000L, ReconnectPolicy.boardReadyTimeoutMs(0))
        assertEquals(6_000L, ReconnectPolicy.boardReadyTimeoutMs(1))
        assertEquals(14_000L, ReconnectPolicy.boardReadyTimeoutMs(5))
        assertEquals(15_000L, ReconnectPolicy.boardReadyTimeoutMs(6))
        assertEquals(15_000L, ReconnectPolicy.boardReadyTimeoutMs(100))
    }
}
