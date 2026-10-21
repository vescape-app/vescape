package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.RIDE_TRACK_PRECISE_ACCURACY_CM
import expo.modules.vescapecore.telemetry.RideTrackPointEntity
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
      gpsAccuracyCm = RIDE_TRACK_PRECISE_ACCURACY_CM + 1,
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
    val context = contextFor(points)

    val result = FreeSpinMetricSanitizer(maxSpeedDeltaCentiKmh = 1200, stationaryBoardCapCentiKmh = 1500).sanitize(1, points[1].point, context)

    assertTrue(result.excludedFromMaxSpeed)
    assertEquals(EXCLUSION_REASON_FREE_SPIN, result.exclusions.single().reason)
  }

  /**
   * A multi-Board track interleaves fixes, so the nearest same-Board fix can sit well past the
   * immediate neighbours of the binary-search landing index.
   */
  @Test
  fun findsASameBoardFixBehindOtherBoardsFixes() {
    val captured = pointWithGps(
      capturedAtMs = 5_000L,
      speedCentiKmh = 5000,
      gpsSpeedCentiMps = 100,
      gpsTimestampMs = 1_000L,
    )
    val otherBoardFixes = listOf(2_000L, 3_000L, 4_000L, 4_500L).map { fixAtMs ->
      pointWithGps(
        deviceId = "board-2",
        gpsSpeedCentiMps = 100,
        gpsTimestampMs = fixAtMs,
      )
    }
    val context = contextFor(listOf(captured) + otherBoardFixes)

    val result = FreeSpinMetricSanitizer(maxSpeedDeltaCentiKmh = 1200, stationaryBoardCapCentiKmh = 1500)
      .sanitize(0, captured.point, context)

    assertTrue(result.excludedFromMaxSpeed)
  }

  private fun sanitize(captured: Captured): MetricSanitizerOutput =
    FreeSpinMetricSanitizer(maxSpeedDeltaCentiKmh = 1200, stationaryBoardCapCentiKmh = 1500)
      .sanitize(0, captured.point, contextFor(listOf(captured)))

  private fun contextFor(captured: List<Captured>) = MetricSanitizationContext(
    samples = captured.map { it.point },
    track = preciseGpsTrack(captured.mapNotNull { it.fix }.sortedBy { it.fixAtMs }),
  )

  /** A sample paired with the Ride Track fix that was current when it was captured. */
  private data class Captured(
    val point: BucketTelemetryPoint,
    val fix: RideTrackPointEntity? = null,
  )

  private fun point(
    capturedAtMs: Long = 0L,
    deviceId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
  ) = Captured(
    BucketTelemetryPoint(
      capturedAtMs = capturedAtMs,
      boardId = deviceId,
      speedCentiKmh = speedCentiKmh,
      batteryVoltageMv = 70_000,
      motorCurrentMa = 0,
      batteryCurrentMa = 0,
      dutyPermille = dutyPermille,
      odometerCm = null,
    ),
  )

  private fun pointWithGps(
    capturedAtMs: Long = 0L,
    deviceId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
    gpsSpeedCentiMps: Int,
    gpsTimestampMs: Long,
    gpsAccuracyCm: Int = 500,
  ) = Captured(
    point(capturedAtMs, deviceId, speedCentiKmh, dutyPermille).point,
    RideTrackPointEntity(
      recordingId = "recording-1",
      boardId = deviceId,
      fixAtMs = gpsTimestampMs,
      latitudeE7 = 500_000_000,
      longitudeE7 = 190_000_000,
      accuracyCm = gpsAccuracyCm,
      gpsSpeedCentiMps = gpsSpeedCentiMps,
      bearingCentiDeg = null,
      altitudeCm = null,
    ),
  )
}
