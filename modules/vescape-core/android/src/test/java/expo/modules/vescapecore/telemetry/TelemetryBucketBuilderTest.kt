package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TelemetryBucketBuilderTest {
  /**
   * The two streams are independent now, so a board dropout produces a minute of Ride Track fixes
   * and no telemetry frame at all — the exact case the durable track exists for. That minute owns a
   * bucket of its own; discarding it would erase the route, the GPS distance and the history entry.
   */
  @Test
  fun buildsABucketForAMinuteThatOnlyHasTrackFixes() {
    val buckets = buildTelemetryBuckets(
      telemetryPoints = emptyList(),
      locationPoints = listOf(
        BucketLocationPoint(
          capturedAtMs = 120_500L,
          boardId = "board-1",
          recordingId = "recording-1",
          precise = true,
          distanceFromPreviousCm = null,
          gpsSpeedCentiMps = 900,
          latitudeE7 = 500_000_000,
          longitudeE7 = 190_000_000,
        ),
        BucketLocationPoint(
          capturedAtMs = 130_000L,
          boardId = "board-1",
          recordingId = "recording-1",
          precise = true,
          distanceFromPreviousCm = 4_200L,
          gpsSpeedCentiMps = 1_100,
          latitudeE7 = 500_010_000,
          longitudeE7 = 190_000_000,
        ),
      ),
    )

    val bucket = buckets.single()
    assertEquals(120_000L, bucket.bucketStartMs)
    assertEquals("recording-1", bucket.recordingId)
    assertEquals(0, bucket.sampleCount)
    assertEquals(2, bucket.gpsPointCount)
    assertEquals(2, bucket.preciseGpsPointCount)
    assertEquals(4_200L, bucket.gpsDistanceCm)
    assertEquals(120_500L, bucket.firstSampleAtMs)
    assertEquals(130_000L, bucket.lastSampleAtMs)
    assertEquals(500_000_000, bucket.firstLatitudeE7)
  }

  @Test
  fun combinesBoardAndGpsPointsForSameDeviceMinute() {
    val buckets = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 125_000L,
          boardId = "board-1",
          speedCentiKmh = -1_200,
          batteryVoltageMv = 77_500,
          motorCurrentMa = -2_500,
          batteryCurrentMa = 1_200,
          dutyPermille = -300,
            odometerCm = 10_000L,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 130_000L,
          boardId = "board-1",
          speedCentiKmh = 1_600,
          batteryVoltageMv = 77_100,
          motorCurrentMa = 3_500,
          batteryCurrentMa = -1_400,
          dutyPermille = 350,
          odometerCm = 10_420L,
        ),
      ),
      locationPoints = listOf(
        BucketLocationPoint(
          capturedAtMs = 131_000L,
          boardId = "board-1",
          precise = true,
          distanceFromPreviousCm = 230L,
          gpsSpeedCentiMps = 1_250,
        ),
        BucketLocationPoint(
          capturedAtMs = 132_000L,
          boardId = "board-1",
          precise = false,
          distanceFromPreviousCm = null,
          gpsSpeedCentiMps = 900,
        ),
      ),
    ).single()

    assertEquals(120_000L, buckets.bucketStartMs)
    assertEquals("board-1", buckets.boardId)
    assertEquals(2, buckets.sampleCount)
    assertEquals(2, buckets.gpsPointCount)
    assertEquals(1, buckets.preciseGpsPointCount)
    assertEquals(2_800L, buckets.sumAbsSpeedCentiKmh)
    assertEquals(2, buckets.movingSpeedSampleCount)
    assertEquals(2_800L, buckets.sumMovingAbsSpeedCentiKmh)
    assertEquals(1_600, buckets.maxAbsSpeedCentiKmh)
    assertEquals(77_100, buckets.minBatteryVoltageMv)
    assertEquals(3_500, buckets.maxMotorCurrentAbsMa)
    assertEquals(1_400, buckets.maxBatteryCurrentAbsMa)
    assertEquals(129L, buckets.batteryUsedWhMilli)
    assertEquals(0L, buckets.batteryRegenWhMilli)
    assertEquals(350, buckets.maxDutyAbsPermille)
    assertEquals(10_000L, buckets.firstOdometerCm)
    assertEquals(10_420L, buckets.lastOdometerCm)
    assertEquals(230L, buckets.gpsDistanceCm)
    assertEquals(1_250, buckets.maxGpsSpeedCentiMps)
  }

  /** An unattributed fix still owns a minute; `board_id` just falls back to the stand-in id. */
  @Test
  fun bucketsGpsOnlyPointsThatMatchNoBoard() {
    val buckets = buildTelemetryBuckets(
      telemetryPoints = emptyList(),
      locationPoints = listOf(
        BucketLocationPoint(
          capturedAtMs = 65_000L,
          boardId = null,
          precise = true,
          distanceFromPreviousCm = null,
          gpsSpeedCentiMps = null,
        ),
      ),
    )

    val bucket = buckets.single()
    assertEquals(60_000L, bucket.bucketStartMs)
    assertEquals(UNKNOWN_TELEMETRY_BOARD_ID, bucket.boardId)
    assertEquals(0, bucket.sampleCount)
    assertEquals(1, bucket.gpsPointCount)
  }

  @Test
  fun splitsDifferentDevicesAndMinutes() {
    val buckets = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 10_000L,
          boardId = "a",
          speedCentiKmh = 100,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 70_000L,
          boardId = "a",
          speedCentiKmh = 200,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 10_000L,
          boardId = "b",
          speedCentiKmh = 300,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
        ),
      ),
      locationPoints = emptyList(),
    )

    assertEquals(setOf(0L to "a", 60_000L to "a", 0L to "b"), buckets.map {
      it.bucketStartMs to it.boardId
    }.toSet())
  }

  @Test
  fun tracksMovingSpeedSamplesUsingExclusionFlag() {
    val bucket = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 0L,
          boardId = "board-1",
          speedCentiKmh = 499,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
          excludedFromAvgSpeed = true,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 1_000L,
          boardId = "board-1",
          speedCentiKmh = -500,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
          excludedFromAvgSpeed = false,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 2_000L,
          boardId = "board-1",
          speedCentiKmh = 1_200,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
          excludedFromAvgSpeed = false,
        ),
      ),
      locationPoints = emptyList(),
    ).single()

    assertEquals(2, bucket.movingSpeedSampleCount)
    assertEquals(1_700L, bucket.sumMovingAbsSpeedCentiKmh)
    // Moving Window spans only the non-excluded samples (1_000–2_000), not the leading excluded one.
    assertEquals(1_000L, bucket.firstMovingAtMs)
    assertEquals(2_000L, bucket.lastMovingAtMs)
  }

  @Test
  fun leavesMovingWindowNullWhenNoSampleIsMoving() {
    val bucket = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 0L,
          boardId = "board-1",
          speedCentiKmh = 100,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = null,
          excludedFromAvgSpeed = true,
        ),
      ),
      locationPoints = emptyList(),
    ).single()

    assertEquals(0, bucket.movingSpeedSampleCount)
    assertNull(bucket.firstMovingAtMs)
    assertNull(bucket.lastMovingAtMs)
  }

  /**
   * The board dropped mid-ride and the phone kept moving: the Moving Window has to follow the GPS,
   * or the seek timeline and Time stop at the last telemetry frame (ADR 0017, ADR 0038).
   */
  @Test
  fun extendsMovingWindowThroughGpsOnlyMovement() {
    val bucket = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 1_000L,
          boardId = "board-1",
          recordingId = "recording-1",
          speedCentiKmh = 1_200,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
          odometerCm = null,
          excludedFromAvgSpeed = false,
        ),
      ),
      locationPoints = listOf(
        locationPoint(capturedAtMs = 20_000L, moving = true),
        locationPoint(capturedAtMs = 30_000L, moving = false),
      ),
    ).single()

    assertEquals(1_000L, bucket.firstMovingAtMs)
    assertEquals("GPS movement widens the window past the last frame", 20_000L, bucket.lastMovingAtMs)
    assertEquals("but never counts as a Telemetry Sample", 1, bucket.sampleCount)
    assertEquals(1, bucket.movingSpeedSampleCount)
  }

  private fun locationPoint(capturedAtMs: Long, moving: Boolean) = BucketLocationPoint(
    capturedAtMs = capturedAtMs,
    boardId = "board-1",
    recordingId = "recording-1",
    precise = true,
    moving = moving,
    distanceFromPreviousCm = null,
    gpsSpeedCentiMps = null,
    latitudeE7 = 500_000_000,
    longitudeE7 = 190_000_000,
  )

  @Test
  fun integratesBatteryUsedAndRegenInsideMinuteBucket() {
    val bucket = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 0L,
          boardId = "board-1",
          speedCentiKmh = 0,
          batteryVoltageMv = 50_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 10_000,
          dutyPermille = 0,
            odometerCm = 0L,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 3_600L,
          boardId = "board-1",
          speedCentiKmh = 0,
          batteryVoltageMv = 50_000,
          motorCurrentMa = 0,
          batteryCurrentMa = -5_000,
          dutyPermille = 0,
            odometerCm = 10L,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 7_200L,
          boardId = "board-1",
          speedCentiKmh = 0,
          batteryVoltageMv = 50_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 0,
            odometerCm = 20L,
        ),
      ),
      locationPoints = emptyList(),
    ).single()

    assertEquals(500L, bucket.batteryUsedWhMilli)
    assertEquals(250L, bucket.batteryRegenWhMilli)
  }

  @Test
  fun excludedFromMaxSpeedSkipsSampleForMaxSpeed() {
    val bucket = buildTelemetryBuckets(
      telemetryPoints = listOf(
        BucketTelemetryPoint(
          capturedAtMs = 0L,
          boardId = "board-1",
          speedCentiKmh = 5000,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 900,
            odometerCm = null,
          excludedFromMaxSpeed = true,
          excludedFromMaxDuty = true,
        ),
        BucketTelemetryPoint(
          capturedAtMs = 1_000L,
          boardId = "board-1",
          speedCentiKmh = 2000,
          batteryVoltageMv = 70_000,
          motorCurrentMa = 0,
          batteryCurrentMa = 0,
          dutyPermille = 400,
            odometerCm = null,
        ),
      ),
      locationPoints = emptyList(),
    ).single()

    assertEquals(2000, bucket.maxAbsSpeedCentiKmh)
    assertEquals(400, bucket.maxDutyAbsPermille)
  }
}
