package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.FREE_SPIN_GPS_PRECISE_ACCURACY_CM
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FreeSpinMetricSanitizerTest {
  @Test
  fun excludesMaxSpeedAndDutyWhenLowGpsAndHighBoardSpeed() {
    val point = pointWithGps(
      capturedAtMs = 1000L,
      speedCentiKmh = 1600,
      dutyPermille = 800,
      gpsSpeedCentiMps = 100,
      gpsTimestampMs = 1000L,
    )

    val result = sanitize(point)

    assertTrue(result.excludedFromMaxSpeed)
    assertTrue(result.excludedFromMaxDuty)
    assertFalse(result.excludedFromAvgSpeed)
    assertEquals(1, result.exclusions.size)
    assertEquals(EXCLUSION_REASON_FREE_SPIN, result.exclusions.single().reason)
    assertEquals(1000L, result.exclusions.single().capturedAtMs)
  }

  @Test
  fun keepsSampleWhenDeltaAtThreshold() {
    val point = pointWithGps(
      capturedAtMs = 1000L,
      speedCentiKmh = 3698,
      gpsSpeedCentiMps = 694,
      gpsTimestampMs = 1000L,
    )

    val result = sanitize(point)

    assertFalse(result.excludedFromMaxSpeed)
    assertFalse(result.excludedFromMaxDuty)
    assertTrue(result.exclusions.isEmpty())
  }

  @Test
  fun ignoresImpreciseGps() {
    val point = pointWithGps(
      capturedAtMs = 1000L,
      speedCentiKmh = 5000,
      gpsSpeedCentiMps = 100,
      gpsTimestampMs = 1000L,
      gpsAccuracyCm = FREE_SPIN_GPS_PRECISE_ACCURACY_CM + 1,
    )

    val result = sanitize(point)

    assertFalse(result.excludedFromMaxSpeed)
    assertTrue(result.exclusions.isEmpty())
  }

  @Test
  fun usesNearestPreciseGpsFromNeighboringSample() {
    val points = listOf(
      pointWithGps(
        capturedAtMs = 1000L,
        speedCentiKmh = 1000,
        gpsSpeedCentiMps = 100,
        gpsTimestampMs = 1000L,
      ),
      point(capturedAtMs = 3000L, speedCentiKmh = 5000),
    )
    val context = MetricSanitizationContext(
      samples = points,
      preciseGpsIndices = buildPreciseGpsIndex(points),
    )

    val result = FreeSpinMetricSanitizer(maxSpeedDeltaCentiKmh = 1200, stationaryBoardCapCentiKmh = 1500).sanitize(1, points[1], context)

    assertTrue(result.excludedFromMaxSpeed)
    assertEquals(EXCLUSION_REASON_FREE_SPIN, result.exclusions.single().reason)
  }

  private fun sanitize(point: BucketTelemetryPoint): MetricSanitizerOutput {
    val context = MetricSanitizationContext(
      samples = listOf(point),
      preciseGpsIndices = buildPreciseGpsIndex(listOf(point)),
    )
    return FreeSpinMetricSanitizer(maxSpeedDeltaCentiKmh = 1200, stationaryBoardCapCentiKmh = 1500).sanitize(0, point, context)
  }

  private fun point(
    capturedAtMs: Long = 0L,
    deviceId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = deviceId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = dutyPermille,
    odometerCm = null,
  )

  private fun pointWithGps(
    capturedAtMs: Long = 0L,
    deviceId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
    gpsSpeedCentiMps: Int,
    gpsTimestampMs: Long,
    gpsAccuracyCm: Int = 500,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = deviceId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = dutyPermille,
    odometerCm = null,
    gpsSpeedCentiMps = gpsSpeedCentiMps,
    gpsTimestampMs = gpsTimestampMs,
    gpsAccuracyCm = gpsAccuracyCm,
  )
}
