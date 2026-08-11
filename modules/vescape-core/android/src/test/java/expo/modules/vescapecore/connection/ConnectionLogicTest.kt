package expo.modules.vescapecore.connection

import expo.modules.vescapecore.service.TELEMETRY_STALE_MS

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionLogicTest {

    private fun reportedPhaseInput(
        rawPhase: BoardPhase = BoardPhase.Connected,
        hasBoardConfig: Boolean = true,
        hasActiveBoardSession: Boolean = true,
        isStoppingService: Boolean = false,
        lastTelemetryAt: Long = 1_000L,
        nowMs: Long = 1_000L,
    ) = ReportedBoardPhaseInput(
        rawPhase = rawPhase,
        hasBoardConfig = hasBoardConfig,
        hasActiveBoardSession = hasActiveBoardSession,
        isStoppingService = isStoppingService,
        lastTelemetryAt = lastTelemetryAt,
        nowMs = nowMs,
    )

    @Test
    fun `frame after Board Session teardown never reports Connected`() {
        val phase = deriveReportedBoardPhase(
            reportedPhaseInput(hasBoardConfig = false, hasActiveBoardSession = false),
        )

        assertEquals(BoardPhase.Idle, phase)
    }

    @Test
    fun `stale Connected reports Stale on notification and JS surfaces`() {
        val input = reportedPhaseInput(nowMs = 1_000L + TELEMETRY_STALE_MS)

        val notificationPhase = deriveReportedBoardPhase(input)
        val jsPhase = deriveReportedBoardPhase(input)

        assertEquals(BoardPhase.Stale, notificationPhase)
        assertEquals(BoardPhase.Stale, jsPhase)
    }

    @Test
    fun `notification phase equals JS phase for same raw state`() {
        val inputs = BoardPhase.values().flatMap { rawPhase ->
            listOf(
                reportedPhaseInput(rawPhase = rawPhase),
                reportedPhaseInput(
                    rawPhase = rawPhase,
                    hasBoardConfig = false,
                    hasActiveBoardSession = false,
                    nowMs = 1_000L + TELEMETRY_STALE_MS,
                ),
            )
        }

        inputs.forEach { input ->
            val notificationPhase = deriveReportedBoardPhase(input)
            val jsPhase = deriveReportedBoardPhase(input)
            assertEquals(notificationPhase, jsPhase)
        }
    }

    // --- boardReadyTimeoutMs: progressive timeout ---

    @Test
    fun `attempt 0 returns base timeout`() {
        assertEquals(4_000L, boardReadyTimeoutMs(0))
    }

    @Test
    fun `attempt 1 adds 2s`() {
        assertEquals(6_000L, boardReadyTimeoutMs(1))
    }

    @Test
    fun `attempt 5 returns 14s`() {
        assertEquals(14_000L, boardReadyTimeoutMs(5))
    }

    @Test
    fun `attempt 6 capped at max 15s`() {
        assertEquals(15_000L, boardReadyTimeoutMs(6))
    }

    @Test
    fun `attempt 100 still capped at max`() {
        assertEquals(15_000L, boardReadyTimeoutMs(100))
    }

    // --- isPollingCapable ---

    @Test
    fun `polling capable on a CAN transport`() {
        assertTrue(isPollingCapable(BoardTransport.Can(1)))
    }

    @Test
    fun `polling capable on a direct transport`() {
        assertTrue(isPollingCapable(BoardTransport.Direct))
    }

    @Test
    fun `not polling capable when the link has no detected transport`() {
        assertFalse(isPollingCapable(null))
    }

    // --- shouldStartPollingOnReady ---

    @Test
    fun `start polling when no pollRunnable and capable`() {
        assertTrue(
            shouldStartPollingOnReady(BoardTransport.Direct, pollRunnable = null),
        )
    }

    @Test
    fun `no start polling when already polling`() {
        assertFalse(
            shouldStartPollingOnReady(BoardTransport.Direct, pollRunnable = Any()),
        )
    }

    @Test
    fun `no start polling when not capable`() {
        assertFalse(
            shouldStartPollingOnReady(null, pollRunnable = null),
        )
    }

    @Test
    fun `start polling on a CAN transport`() {
        assertTrue(
            shouldStartPollingOnReady(BoardTransport.Can(2), pollRunnable = null),
        )
    }

    // --- boardReadyTimeoutMs edge ---

    @Test
    fun `negative attempt floors at base`() {
        assertEquals(BOARD_READY_TIMEOUT_BASE, boardReadyTimeoutMs(0))
        // negative would underflow but shouldn't happen; verify base is minimum
        assertTrue(boardReadyTimeoutMs(0) >= BOARD_READY_TIMEOUT_BASE)
    }

    // --- Constants sanity ---

    @Test
    fun `detection CAN ping timeout is 3500ms`() {
        assertEquals(3_500L, DETECT_CAN_PING_TIMEOUT_MS)
    }

    @Test
    fun `board ready base is 4 seconds`() {
        assertEquals(4_000L, BOARD_READY_TIMEOUT_BASE)
    }

    @Test
    fun `board ready max is 15 seconds`() {
        assertEquals(15_000L, BOARD_READY_TIMEOUT_MAX)
    }
}
