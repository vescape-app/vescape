package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Test

class HistoryGpsProjectionTest {
  @Test
  fun projectsGpsOnlyFromTelemetrySamples() {
    val samples = listOf(
      sample(1L, 1_000L, null),
      sample(2L, 2_000L, location(2_000L, latitudeE7 = 500_000_000)),
      sample(3L, 3_000L, location(2_000L, latitudeE7 = 500_000_000)),
      sample(4L, 4_000L, location(4_000L, latitudeE7 = 500_001_000)),
    )

    val points = samples.toHistoryGpsPoints()

    assertEquals(listOf(2L, 4L), points.map { it.sample.id })
    assertEquals(2_000L, points[0].location.timestampMs)
    assertEquals(4_000L, points[1].location.timestampMs)
  }

  @Test
  fun mapsSameProjectionToRangeAndBucketPayloads() {
    val samples = listOf(
      sample(
        id = 7L,
        capturedAtMs = 10_000L,
        location = location(
          timestampMs = 9_900L,
          latitudeE7 = 500_000_000,
          longitudeE7 = 190_000_000,
          gpsSpeedCentiMps = 500,
        ),
      ),
    )

    val gpsSample = samples.toGpsSampleMaps(mapOf("board-1" to "ADV2")).single()
    val bucketPoint = samples.toBucketLocationPoints().single()

    assertEquals(7L, gpsSample["id"])
    assertEquals(50.0, gpsSample["latitude"] as Double, 0.0)
    assertEquals(5.0, gpsSample["speedMps"] as Double, 0.0)
    assertEquals(10_000L, bucketPoint.capturedAtMs)
    assertEquals(500, bucketPoint.gpsSpeedCentiMps)
  }

  private fun sample(id: Long, capturedAtMs: Long, location: ScaledLocation?): HistoryTelemetryState =
    HistoryTelemetryState(
      id = id,
      state = FullTelemetryState(
        capturedAtMs = capturedAtMs,
        elapsedRealtimeMs = capturedAtMs,
        boardId = "board-1",
        canId = null,
        speedCentiKmh = 1_000,
        batteryVoltageMv = 77_000,
        motorCurrentMa = 0,
        batteryCurrentMa = 0,
        dutyPermille = 0,
        pitchCentiDeg = 0,
        rollCentiDeg = 0,
        balancePitchCentiDeg = 0,
        balanceCurrentMa = 0,
        erpm = 0,
        state = 0,
        switchState = 0,
        adc1Milli = 0,
        adc2Milli = 0,
        odometerCm = null,
        tempMosfetDeciC = null,
        tempMotorDeciC = null,
        location = location,
      ),
    )

  private fun location(
    timestampMs: Long,
    latitudeE7: Int,
    longitudeE7: Int = 190_000_000,
    gpsSpeedCentiMps: Int? = null,
  ): ScaledLocation =
    ScaledLocation(
      latitudeE7 = latitudeE7,
      longitudeE7 = longitudeE7,
      gpsSpeedCentiMps = gpsSpeedCentiMps,
      bearingCentiDeg = null,
      accuracyCm = null,
      altitudeCm = null,
      timestampMs = timestampMs,
    )
}
