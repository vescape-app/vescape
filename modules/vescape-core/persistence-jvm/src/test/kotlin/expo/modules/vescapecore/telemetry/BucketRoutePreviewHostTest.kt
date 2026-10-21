package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BucketRoutePreviewHostTest {
  private val fixture = bucketPreviewFixture
  private val board = fixture.getString("boardId")
  private val recording = fixture.getString("recordingId")
  private val fixes = bucketPreviewFixes()

  @Test fun multipleFlushesReopenLateFixesAndRollback(): Unit = runBlocking {
    val path = Files.createTempFile("bucket-preview", ".db")
    Files.delete(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open()
    db.telemetryDao().insertRideRecording(RideRecordingEntity(recording, board, 0))
    suspend fun flush(points: List<RideTrackPointEntity>) {
      RecordingPersistence(db.telemetryDao()).commit(emptyList(), buildTelemetryBuckets(emptyList(), points.toBucketLocationPoints()), emptyList(), trackPoints = points)
    }
    flush(fixes.take(3))
    assertEquals(2, BucketRoutePreview.decode(db.telemetryDao().getBucket(0, board, recording)!!.routePreview!!).single().points.size)
    db.close(); db = open()
    // Out-of-order later batches must use every original fix, including the previously removed one.
    flush(fixes.drop(5))
    flush(fixes.subList(3, 5))
    val buckets = db.telemetryDao().getAllHistoryBucketsAsc()
    assertEquals(2, buckets.size)
    for ((index, bucket) in buckets.withIndex()) {
      val segments = BucketRoutePreview.decode(bucket.routePreview!!)
      val expected = fixture.getJSONArray("expectedMinuteSegments").getJSONArray(index)
      assertEquals(expected.length(), segments.size)
      for ((i, segment) in segments.withIndex()) {
        val value = expected.getJSONObject(i)
        assertEquals(value.getLong("firstMs"), segment.firstAtMs)
        assertEquals(value.getLong("lastMs"), segment.lastAtMs)
        val indices = value.getJSONArray("fixIndices")
        assertEquals((0 until indices.length()).map { fixes[indices.getInt(it)].let { p -> BucketRoutePreview.Coordinate(p.latitudeE7.toLong(), p.longitudeE7.toLong()) } }, segment.points)
      }
    }
    val session = groupRideSessions(buckets, emptyList(), 1_800_000).single()
    assertEquals(8, session.routePoints.size)
    assertEquals(listOf(5), session.routePoints.mapIndexedNotNull { i, p -> i.takeIf { p.breakBefore } })
    val previews = buckets.map { it.routePreview }
    // Telemetry-only merges must preserve the already-written route.
    val telemetry = BucketTelemetryPoint(3000, board, recording, 1500, 80000, 1000, 500, 100, null)
    RecordingPersistence(db.telemetryDao()).commit(emptyList(), buildTelemetryBuckets(listOf(telemetry), emptyList()), emptyList())
    assertEquals(previews, db.telemetryDao().getAllHistoryBucketsAsc().map { it.routePreview })
    // Existing maintenance is the explicit backfill, and must produce the same geometry.
    TelemetryMaintenancePersistence(db.telemetryDao()).rebuild(MetricSanitizerConfig())
    assertEquals(previews, db.telemetryDao().getAllHistoryBucketsAsc().map { it.routePreview })
    db.close()
    BundledSQLiteDriver().open(path.toString()).use { sql ->
      sql.execSQL("CREATE TRIGGER reject_preview BEFORE UPDATE OF route_preview ON telemetry_minute_buckets BEGIN SELECT RAISE(FAIL, 'preview failure'); END")
    }
    db = open()
    val later = fixes.last().copy(fixAtMs = 63000)
    var failures = 0
    val boundary = RecordingCommitBoundary(RecordingPersistence(db.telemetryDao()), { failures++ })
    assertFalse(boundary.commit(emptyList(), buildTelemetryBuckets(emptyList(), listOf(later).toBucketLocationPoints()), emptyList(), trackPoints = listOf(later)))
    assertEquals(1, failures)
    db.close(); db = open()
    assertEquals(fixes.size.toLong(), db.telemetryDao().countRideTrackPoints())
    assertEquals(previews, db.telemetryDao().getAllHistoryBucketsAsc().map { it.routePreview })
    db.close(); Files.deleteIfExists(path)
  }

  @Test fun favoritePreviewKeepsCornersAndClipsTheSelectedRange(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), fixes.toBucketLocationPoints()), emptyList(), trackPoints = fixes)
    val route = dao.favoriteRoutePreview(0, 119999, board)
    assertEquals(8, route.size)
    assertEquals(listOf(5), route.mapIndexedNotNull { i, p -> i.takeIf { p["breakBefore"] == true } })
    val trimmed = dao.favoriteRoutePreview(2500, 61500, board)
    assertEquals(6, trimmed.size)
    assertEquals(fixes[2].longitudeE7 / 1e7, trimmed.first()["longitude"])
    assertEquals(fixes[8].longitudeE7 / 1e7, trimmed.last()["longitude"])
    assertTrue(dao.favoriteRoutePreview(0, 119999, "other-board").isEmpty())
    assertTrue(dao.favoriteRoutePreview(0, 119999, null).isEmpty())
    assertTrue(dao.favoriteRoutePreview(10000, 20000, board).isEmpty())
    val sequence = listOf(65000L, 70000L, 125000L).mapIndexed { index, time ->
      fixes[index].copy(boardId = "sequence", recordingId = if (index == 0) "z" else "a", fixAtMs = time)
    }
    RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), sequence.toBucketLocationPoints()), emptyList(), trackPoints = sequence)
    assertEquals(sequence.map { it.longitudeE7 / 1e7 }, dao.favoriteRoutePreview(60000, 179999, "sequence").map { it["longitude"] })
    db.close()
  }

  @Test fun codecPreservesNegativeE7CoordinatesAndRemovesDenseStraightPoints() {
    val points = (0 until 60).map { i -> fixes[0].copy(fixAtMs = i * 1000L,
      latitudeE7 = -520000001, longitudeE7 = -180000003 + i * 100) }
    val segments = BucketRoutePreview.decode(BucketRoutePreview.build(points))
    assertEquals(listOf(points.first(), points.last()).map { BucketRoutePreview.Coordinate(it.latitudeE7.toLong(), it.longitudeE7.toLong()) }, segments.single().points)
    assertTrue(BucketRoutePreview.build(points).length < 60)
  }

  @Test fun recordingAndBoardScopeAndCrossMinuteGaps(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val points = listOf(fixes[0], fixes[0].copy(fixAtMs = 65000), fixes[1].copy(recordingId = "other"), fixes[2].copy(boardId = "other-board"), fixes[3].copy(boardId = null, recordingId = null))
    val dao = db.telemetryDao()
    RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), points.toBucketLocationPoints()), emptyList(), trackPoints = points)
    for (bucket in dao.getAllHistoryBucketsAsc()) assertEquals(1, BucketRoutePreview.decode(bucket.routePreview!!).single().points.size)
    val session = groupRideSessions(dao.getAllHistoryBucketsAsc().filter { it.boardId == board && it.recordingId == recording }, emptyList(), 1_800_000).single()
    assertTrue(session.routePoints.last().breakBefore)
    db.close()
  }
}

internal val bucketPreviewFixture = JSONObject(Files.readString(Path.of("../shared/bucket-route-preview-contract.json")))
internal fun bucketPreviewFixes(): List<RideTrackPointEntity> {
  val values = bucketPreviewFixture.getJSONArray("fixes")
  return (0 until values.length()).map { index ->
    val point = values.getJSONArray(index)
    RideTrackPointEntity(recordingId = bucketPreviewFixture.getString("recordingId"), boardId = bucketPreviewFixture.getString("boardId"), fixAtMs = point.getLong(0),
      latitudeE7 = point.getInt(1), longitudeE7 = point.getInt(2), accuracyCm = point.getInt(3),
      gpsSpeedCentiMps = 400, bearingCentiDeg = null, altitudeCm = null)
  }
}
