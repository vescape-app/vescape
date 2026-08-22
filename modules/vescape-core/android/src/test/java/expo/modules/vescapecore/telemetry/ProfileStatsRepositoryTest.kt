package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId

class ProfileStatsRepositoryTest {
  private val utc = ZoneId.of("UTC")

  @Test
  fun returnsEmptyStatsForNoBuckets() {
    val result = computeProfileStatsForBuckets(emptyList(), emptyList(), month = null, zoneId = utc)

    assertNull(result["distanceM"])
    assertEquals(0, result["rideCount"])
    assertEquals(0L, result["rideTimeMs"])
    assertEquals(0.0, result["topSpeedKmh"])
    assertEquals(0.0, result["avgSpeedKmh"])
    assertNull(result["longestRideM"])
    assertNull(result["batteryUsedWh"])
    assertNull(result["batteryRegenWh"])
  }

  @Test
  fun aggregatesTotalStatsFromBoardBucketsOnly() {
    val buckets = listOf(
      bucket(start = 1_714_521_600_000L, end = 1_714_521_660_000L, firstOdo = 100_000L, lastOdo = 112_000L, maxSpeed = 2_500, avgSpeed = 1_000, avgSpeedSamples = null, avgSpeedSum = null, used = 1_500L, regen = 100L),
      bucket(start = 1_714_521_660_001L, end = 1_714_521_720_000L, firstOdo = 112_000L, lastOdo = 120_000L, maxSpeed = 3_500, avgSpeed = 2_000, avgSpeedSamples = null, avgSpeedSum = null, used = 2_500L, regen = 300L),
    )

    val result = computeProfileStatsForBuckets(buckets, emptyList(), month = null, zoneId = utc)

    assertEquals(200.0, result["distanceM"] as Double, 0.0001)
    assertEquals(1, result["rideCount"])
    assertEquals(120_000L, result["rideTimeMs"])
    assertEquals(35.0, result["topSpeedKmh"] as Double, 0.0001)
    assertEquals(15.0, result["avgSpeedKmh"] as Double, 0.01)
    assertEquals(200.0, result["longestRideM"] as Double, 0.0001)
    assertEquals(4.0, result["batteryUsedWh"] as Double, 0.0001)
    assertEquals(0.4, result["batteryRegenWh"] as Double, 0.0001)
  }

  @Test
  fun avgSpeedUsesPrecomputedCutoffAwareSamplesWhenAvailable() {
    val buckets = listOf(
      bucket(start = 1_714_521_600_000L, end = 1_714_521_660_000L, firstOdo = 0L, lastOdo = 10_000L, avgSpeed = 400, avgSpeedSamples = 0, avgSpeedSum = 0L),
      bucket(start = 1_714_521_660_001L, end = 1_714_521_720_000L, firstOdo = 10_000L, lastOdo = 20_000L, avgSpeed = 1_000, avgSpeedSamples = 2, avgSpeedSum = 3_000L),
    )

    val result = computeProfileStatsForBuckets(buckets, emptyList(), month = null, zoneId = utc)

    assertEquals(15.0, result["avgSpeedKmh"] as Double, 0.0001)
  }

  @Test
  fun splitsSessionsByGapAndFiltersByCalendarMonth() {
    val may = ProfileStatsMonth(year = 2024, month = 5)
    val buckets = listOf(
      bucket(start = 1_714_521_600_000L, end = 1_714_521_660_000L, firstOdo = 0L, lastOdo = 10_000L),
      // 40 min after the first bucket ends — past the 30 min default split gap.
      bucket(start = 1_714_524_060_000L, end = 1_714_524_120_000L, firstOdo = 10_000L, lastOdo = 15_000L),
      bucket(start = 1_717_459_200_000L, end = 1_717_459_260_000L, firstOdo = 0L, lastOdo = 9_000L),
    )

    val mayStats = computeProfileStatsForBuckets(buckets, emptyList(), month = may, zoneId = utc)
    val months = computeProfileStatMonthsForBuckets(buckets, emptyList(), zoneId = utc)

    assertEquals(2, mayStats["rideCount"])
    assertEquals(150.0, mayStats["distanceM"] as Double, 0.0001)
    assertEquals(listOf(ProfileStatsMonth(2024, 6), ProfileStatsMonth(2024, 5)), months)
  }

