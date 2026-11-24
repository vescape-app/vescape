package expo.modules.vescapecore.config

import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/config/LegacyLightsConfigGateTests.swift
 */
class LegacyLightsConfigGateTest {
    @Test
    fun rejectsConfigMutatingLightsWhileConfigWriteIsInFlight() {
        val gate = LegacyLightsConfigGate(TestScheduler(), onEchoTimeout = {})

        assertFalse(gate.canSendLights("1.2.1", configWriteInFlight = true))
        assertTrue(gate.canSendLights("1.2.1", configWriteInFlight = false))
        assertTrue(gate.canSendLights("1.2.2", configWriteInFlight = true))
        assertTrue(gate.canSendLights("3.0.7", configWriteInFlight = true))
    }

    @Test
    fun tracksPendingEchoAndDemotesWriteBaseOnTimeout() {
        val scheduler = TestScheduler()
        var timeouts = 0
        val gate = LegacyLightsConfigGate(scheduler, onEchoTimeout = { timeouts++ })

        gate.onLightsCommandSent("1.2.2")
        assertFalse(gate.isEchoPending)

        gate.onLightsCommandSent("1.2.1")
        assertTrue(gate.isEchoPending)

        scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS - 1)
        assertTrue(gate.isEchoPending)
        assertEquals(0, timeouts)

        scheduler.advance(1)
        assertFalse(gate.isEchoPending)
        assertEquals(1, timeouts)
    }

    @Test
    fun echoAndResetCancelPendingTimeout() {
        val scheduler = TestScheduler()
        var timeouts = 0
        val gate = LegacyLightsConfigGate(scheduler, onEchoTimeout = { timeouts++ })

        gate.onLightsCommandSent("1.2.1")
        assertTrue(gate.isEchoPending)
        gate.onLightsEchoReceived()
        assertFalse(gate.isEchoPending)
        scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS * 2)
        assertEquals(0, timeouts)

        gate.onLightsCommandSent("1.2.1")
        assertTrue(gate.isEchoPending)
        gate.reset()
        assertFalse(gate.isEchoPending)
        scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS * 2)
        assertEquals(0, timeouts)
    }
}
