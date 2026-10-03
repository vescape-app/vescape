package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/TelemetryLevelTests.swift */
class TelemetryLevelTest {
    @Test
    fun `an unknown wire level reads as normal`() {
        TelemetryLevel.values().forEach { assertEquals(it, TelemetryLevel.fromWire(it.wire)) }
        assertEquals(TelemetryLevel.NORMAL, TelemetryLevel.fromWire(9))
    }
}