  @Test
  fun hidesSessionsWithNoMovingSamples() {
    val buckets = listOf(
      bucket(start = 1_714_521_600_000L, end = 1_714_521_660_000L, firstOdo = 0L, lastOdo = 0L, avgSpeedSamples = 0, avgSpeedSum = 0L),
    )

    val result = computeProfileStatsForBuckets(buckets, emptyList(), month = null, zoneId = utc)

    assertEquals(0, result["rideCount"])
    assertEquals(0L, result["rideTimeMs"])
    assertEquals(emptyList<ProfileStatsMonth>(), computeProfileStatMonthsForBuckets(buckets, emptyList(), zoneId = utc))
  }

  @Test
  fun rideTimeUsesMovingWindowNotWallClock() {
    // 120s wall-clock, but movement only spans 30s → ride time is the Moving Window.
    val buckets = listOf(
      bucket(start = 1_714_521_600_000L, end = 1_714_521_660_000L, firstOdo = 0L, lastOdo = 5_000L, avgSpeedSamples = 1, firstMoving = 1_714_521_630_000L, lastMoving = 1_714_521_660_000L),
      bucket(start = 1_714_521_660_001L, end = 1_714_521_720_000L, firstOdo = 5_000L, lastOdo = 6_000L, avgSpeedSamples = 0, avgSpeedSum = 0L),
    )

    val result = computeProfileStatsForBuckets(buckets, emptyList(), month = null, zoneId = utc)

    assertEquals(1, result["rideCount"])
    assertEquals(30_000L, result["rideTimeMs"])
  }

  @Test
  fun ridesSplitOnlyWhenTheStopExceedsTheRideSplitGap() {
    val start = 1_714_521_600_000L
    val buckets = listOf(
      bucket(start = start, end = start + 60_000L, firstOdo = 0L, lastOdo = 10_000L),
      // ~11.5 min stop: one ride at the 30 min default, two when the rider tightens it to 5 min.
      bucket(start = start + 756_000L, end = start + 816_000L, firstOdo = 10_000L, lastOdo = 20_000L),
    )

    val default = computeProfileStatsForBuckets(buckets, emptyList(), month = null, zoneId = utc)
    val tightened = computeProfileStatsForBuckets(
      buckets,
      emptyList(),
      month = null,
      zoneId = utc,
      gapMs = 5 * 60_000L,
    )

    assertEquals(1, default["rideCount"])
    assertEquals(2, tightened["rideCount"])
  }

  private fun bucket(
    start: Long,
    end: Long,
    firstOdo: Long?,
    lastOdo: Long?,
    maxSpeed: Int = 1_000,
    avgSpeed: Int = 1_000,
    avgSpeedSamples: Int? = 1,
    avgSpeedSum: Long? = avgSpeed.toLong(),
    used: Long = 0L,
    regen: Long = 0L,
    firstMoving: Long? = null,
    lastMoving: Long? = null,
  ) = TelemetryMinuteBucketEntity(
    bucketStartMs = start - (start % TELEMETRY_BUCKET_SIZE_MS),
    boardId = "board-1",
    sampleCount = 1,
    firstSampleAtMs = start,
    lastSampleAtMs = end,
    sumAbsSpeedCentiKmh = avgSpeed.toLong(),
    movingSpeedSampleCount = avgSpeedSamples,
    sumMovingAbsSpeedCentiKmh = avgSpeedSum,
    maxAbsSpeedCentiKmh = maxSpeed,
    minBatteryVoltageMv = 50_000,
    maxMotorCurrentAbsMa = 0,
    maxBatteryCurrentAbsMa = 0,
    batteryUsedWhMilli = used,
    batteryRegenWhMilli = regen,
    maxDutyAbsPermille = 0,
    faultCount = 0,
    firstOdometerCm = firstOdo,
    lastOdometerCm = lastOdo,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = 999_999L,
    maxGpsSpeedCentiMps = 9_999,
    firstMovingAtMs = firstMoving,
    lastMovingAtMs = lastMoving,
    updatedAt = end,
  )
}
