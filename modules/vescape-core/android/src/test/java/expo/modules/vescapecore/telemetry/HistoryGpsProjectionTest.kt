package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryGpsProjectionTest {
  @Test
  fun measuresDistanceOnlyWithinOneRecording() {
    val track = listOf(
      point(1L, 1_000L, latitudeE7 = 500_000_000, recordingId = "a"),
      point(2L, 2_000L, latitudeE7 = 500_010_000, recordingId = "a"),
      point(3L, 3_000L, latitudeE7 = 500_020_000, recordingId = "b"),
    )

    val points = track.toRideTrackProjection()

    assertNull("first fix of a recording has no predecessor", points[0].distanceFromPreviousCm)
    assertTrue((points[1].distanceFromPreviousCm ?: 0L) > 0L)
    assertNull("a new recording never continues the previous track", points[2].distanceFromPreviousCm)
  }

  @Test
  fun keepsPoorFixesButMarksThemImprecise() {
    val boardNames = mapOf("board-1" to "ADV2")
    val poor = point(9L, 5_000L, latitudeE7 = 500_000_000, accuracyCm = 12_000)
    val good = point(10L, 6_000L, latitudeE7 = 500_000_000, accuracyCm = 500)

    val maps = listOf(poor, good).toGpsSampleMaps(boardNames)

    assertEquals(2, maps.size)
    assertEquals(false, maps[0]["precise"])
    assertEquals(120.0, maps[0]["accuracyM"] as Double, 0.0)
    assertEquals(true, maps[1]["precise"])
  }

  @Test
  fun mapsSameProjectionToRangeAndBucketPayloads() {
    val track = listOf(
      point(
        id = 7L,
        fixAtMs = 10_000L,
        latitudeE7 = 500_000_000,
        gpsSpeedCentiMps = 500,
      ),
    )

    val gpsSample = track.toGpsSampleMaps(mapOf("board-1" to "ADV2")).single()
    val bucketPoint = track.toBucketLocationPoints().single()

    assertEquals(7L, gpsSample["id"])
    assertEquals(50.0, gpsSample["latitude"] as Double, 0.0)
    assertEquals(5.0, gpsSample["speedMps"] as Double, 0.0)
    assertEquals("ADV2", gpsSample["boardName"])
    assertEquals(10_000L, bucketPoint.capturedAtMs)
    assertEquals(500, bucketPoint.gpsSpeedCentiMps)
  }

  @Test
  fun stampsSamplesFromTheTrackWithinTheAgeGate() {
    val samples = listOf(
      sample(1L, 10_000L),
      sample(2L, 40_000L),
    )
    val track = listOf(point(1L, 9_000L, latitudeE7 = 500_000_000))

    val stamped = stampTrackLocations(samples, track)

    assertNotNull("a fix one second old still stamps", stamped[0].state.location)
    assertNull("a fix half a minute old does not", stamped[1].state.location)
  }

  /**
   * All migrated fixes carry a null recording, so recording equality alone makes every legacy pair
   * "the same recording" — chaining a haversine step from one Board's fix to another's.
   */
  @Test
  fun neverChainsLegacyDistanceAcrossBoards() {
    val track = listOf(
      point(1L, 1_000L, latitudeE7 = 500_000_000, recordingId = null, boardId = "board-a"),
      point(2L, 1_500L, latitudeE7 = 520_000_000, recordingId = null, boardId = "board-b"),
      point(3L, 2_000L, latitudeE7 = 500_010_000, recordingId = null, boardId = "board-a"),
    )

    val points = track.toRideTrackProjection()

    assertNull(points[0].distanceFromPreviousCm)
    assertNull("a different Board is not a predecessor", points[1].distanceFromPreviousCm)
    val step = points[2].distanceFromPreviousCm ?: 0L
    assertTrue("board A continues its own track", step in 1L..20_000L)
  }

  /**
   * A legacy row was persisted through the old write-time precision gate, so a missing accuracy on
   * it means "precise", not "unknown". A live fix with no accuracy is genuinely unknown.
   */
  @Test
  fun readsMigratedFixesWithoutAccuracyAsPrecise() {
    val legacy = point(1L, 1_000L, accuracyCm = null, recordingId = null)
    val live = point(2L, 2_000L, accuracyCm = null, recordingId = "recording-1")

    assertTrue(legacy.isPrecise())
    assertFalse(live.isPrecise())
  }

  /**
   * A rebuild stamps a mixed-Board track. One shared cursor lets Board B's fix become "current" and
   * strips Board A's next sample of the position its own in-range fix already covered.
   */
  @Test
  fun stampsEachBoardFromItsOwnCursor() {
    val samples = listOf(sample(1L, 10_000L, boardId = "board-a"))
    val track = listOf(
      point(1L, 9_000L, latitudeE7 = 500_000_000, boardId = "board-a"),
      point(2L, 9_500L, latitudeE7 = 520_000_000, boardId = "board-b"),
    )

    val stamped = stampTrackLocations(samples, track)

    val location = stamped[0].state.location
    assertNotNull("board A keeps its own fix", location)
    assertEquals(500_000_000L, location!!.latitudeE7.toLong())
  }

  private fun point(
    id: Long,
    fixAtMs: Long,
    latitudeE7: Int = 500_000_000,
    longitudeE7: Int = 190_000_000,
    accuracyCm: Int? = 300,
    gpsSpeedCentiMps: Int? = null,
    recordingId: String? = "recording-1",
    boardId: String? = "board-1",
  ): RideTrackPointEntity = RideTrackPointEntity(
    id = id,
    recordingId = recordingId,
    boardId = boardId,
    fixAtMs = fixAtMs,
    latitudeE7 = latitudeE7,
    longitudeE7 = longitudeE7,
    accuracyCm = accuracyCm,
    gpsSpeedCentiMps = gpsSpeedCentiMps,
    bearingCentiDeg = null,
    altitudeCm = null,
  )

  private fun sample(
    id: Long,
    capturedAtMs: Long,
    boardId: String? = "board-1",
  ): HistoryTelemetryState =
    HistoryTelemetryState(
      id = id,
      state = FullTelemetryState(
        capturedAtMs = capturedAtMs,
        elapsedRealtimeMs = capturedAtMs,
        boardId = boardId,
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
        location = null,
      ),
    )
}
