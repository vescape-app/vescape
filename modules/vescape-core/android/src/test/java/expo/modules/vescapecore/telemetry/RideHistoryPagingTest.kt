package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Test
import expo.modules.vescapecore.database.RECORDING_STOP_MARKER
import expo.modules.vescapecore.database.TelemetryMarkerEntity
import expo.modules.vescapecore.database.TelemetryMinuteBucketEntity

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

  /** Disconnect, app kill or auto close, then riding again inside the split window: one ride. */
  @Test
  fun disconnectMarkersNoLongerSplitARide() {
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L),
      bucket(start = base + 20 * 60_000L, end = base + 20 * 60_000L + 10_000L),
    )
    val markers = listOf("disconnected", "app_stop", "error", "connection_lost").map {
      marker(base + 15 * 60_000L, it)
    }

    assertEquals(1, groupRideSessions(buckets, markers, gapMs).size)
  }

  /** A long stop while still connected (Idle Pause writes no frames) splits on the frame gap. */
  @Test
  fun aFrameGapLongerThanTheSplitWindowStartsANewRide() {
    val buckets = listOf(
      bucket(start = base, end = base + 30_000L),
      bucket(start = base + 2 * 3_600_000L, end = base + 2 * 3_600_000L + 30_000L),
    )

    assertEquals(2, groupRideSessions(buckets, emptyList(), gapMs).size)
    assertEquals(1, groupRideSessions(buckets, emptyList(), 3 * 3_600_000L).size)
  }

  @Test
  fun stopRecordingSplitsInsideTheSplitWindow() {
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L),
      bucket(start = base + 2 * 60_000L, end = base + 2 * 60_000L + 10_000L),
    )

    assertEquals(2, groupRideSessions(buckets, listOf(marker(base + 60_000L, RECORDING_STOP_MARKER)), gapMs).size)
    assertEquals(
      "another Board's stop does not split this ride",
      1,
      groupRideSessions(buckets, listOf(marker(base + 60_000L, RECORDING_STOP_MARKER, "board-2")), gapMs).size,
    )
  }

  @Test
  fun aBoardChangeStartsANewRide() {
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L),
      bucket(start = base + 60_000L, end = base + 70_000L).copy(boardId = "board-2"),
    )

    assertEquals(listOf("board-1", "board-2"), groupRideSessions(buckets, emptyList(), gapMs).map { it.boardId })
  }

  /** The Ride Dropout Grace tail after the last frame belongs to that ride. */
  @Test
  fun aGpsOnlyTailAttachesToThePrecedingRide() {
    val buckets = listOf(
      bucket(start = base, end = base + 30_000L),
      trackOnlyBucket(start = base + 60_000L, end = base + 90_000L),
    )

    val session = groupRideSessions(buckets, emptyList(), gapMs).single()
    assertEquals(base + 90_000L, session.endAtMs)
    assertEquals(2, session.blockCount)
  }

  @Test
  fun gpsOnlyMinutesNeverCreateOrExtendARideOnTheirOwn() {
    assertEquals(
      emptyList<RideSessionAggregate>(),
      groupRideSessions(listOf(trackOnlyBucket(start = base, end = base + 30_000L)), emptyList(), gapMs),
    )
    // GPS 20 min after the last frame does not move the split baseline: frames 40 min apart split.
    val buckets = listOf(
      bucket(start = base, end = base + 10_000L),
      trackOnlyBucket(start = base + 20 * 60_000L, end = base + 20 * 60_000L + 10_000L),
      bucket(start = base + 40 * 60_000L, end = base + 40 * 60_000L + 10_000L),
    )
    assertEquals(2, groupRideSessions(buckets, emptyList(), gapMs).size)
    // Another Board's GPS never joins this ride.
    val foreign = groupRideSessions(listOf(
      bucket(start = base, end = base + 10_000L),
      trackOnlyBucket(start = base + 60_000L, end = base + 70_000L).copy(boardId = "board-2"),
    ), emptyList(), gapMs).single()
    assertEquals(1, foreign.blockCount)
  }

  @Test
  fun bridgeIdentityIsBoardAndTimeRange() {
    val session = groupRideSessions(listOf(bucket(start = base, end = base + 10_000L)), emptyList(), gapMs)
      .map { rideSessionMap(it, emptyMap(), weather = null) }.single()
    assertEquals("board-1:$base:${base + 10_000L}", session["id"])
    assertEquals(false, session.containsKey("recordingId"))
  }

  private fun marker(at: Long, type: String, boardId: String = "board-1") = TelemetryMarkerEntity(
    occurredAtMs = at,
    elapsedRealtimeMs = 0L,
    type = type,
    boardId = boardId,
    message = null,
    gapMs = null,
  )

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
