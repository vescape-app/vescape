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

  /** A minute with GPS fixes and no Telemetry Sample: the shape a board dropout leaves behind. */
  @Test
  fun gpsOnlyMinutesExtendTheMovingWindowAndTheRide() {
    val buckets = listOf(
      bucket(start = base, end = base + 30_000L),
      trackOnlyBucket(start = base + 5 * 60_000L, end = base + 5 * 60_000L + 30_000L),
      bucket(start = base + 10 * 60_000L, end = base + 10 * 60_000L + 30_000L),
    )

    val session = groupRideSessions(buckets, emptyList(), gapMs).single()

    assertEquals(base, session.movingStartAtMs)
    assertEquals(base + 10 * 60_000L + 30_000L, session.movingEndAtMs)
    assertEquals(base + 10 * 60_000L + 30_000L, session.endAtMs)
    // The track-only minute widens the window without pretending it held Telemetry Samples.
    assertEquals(2, session.sampleCount)
    assertEquals(2, session.avgSpeedSampleCount)
  }

  /** A recording is the entry: a dropout inside it never splits, however long it runs. */
  @Test
  fun oneRecordingSpanningAnHourWithoutEitherStreamStaysOneEntry() {
    val buckets = listOf(
      bucket(start = base, end = base + 30_000L, recordingId = "recording-1"),
      bucket(
        start = base + 3_600_000L,
        end = base + 3_600_000L + 30_000L,
        recordingId = "recording-1",
      ),
    )

    val grouped = groupRideSessions(buckets, emptyList(), gapMs)

    assertEquals(1, grouped.size)
    assertEquals(base + 3_600_000L + 30_000L, grouped.single().endAtMs)
  }

  /** Stop then start again inside one minute: two recordings, two entries. */
  @Test
  fun separateRecordingsInsideOneMinuteStaySeparateEntries() {
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L, recordingId = "recording-1"),
      bucket(start = base + 20_000L, end = base + 30_000L, recordingId = "recording-2"),
    )

    val grouped = groupRideSessions(buckets, emptyList(), gapMs)

    assertEquals(2, grouped.size)
    assertEquals(listOf("recording-1", "recording-2"), grouped.map { it.recordingId })
  }

  /** A disconnect mid-recording is informational; it does not end the recording. */
  @Test
  fun aBreakMarkerInsideOneRecordingDoesNotSplitIt() {
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L, recordingId = "recording-1"),
      bucket(start = base + 60_000L, end = base + 70_000L, recordingId = "recording-1"),
    )
    val markers = listOf(
      TelemetryMarkerEntity(
        occurredAtMs = base + 60_000L,
        elapsedRealtimeMs = 0L,
        type = "disconnected",
        boardId = "board-1",
        message = null,
        gapMs = null,
      ),
    )

    assertEquals(1, groupRideSessions(buckets, markers, gapMs).size)
  }

  /** Legacy rows have no recording identity, so they still split on `rideSplitGapMinutes`. */
  @Test
  fun legacyRowsStillGroupOnTheSplitGap() {
    val buckets = listOf(
      bucket(start = base, end = base + 30_000L),
      bucket(start = base + 3_600_000L, end = base + 3_600_000L + 30_000L),
    )

    assertEquals(2, groupRideSessions(buckets, emptyList(), gapMs).size)
    assertEquals(1, groupRideSessions(buckets, emptyList(), 2 * 3_600_000L).size)
  }

  private fun trackOnlyBucket(start: Long, end: Long) = bucket(start, end).copy(
    sampleCount = 0,
    sumAbsSpeedCentiKmh = 0L,
    movingSpeedSampleCount = 0,
    sumMovingAbsSpeedCentiKmh = 0L,
    maxAbsSpeedCentiKmh = 0,
    minBatteryVoltageMv = null,
    firstOdometerCm = null,
    lastOdometerCm = null,
    gpsPointCount = 2,
    preciseGpsPointCount = 2,
  )

  private fun bucket(start: Long, end: Long, recordingId: String = LEGACY_RIDE_RECORDING_ID) = TelemetryMinuteBucketEntity(
    bucketStartMs = start - (start % TELEMETRY_BUCKET_SIZE_MS),
    boardId = "board-1",
    recordingId = recordingId,
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
