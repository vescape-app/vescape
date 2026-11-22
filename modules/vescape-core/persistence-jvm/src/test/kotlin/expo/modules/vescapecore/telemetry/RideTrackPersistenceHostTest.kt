package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import expo.modules.vescapecore.database.BoardEntity
import expo.modules.vescapecore.database.RideTrackPoint
import expo.modules.vescapecore.database.VescapeRoomDatabase

class RideTrackPersistenceHostTest {
  @Test fun trackReadsAndDeletesScopeToBoardAndTime(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-track-scope", ".db")
    Files.deleteIfExists(path)
    val db = Room.databaseBuilder<VescapeRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    val dao = db.vescapeDao()
    for (board in listOf("board-a", "board-b")) {
      val point = RideTrackPoint(boardId = board, fixAtMs = 2000,
        latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 500,
        gpsSpeedCentiMps = 400, bearingCentiDeg = null, altitudeCm = null)
      RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), listOf(point).toBucketLocationPoints()), emptyList(), trackPoints = listOf(point))
    }
    assertEquals(listOf("board-b"), dao.getRideTrackPoints(0, 10000, "board-b", 10).map { it.boardId })
    dao.deleteRange(0, 10000, "board-a")
    assertEquals(listOf("board-b"), dao.getRideTrackPoints(0, 10000, null, 10).map { it.boardId })
    assertEquals(listOf("board-b"), dao.getAllHistoryBucketsAsc().map { it.boardId })
    db.close()
    Files.deleteIfExists(path)
  }

  @Test fun boardWritesKeepTheKeyTheTrackReferences(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-board-key", ".db")
    Files.deleteIfExists(path)
    val db = Room.databaseBuilder<VescapeRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    val dao = db.vescapeDao()
    dao.upsertBoardWithSettings(BoardEntity("board-other", "Other", null, 50), emptyList(), emptyList(), emptyList())
    dao.upsertBoardWithSettings(BoardEntity("board-a", "A", "ble-1", 100), emptyList(), emptyList(), emptyList())
    val key = checkNotNull(dao.getBoardKey("board-a"))
    val point = RideTrackPoint(boardId = "board-a", fixAtMs = 2000, latitudeE7 = 1, longitudeE7 = 2,
      accuracyCm = 500, gpsSpeedCentiMps = null, bearingCentiDeg = null, altitudeCm = null)
    dao.insertRideTrackPoints(listOf(point, point.copy(boardId = null, fixAtMs = 2500)))
    dao.upsertBoardWithSettings(BoardEntity("board-a", "Renamed", "ble-1", 100), emptyList(), emptyList(), emptyList())
    dao.upsertBoardWithSettings(BoardEntity("board-a", "Renamed", "ble-2", 100), emptyList(), emptyList(), emptyList())
    assertEquals(key, dao.getBoardKey("board-a"))
    assertEquals("Renamed" to "ble-2", dao.getBoard("board-a")!!.let { it.name to it.bleId })
    dao.deleteBoardWithSettings("board-a", 3000)
    dao.upsertBoard(BoardEntity("board-a", "Renamed", "ble-2", 100))
    assertEquals(key, dao.getBoard("board-a")!!.key)
    assertEquals(3000L, dao.getBoard("board-a")!!.deletedAt)
    assertEquals(listOf("board-a"), dao.getRideTrackPoints(0, 10000, "board-a", 10).map { it.boardId })
    assertEquals(listOf("board-a", null), dao.getRideTrackPoints(0, 10000, null, 10).map { it.boardId })
    assertEquals("an unknown Board matches nothing, not the unowned track",
      emptyList<RideTrackPoint>(), dao.getRideExportTrackPage(0, 10000, "board-missing", -1, 0, 10))
    assertEquals(listOf(2500L), dao.getRideExportTrackPage(0, 10000, null, -1, 0, 10).map { it.fixAtMs })
    db.close()
    Files.deleteIfExists(path)
  }

  @Test fun gpsOnlyCommitReopensAndLateFailureRollsBackBuckets(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-track-contract", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<VescapeRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open()
    val point = RideTrackPoint(boardId = "board-a", fixAtMs = 2000,
      latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 3500,
      gpsSpeedCentiMps = 400, bearingCentiDeg = null, altitudeCm = null)
    val buckets = buildTelemetryBuckets(emptyList(), listOf(point).toBucketLocationPoints())
    RecordingPersistence(db.vescapeDao()).commit(emptyList(), buckets, emptyList(), trackPoints = listOf(point))
    db.close()
    db = open()
    assertEquals(3500, db.vescapeDao().getRideTrackPoints(0, 10000, "board-a", 10).single().accuracyCm)
    assertEquals(0, db.vescapeDao().getAllHistoryBucketsAsc().single().sampleCount)
    assertEquals(1, db.vescapeDao().getAllHistoryBucketsAsc().single().gpsPointCount)
    db.close()
    BundledSQLiteDriver().open(path.toString()).use { connection ->
      connection.execSQL("CREATE TRIGGER reject_track BEFORE INSERT ON ride_track_points BEGIN SELECT RAISE(FAIL, 'track failure'); END")
    }
    db = open()
    val later = point.copy(fixAtMs = 62000)
    var failures = 0
    val boundary = RecordingCommitBoundary(RecordingPersistence(db.vescapeDao()), { failures++ })
    assertFalse(boundary.commit(emptyList(), buildTelemetryBuckets(emptyList(), listOf(later).toBucketLocationPoints()), emptyList(), trackPoints = listOf(later)))
    assertFalse(boundary.isAccepting())
    assertEquals(1, failures)
    db.close()
    db = open()
    assertEquals(1, db.vescapeDao().getAllHistoryBucketsAsc().size)
    assertEquals(1L, db.vescapeDao().countRideTrackPoints())
    db.close()
    Files.deleteIfExists(path)
  }
}
