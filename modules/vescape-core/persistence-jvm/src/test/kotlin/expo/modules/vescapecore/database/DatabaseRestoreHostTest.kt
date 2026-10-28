package expo.modules.vescapecore.database

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.runBlocking
import expo.modules.vescapecore.telemetry.BucketRoutePreview
import expo.modules.vescapecore.telemetry.RecordingPersistence
import expo.modules.vescapecore.telemetry.bucketPreviewFixes
import expo.modules.vescapecore.telemetry.buildTelemetryBuckets
import expo.modules.vescapecore.telemetry.toBucketLocationPoints

class DatabaseRestoreHostTest {
  private fun open(path: String) =
    Room.databaseBuilder<VescapeRoomDatabase>(path).setDriver(BundledSQLiteDriver()).build()

  @Test
  fun crossPlatformProductionArchivePipeline(): Unit = runBlocking {
    val exchange = System.getenv("VESCAPE_BACKUP_EXCHANGE")?.let(::File) ?: return@runBlocking
    exchange.mkdirs()
    when (System.getenv("VESCAPE_BACKUP_PHASE")) {
      "export-android" -> {
        val database = exchange.resolve("android.sqlite")
        val room = open(database.path)
        val dao = room.vescapeDao()
        dao.upsertBoard(BoardEntity("cross-board", "Cross Board", "cross-ble", 100))
        dao.upsertBoardSetting(BoardSettingEntity("cross-board", "description", "\"durable\"", 101))
        dao.upsertAppSetting(AppSettingEntity("cross-setting", "\"android\"", 102))
        dao.upsertTuneProfile(TuneProfileEntity("cross-tune", "cross-board", "2.0", "Cross Tune", fieldsJson = "{\"kp\":2}", createdAt = 103, updatedAt = 104))
        dao.insertFavorite(FavoriteEntity("cross-favorite", "cross-board", "Cross Favorite", 900, 1100, 105, 106, 1, 0, 200, 100, 2400, 2468, 2))
        dao.upsertBoardConfigValues(BoardConfigValuesEntity("cross-board", "2.0", "{\"motor_current_max\":55.5}", 107))
        dao.insertRideTrackPoints(listOf(RideTrackPointEntity(boardId = "cross-board", fixAtMs = 1200, latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 3500, gpsSpeedCentiMps = 400, bearingCentiDeg = 9000, altitudeCm = 12300)))
        val previewFixes = bucketPreviewFixes()
        RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), previewFixes.toBucketLocationPoints()), emptyList(), trackPoints = previewFixes)
        room.close()
        val connection = BundledSQLiteDriver().open(database.path)
        connection.execSQL("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,board_id,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'cross-board',1,1,0,2468)")
        connection.close()
        val archive = exchange.resolve("android.zip")
        archive.outputStream().use { output ->
          DatabaseBackupArchive.write(
            database,
            DatabaseBackupArchive.manifest("android", VESCAPE_DATABASE_VERSION, "host", database.length(), 1),
            output,
          )
        }
      }
      "import-ios" -> {
        val database = exchange.resolve("ios-restored.sqlite")
        val manifest = exchange.resolve("ios.zip").inputStream().use { DatabaseBackupArchive.extract(it, database) }
        assertEquals("ios", manifest.getString("platform"))
        assertEquals(VESCAPE_DATABASE_VERSION, manifest.getInt("schemaVersion"))
        // From v54 iOS writes the shared schema, so the archive needs no reconciliation.
        assertMatchesSharedSchema("restored-ios", database.toPath())
        val room = open(database.path)
        val dao = room.vescapeDao()
        assertEquals("Cross Board", dao.getBoard("cross-board")?.name)
        val previewFixes = bucketPreviewFixes()
        for ((minute, points) in previewFixes.groupBy { it.fixAtMs / 60000 * 60000 }) {
          val stored = dao.getBucket(minute, points.first().boardId!!)!!.routePreview!!
          assertEquals(BucketRoutePreview.decode(BucketRoutePreview.build(points)), BucketRoutePreview.decode(stored))
        }
        assertEquals("\"durable\"", dao.getBoardSettings("cross-board").single { it.key == "description" }.valueJson)
        assertEquals("\"direct\"", dao.getBoardSettings("cross-board").single { it.key == "transport" }.valueJson)
        assertEquals("Cross Tune", dao.getTuneProfile("cross-tune")?.name)
        assertEquals("Cross Favorite", dao.getFavorite("cross-favorite")?.name)
        assertEquals("{\"motor_current_max\":55.5}", dao.getBoardConfigValues("cross-board", "2.0")?.valuesJson)
        val frame = dao.getFrames(0, 2000, "cross-board", 10).single()
        assertEquals("cross-board", frame.boardId)
        assertEquals(1000L, frame.capturedAtMs)
        assertEquals(2468, frame.speedCentiKmh)
        val track = dao.getRideTrackPoints(0, 2000, "cross-board", 10).single()
        assertEquals(1200L, track.fixAtMs)
        assertEquals(3500, track.accuracyCm)
        assertEquals(510000000, track.latitudeE7)
        assertEquals(listOf(1000L), dao.getVescFaultCaptureSamples("cross-fault").map { it.capturedAtMs })
        room.close()

        // An archive from an iOS app before the shared schema still carries `boards.transport`.
        val v53 = exchange.resolve("ios-v53-restored.sqlite")
        val v53Manifest = exchange.resolve("ios-v53.zip").inputStream().use { DatabaseBackupArchive.extract(it, v53) }
        assertEquals(53, v53Manifest.getInt("schemaVersion"))
        BundledSQLiteDriver().open(v53.path).use { connection ->
          iosSchemaReconciliationStatements(hasDeletedAt = true, hasFaultCaptures = true, bootstrapLegacyTune = false)
            .forEach(connection::execSQL)
          DatabaseMigrations.MIGRATION_53_54.migrate(connection)
          connection.execSQL("PRAGMA user_version = 54")
          val tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").use { query ->
            buildList { while (query.step()) add(query.getText(0)) }
          }
          assertEquals(listOf("DROP TABLE `stray_from_old_app`"), unknownTableDrops(tables))
          unknownTableDrops(tables).forEach(connection::execSQL)
        }
        assertMatchesSharedSchema("restored-ios-v53", v53.toPath())
        val v53Room = open(v53.path)
        val v53Dao = v53Room.vescapeDao()
        assertEquals("\"98\"", v53Dao.getBoardSettings("v53-board").single { it.key == "transport" }.valueJson)
        assertEquals(emptyList<String>(), v53Dao.getBoardSettings("v53-gone").map { it.key })
        assertEquals(listOf(1000L), v53Dao.getVescFaultCaptureSamples("v53-fault").map { it.capturedAtMs })
        v53Room.close()
      }
    }
  }

  @Test
  fun productionMigrationGraphRejectsVersionsWithoutAPath() {
    assertTrue((3..36).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
    assertTrue((40..VESCAPE_DATABASE_VERSION).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
    // The gap and the generation past the current one: 37-39 never shipped, and a database from a
    // newer app than this one is not something an older migration graph may guess at.
    assertTrue(
      (listOf(1, 2, 37, 38, 39) + (VESCAPE_DATABASE_VERSION + 1))
        .all { it !in SUPPORTED_ANDROID_DATABASE_VERSIONS },
    )
    assertTrue((14..36).all { it in EXPORTED_ANDROID_DATABASE_VERSIONS })
    assertTrue((3..13).all { it !in EXPORTED_ANDROID_DATABASE_VERSIONS })
    assertEquals(1, roomVersionForBackup("ios", 1))
    assertEquals(31, roomVersionForBackup("ios", 31))
    assertEquals(14, roomVersionForBackup("android", 14))
  }

  @Test
  fun failedInstallRestoresDatabaseAndSidecarsByteForByte() {
    val directory = Files.createTempDirectory("vescape-restore").toFile()
    val target = directory.resolve("vescape.db").apply { writeText("current") }
    val wal = directory.resolve("vescape.db-wal").apply { writeText("current-wal") }
    val shm = directory.resolve("vescape.db-shm").apply { writeText("current-shm") }
    val incoming = directory.resolve("incoming.db").apply { writeText("invalid") }

    var failed = false
    try {
      replaceDatabaseFiles(incoming, target) { error("forced validation failure") }
    } catch (_: IllegalStateException) {
      failed = true
    }

    assertTrue(failed)
    assertEquals("current", target.readText())
    assertEquals("current-wal", wal.readText())
    assertEquals("current-shm", shm.readText())
    assertFalse(directory.resolve("vescape.db.rollback").exists())
    directory.deleteRecursively()
  }

  @Test
  fun successfulInstallRemovesOldSidecars() {
    val directory = Files.createTempDirectory("vescape-restore").toFile()
    val target = directory.resolve("vescape.db").apply { writeText("current") }
    directory.resolve("vescape.db-wal").writeText("current-wal")
    directory.resolve("vescape.db-shm").writeText("current-shm")
    val incoming = directory.resolve("incoming.db").apply { writeText("restored") }

    replaceDatabaseFiles(incoming, target) { assertEquals("restored", it.readText()) }

    assertEquals("restored", target.readText())
    assertFalse(directory.resolve("vescape.db-wal").exists())
    assertFalse(directory.resolve("vescape.db-shm").exists())
    directory.deleteRecursively()
  }

  @Test
  fun incompleteRollbackPreservesRecoveryArtifactsAndBothErrors() {
    val directory = Files.createTempDirectory("vescape-rollback-failure").toFile()
    val target = directory.resolve("vescape.db").apply { writeText("original") }
    val incoming = directory.resolve("incoming.db").apply { writeText("candidate") }

    val failure = runCatching {
      replaceDatabaseFiles(incoming, target) { installed ->
        check(installed.delete())
        check(installed.mkdir())
        installed.resolve("blocks-delete").writeText("keep")
        error("forced install failure")
      }
    }.exceptionOrNull() as IllegalStateException

    assertTrue(failure.message!!.contains("rollback was incomplete"))
    assertTrue(failure.cause!!.message!!.contains("forced install failure"))
    assertTrue(failure.suppressed.isNotEmpty())
    assertEquals("original", directory.resolve("vescape.db.rollback/vescape.db").readText())
    directory.deleteRecursively()
  }

  @Test
  fun failureAfterOpeningValidCandidateLeavesOriginalRoomDatabaseReadable(): Unit = runBlocking {
    val directory = Files.createTempDirectory("vescape-room-restore").toFile()
    val target = directory.resolve("vescape.db")
    val incoming = directory.resolve("incoming.db")
    var database = open(target.path)
    database.vescapeDao().upsertAppSetting(AppSettingEntity("sentinel", "\"original\"", 1)); database.close()
    database = open(incoming.path)
    database.vescapeDao().upsertAppSetting(AppSettingEntity("sentinel", "\"candidate\"", 2)); database.close()

    var failed = false
    try {
      replaceDatabaseFiles(incoming, target) { installed ->
        database = open(installed.path)
        runBlocking {
          assertEquals("\"candidate\"", database.vescapeDao().getAppSetting("sentinel")?.valueJson)
        }
        database.close()
        error("forced failure after candidate open")
      }
    } catch (_: IllegalStateException) { failed = true }

    assertTrue(failed)
    database = open(target.path)
    assertEquals("\"original\"", database.vescapeDao().getAppSetting("sentinel")?.valueJson)
    database.close()
    directory.deleteRecursively()
  }
}
