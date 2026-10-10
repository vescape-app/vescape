package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.telemetry.TelemetryLevel.CRITICAL
import expo.modules.vescapecore.telemetry.TelemetryLevel.NORMAL
import expo.modules.vescapecore.telemetry.TelemetryLevel.WARNING
import org.junit.Assert.assertEquals
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/TelemetryThresholdsTests.swift */
class TelemetryThresholdsTest {
    @Test
    fun `battery is flagged strictly below 30 and 10 percent`() {
        assertEquals(NORMAL, TelemetryThresholds.batteryLevel(0.3))
        assertEquals(WARNING, TelemetryThresholds.batteryLevel(0.2999))
        assertEquals(WARNING, TelemetryThresholds.batteryLevel(0.1))
        assertEquals(CRITICAL, TelemetryThresholds.batteryLevel(0.0999))
        assertEquals(NORMAL, TelemetryThresholds.batteryLevel(null))
    }

    @Test
    fun `temperature is flagged strictly above 70 and 80 degrees`() {
        assertEquals(NORMAL, TelemetryThresholds.tempLevel(70.0))
        assertEquals(WARNING, TelemetryThresholds.tempLevel(70.01))
        assertEquals(WARNING, TelemetryThresholds.tempLevel(80.0))
        assertEquals(CRITICAL, TelemetryThresholds.tempLevel(80.01))
        assertEquals(NORMAL, TelemetryThresholds.tempLevel(null))
    }

    @Test
    fun `heat is the worse of motor and controller`() {
        assertEquals(CRITICAL, TelemetryThresholds.heatLevel(motorTempC = 85.0, ctrlTempC = 75.0))
        assertEquals(WARNING, TelemetryThresholds.heatLevel(motorTempC = 40.0, ctrlTempC = 75.0))
        assertEquals(WARNING, TelemetryThresholds.heatLevel(motorTempC = 75.0, ctrlTempC = null))
        assertEquals(NORMAL, TelemetryThresholds.heatLevel(motorTempC = null, ctrlTempC = null))
    }
}
