package expo.modules.vescapecore.ow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwTelemetryTest {
  @Test
  fun `maps OneWheel channels into shared telemetry`() {
    val telemetry = OwFrame(
      atMs = 1234L,
      rpm = 300,
      speedKmh = 16.0,
      batteryVoltage = 61.2,
      batteryCurrent = -4.5,
      pitchDeg = 2.5,
      rollDeg = -1.0,
      controllerTempC = 42.0,
      motorTempC = 51.0,
      rideMode = 6,
      lifetimeOdometerM = 1609.344,
      faultCode = 0,
    ).toRefloatTelemetry()

    assertEquals(16.0, telemetry.speed, 0.0001)
    assertEquals(61.2, telemetry.batteryVoltage!!, 0.0001)
    assertEquals(-4.5, telemetry.batteryCurrent, 0.0001)
    assertEquals(2.5, telemetry.pitch, 0.0001)
    assertEquals(-1.0, telemetry.roll, 0.0001)
    assertEquals(42.0, telemetry.tempMosfet!!, 0.0001)
    assertEquals(51.0, telemetry.tempMotor!!, 0.0001)
    assertEquals(300, telemetry.erpm)
    assertEquals(1609.344, telemetry.odometer!!, 0.0001)
    assertEquals(1234L, telemetry.lastPacketAt)
    assertFalse(telemetry.hasFault)
  }

  @Test
  fun `uses neutral defaults for channels OneWheel does not expose`() {
    val telemetry = OwFrame(atMs = 1L, faultCode = 7).toRefloatTelemetry()

    assertEquals(0.0, telemetry.dutyCycle, 0.0001)
    assertEquals(0.0, telemetry.motorCurrent, 0.0001)
    assertEquals(0.0, telemetry.adc1, 0.0001)
    assertEquals(0.0, telemetry.adc2, 0.0001)
    assertTrue(telemetry.hasFault)
    assertEquals(7, telemetry.faultCode)
  }

  @Test
  fun `converts lifetime miles to meters`() {
    assertEquals(16093.44, owLifetimeMilesToMeters(10), 0.0001)
  }

  @Test
  fun `uses every mapped live channel to refresh the complete telemetry frame`() {
    assertTrue(shouldScheduleOwTelemetryFrame(OwPhase.Ready, OW_CHAR_RPM))
    assertTrue(shouldScheduleOwTelemetryFrame(OwPhase.Ready, OW_CHAR_BATTERY))
    assertTrue(shouldScheduleOwTelemetryFrame(OwPhase.Ready, 0xf307))
    assertFalse(shouldScheduleOwTelemetryFrame(OwPhase.Ready, OW_CHAR_FIRMWARE))
    assertFalse(shouldScheduleOwTelemetryFrame(OwPhase.Unlocking, OW_CHAR_RPM))
  }

  @Test
  fun `bounds keep alive GATT busy retries`() {
    assertTrue(shouldRetryOwKeepAliveStart(0))
    assertTrue(shouldRetryOwKeepAliveStart(4))
    assertFalse(shouldRetryOwKeepAliveStart(5))
  }
}
