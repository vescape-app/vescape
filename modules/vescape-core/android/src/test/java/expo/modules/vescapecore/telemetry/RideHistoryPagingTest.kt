package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Test

class RideHistoryPagingTest {
  private val gapMs = 30 * 60_000L
  private val base = 1_714_521_600_000L

  /** Buckets page newest-first, so only the oldest ride in the window may still grow backwards. */
  @Test
  fun keepsTheRideBeingRecordedAndDropsTheOldestUnfinishedOne() {
    val buckets = listOf(
      bucket(start = base, end = base + 60_000L),
      bucket(start = base + 60_000L, end = base + 120_000L),
      bucket(start = base + 3 * 3_600_000L, end = base + 3 * 3_600_000L + 60_000L),
      bucket(start = base + 6 * 3_600_000L, end = base + 6 * 3_600_000L + 60_000L),
    )

    val grouped = groupRideSessions(buckets, emptyList(), gapMs)
    assertEquals(3, grouped.size)

    val complete = completeRideSessions(grouped, hasOlderBuckets = true)

    assertEquals(2, complete.size)
    assertEquals(base + 3 * 3_600_000L, complete.first().startAtMs)
    assertEquals(base + 6 * 3_600_000L, complete.last().startAtMs)
  }

  @Test
  fun keepsEveryRideOnceTheOldestBucketIsReached() {
    val buckets = listOf(
      bucket(start = base, end = base + 60_000L),
      bucket(start = base + 3 * 3_600_000L, end = base + 3 * 3_600_000L + 60_000L),
    )

    val complete = completeRideSessions(
      groupRideSessions(buckets, emptyList(), gapMs),
      hasOlderBuckets = false,
    )

    assertEquals(2, complete.size)
    assertEquals(base, complete.first().startAtMs)
  }

  private fun bucket(start: Long, end: Long) = TelemetryMinuteBucketEntity(
    bucketStartMs = start - (start % TELEMETRY_BUCKET_SIZE_MS),
    boardId = "board-1",
    sampleCount = 1,
    firstSampleAtMs = start,
    lastSampleAtMs = end,
    sumAbsSpeedCentiKmh = 1_000L,
    movingSpeedSampleCount = 1,
    sumMovingAbsSpeedCentiKmh = 1_000L,
    maxAbsSpeedCentiKmh = 1_000,
    minBatteryVoltageMv = 50_000,
    maxMotorCurrentAbsMa = 0,
    maxBatteryCurrentAbsMa = 0,
    batteryUsedWhMilli = 0L,
    batteryRegenWhMilli = 0L,
    maxDutyAbsPermille = 0,
    firstOdometerCm = 0L,
    lastOdometerCm = 1_000L,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = 0L,
    maxGpsSpeedCentiMps = 0,
    firstMovingAtMs = start,
    lastMovingAtMs = end,
    firstLatitudeE7 = null,
    firstLongitudeE7 = null,
  )
}
