package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/config/BoardIdleGateTests.swift
 */
class BoardIdleGateTest {
    private val now = 1_000_000L

    @Test
    fun idleBoardWithFreshTelemetryPasses() {
        for (state in listOf(0, 4, 5, 6, 11)) {
            assertNull("state $state", BoardIdleGate.blockReason(sample(state = state), BoardIdleGate.freshSinceMs(now)))
        }
    }

    @Test
    fun engagedStatesBlock() {
        for (state in listOf(1, 2, 3, 0x11)) {
            assertNotNull("state $state", BoardIdleGate.blockReason(sample(state = state), BoardIdleGate.freshSinceMs(now)))
        }
    }

    @Test
    fun handtestBlocks() {
        assertEquals(
            "Board is in handtest",
            BoardIdleGate.blockReason(sample(switchState = 0x0A), BoardIdleGate.freshSinceMs(now)),
        )
    }

    @Test
    fun missingOrStaleTelemetryBlocks() {
        assertNotNull(BoardIdleGate.blockReason(null, BoardIdleGate.freshSinceMs(now)))
        assertNotNull(BoardIdleGate.blockReason(sample(receivedAtMs = now - 4_001), BoardIdleGate.freshSinceMs(now)))
        assertNull(BoardIdleGate.blockReason(sample(receivedAtMs = now - 4_000), BoardIdleGate.freshSinceMs(now)))
    }

    private fun sample(state: Int = 0, switchState: Int = 2, receivedAtMs: Long = now) =
        BoardRideState(state, switchState, receivedAtMs)
}
