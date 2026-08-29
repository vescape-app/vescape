package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_LOW_SPEED
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_DEVICE_ID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LowSpeedAverageSpeedSanitizerTest {
  @Test
  fun excludesSampleBelowThreshold() {
    val point = point(capturedAtMs = 1000L, speedCentiKmh = 299)

    val result = LowSpeedAverageSpeedSanitizer(300).sanitize(
      index = 0,
      point = point,
      context = contextFor(point),
    )

    assertTrue(result.excludedFromAvgSpeed)
    assertFalse(result.excludedFromMaxSpeed)
    assertFalse(result.excludedFromMaxDuty)
    assertEquals(1, result.exclusions.size)
    assertEquals(EXCLUSION_REASON_LOW_SPEED, result.exclusions.single().reason)
    assertEquals(1000L, result.exclusions.single().capturedAtMs)
  }

  @Test
  fun keepsSampleAtThreshold() {
    val point = point(speedCentiKmh = 300)

    val result = LowSpeedAverageSpeedSanitizer(300).sanitize(
      index = 0,
      point = point,
      context = contextFor(point),
    )

    assertFalse(result.excludedFromAvgSpeed)
    assertTrue(result.exclusions.isEmpty())
  }

  @Test
  fun usesAbsoluteSpeedAndUnknownDeviceFallback() {
    val point = point(deviceId = null, speedCentiKmh = -200)

    val result = LowSpeedAverageSpeedSanitizer(300).sanitize(
      index = 0,
      point = point,
      context = contextFor(point),
    )

    assertTrue(result.excludedFromAvgSpeed)
    assertEquals(UNKNOWN_TELEMETRY_DEVICE_ID, result.exclusions.single().deviceId)
    assertEquals(EXCLUSION_REASON_LOW_SPEED, result.exclusions.single().reason)
  }

  private fun contextFor(vararg points: BucketTelemetryPoint) = MetricSanitizationContext(
    samples = points.toList(),
    preciseGpsIndices = emptyList(),
  )

  private fun point(
    capturedAtMs: Long = 0L,
    deviceId: String? = "board-1",
    speedCentiKmh: Int = 0,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    deviceId = deviceId,
    deviceName = "Test",
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = 0,
    odometerCm = null,
  )
}
