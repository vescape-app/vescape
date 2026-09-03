package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

  /** A poor fix stays stored, but the route stream JS reads never contains it. */
  @Test
  fun keepsPoorFixesOutOfTheRouteStream() {
    val boardNames = mapOf("board-1" to "ADV2")
    val poor = point(9L, 5_000L, latitudeE7 = 500_000_000, accuracyCm = 12_000)
    val good = point(10L, 6_000L, latitudeE7 = 500_010_000, accuracyCm = 500)

    val maps = listOf(poor, good).toGpsSampleMaps(boardNames)

    assertEquals(1, maps.size)
    assertEquals(10L, maps[0]["id"])
    assertNull("a poor predecessor never contributes a step", maps[0]["distanceFromPreviousM"])
  }

  /** Buckets still count every stored fix; only qualifying ones derive anything. */
  @Test
  fun countsPoorFixesButDerivesNothingFromThem() {
    val poor = point(9L, 5_000L, latitudeE7 = 500_000_000, accuracyCm = 12_000, gpsSpeedCentiMps = 500)

    val bucketPoint = listOf(poor).toBucketLocationPoints().single()

    assertFalse(bucketPoint.precise)
    assertFalse("a poor fix is never movement evidence", bucketPoint.moving)
    assertNull(bucketPoint.latitudeE7)
  }

  /** Movement is the fix's own reported speed, never a coordinate-displacement derivation. */
  @Test
  fun readsMovementFromTheFixesReportedSpeed() {
    val rolling = point(1L, 1_000L, gpsSpeedCentiMps = 200) // 7.2 km/h
    val crawling = point(2L, 2_000L, gpsSpeedCentiMps = 50) // 1.8 km/h
    val speedless = point(3L, 3_000L, gpsSpeedCentiMps = null)

    val points = listOf(rolling, crawling, speedless)
      .toBucketLocationPoints(movingThresholdCentiKmh = 300)

    assertTrue(points[0].moving)
    assertFalse(points[1].moving)
    assertFalse("a fix with no reported speed is not movement evidence", points[2].moving)
    assertTrue("but it is still a route point", points[2].precise)
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
}
