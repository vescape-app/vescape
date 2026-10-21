package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** GPS-only commits use the same production atomic batch as telemetry. */
class RideTrackPersistenceHostTest {
  @Test fun sameTimestampRecordingsReadAndDeleteIndependently(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-track-identity", ".db")
    Files.deleteIfExists(path)
    val db = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    for (id in listOf("ride-a", "ride-b")) {
      dao.insertRideRecording(RideRecordingEntity(id, "board-a", 1000, 3000, "stopped"))
      val point = RideTrackPointEntity(recordingId = id, boardId = "board-a", fixAtMs = 2000,
        latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 500,
        gpsSpeedCentiMps = 400, bearingCentiDeg = null, altitudeCm = null)
      RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), listOf(point).toBucketLocationPoints()), emptyList(), trackPoints = listOf(point))
    }
    assertEquals(listOf("ride-b"), dao.getRideTrackPoints(0, 10000, "board-a", 1, recordingId = "ride-b").map { it.recordingId })
    dao.deleteRecordingRanges("ride-a", listOf(TelemetryTimeRange(0, 10000)))
    assertEquals(listOf("ride-b"), dao.getRideTrackPoints(0, 10000, "board-a", 10).map { it.recordingId })
    assertEquals(listOf("ride-b"), dao.getAllHistoryBucketsAsc().map { it.recordingId })
    db.close()
    Files.deleteIfExists(path)
  }

  @Test fun gpsOnlyCommitReopensAndLateFailureRollsBackBuckets(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-track-contract", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open()
    db.telemetryDao().insertRideRecording(RideRecordingEntity("ride-a", "board-a", 1000))
    val point = RideTrackPointEntity(recordingId = "ride-a", boardId = "board-a", fixAtMs = 2000,
      latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 3500,
      gpsSpeedCentiMps = 400, bearingCentiDeg = null, altitudeCm = null)
    val buckets = buildTelemetryBuckets(emptyList(), listOf(point).toBucketLocationPoints())
    RecordingPersistence(db.telemetryDao()).commit(emptyList(), buckets, emptyList(), trackPoints = listOf(point))
    db.close()
    db = open()
    assertEquals(3500, db.telemetryDao().getRideTrackPoints(0, 10000, "board-a", 10).single().accuracyCm)
    assertEquals(0, db.telemetryDao().getAllHistoryBucketsAsc().single().sampleCount)
    assertEquals(1, db.telemetryDao().getAllHistoryBucketsAsc().single().gpsPointCount)
    db.close()
    BundledSQLiteDriver().open(path.toString()).use { connection ->
      connection.execSQL("CREATE TRIGGER reject_track BEFORE INSERT ON ride_track_points BEGIN SELECT RAISE(FAIL, 'track failure'); END")
    }
    db = open()
    val later = point.copy(fixAtMs = 62000)
    var failures = 0
    val boundary = RecordingCommitBoundary(RecordingPersistence(db.telemetryDao()), { failures++ })
    assertFalse(boundary.commit(emptyList(), buildTelemetryBuckets(emptyList(), listOf(later).toBucketLocationPoints()), emptyList(), trackPoints = listOf(later)))
    assertFalse(boundary.isAccepting())
    assertEquals(1, failures)
    db.close()
    db = open()
    assertEquals(1, db.telemetryDao().getAllHistoryBucketsAsc().size)
    assertEquals(1L, db.telemetryDao().countRideTrackPoints())
    db.close()
    Files.deleteIfExists(path)
  }
}
