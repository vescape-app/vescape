package expo.modules.vescapecore.database

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.runBlocking
import expo.modules.vescapecore.telemetry.BucketRoutePreview
import expo.modules.vescapecore.telemetry.RecordingPersistence
import expo.modules.vescapecore.telemetry.MaintenanceJobScope
import expo.modules.vescapecore.telemetry.CleanupJob
import expo.modules.vescapecore.telemetry.MaintenanceJobOutcome
import expo.modules.vescapecore.telemetry.publishMaintenanceFingerprint
import expo.modules.vescapecore.telemetry.storedMaintenanceFingerprint
import expo.modules.vescapecore.telemetry.bucketPreviewFixes
import expo.modules.vescapecore.telemetry.buildTelemetryBuckets
import expo.modules.vescapecore.telemetry.toBucketLocationPoints
import expo.modules.vescapecore.telemetry.reconstructTelemetryValues

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
        dao.insertRideTrackPoints(listOf(RideTrackPoint(boardId = "cross-board", fixAtMs = 1200, latitudeE7 = 510000000, longitudeE7 = 170000000, accuracyCm = 3500, gpsSpeedCentiMps = 400, bearingCentiDeg = 9000, altitudeCm = 12300)))
        val previewFixes = bucketPreviewFixes()
        RecordingPersistence(dao).commit(emptyList(), buildTelemetryBuckets(emptyList(), previewFixes.toBucketLocationPoints()), emptyList(), trackPoints = previewFixes)
        dao.insertFrames(crossChunkFrames())
        assertEquals(2, dao.sealTelemetryMinute("cross-board", 60_000))
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
        assertCrossChunkSpeeds(dao)
        val track = dao.getRideTrackPoints(0, 2000, "cross-board", 10).single()
        assertEquals(1200L, track.fixAtMs)
        assertEquals(3500, track.accuracyCm)
        assertEquals(510000000, track.latitudeE7)
        assertEquals(listOf(1000L), dao.getVescFaultCaptureSamples("cross-fault").map { it.capturedAtMs })
        room.close()

        val v53 = exchange.resolve("ios-v53-restored.sqlite")
        val v53Manifest = exchange.resolve("ios-v53.zip").inputStream().use { DatabaseBackupArchive.extract(it, v53) }
        assertEquals(53, v53Manifest.getInt("schemaVersion"))
        BundledSQLiteDriver().open(v53.path).use { connection ->
          iosSchemaReconciliationStatements(hasDeletedAt = true, hasFaultCaptures = true, bootstrapLegacyTune = false)
            .forEach(connection::execSQL)
          DatabaseMigrations.MIGRATION_53_54.migrate(connection)
          DatabaseMigrations.MIGRATION_54_55.migrate(connection)
          DatabaseMigrations.MIGRATION_55_56.migrate(connection)
          connection.execSQL("PRAGMA user_version = 56")
          connection.execSQL("PRAGMA foreign_keys = ON")
          prepareRestoredDatabase(connection)
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

  private fun crossChunkFrames() = listOf(60_000L to 1, 60_500L to 0, 120_500L to 0).mapIndexed { i, (at, flags) ->
    TelemetryFrameEntity(capturedAtMs = at, elapsedRealtimeMs = at, boardId = "cross-board", canId = null, flags = flags,
      changedMask1 = if (flags == 1) (1 shl 17) - 1 else TELEMETRY_MASK_SPEED, changedMask2 = 0, speedCentiKmh = 100 * (i + 1),
      batteryVoltageMv = if (flags == 1) 80_000 else null, motorCurrentMa = if (flags == 1) 0 else null,
      batteryCurrentMa = if (flags == 1) 0 else null, dutyPermille = if (flags == 1) 0 else null,
      pitchCentiDeg = if (flags == 1) 0 else null, rollCentiDeg = if (flags == 1) 0 else null,
      balancePitchCentiDeg = if (flags == 1) 0 else null, balanceCurrentMa = if (flags == 1) 0 else null,
      erpm = if (flags == 1) 0 else null, state = if (flags == 1) 0 else null, switchState = if (flags == 1) 0 else null,
      adc1Milli = if (flags == 1) 0 else null, adc2Milli = if (flags == 1) 0 else null, odometerCm = null,
      tempMosfetDeciC = null, tempMotorDeciC = null)
  }

  private suspend fun assertCrossChunkSpeeds(dao: VescapeDao) {
    assertEquals(1L, dao.getTelemetryChunkHeaders(60_000, 60_000, "cross-board", false).size.toLong())
    val frames = dao.getAnchoredFrames(60_000, 121_000, "cross-board", 10)
    val values = arrayOfNulls<Long>(17)
    val speeds = frames.map { f ->
      reconstructTelemetryValues(values, f.flags, f.changedMask1, arrayOfNulls<Long>(17).also { it[0] = f.speedCentiKmh?.toLong() })
      f.capturedAtMs to values[0]
    }
    assertEquals(listOf(60_000L to 100L, 60_500L to 200L, 120_500L to 300L), speeds)
  }

  @Test
  fun restoredArchiveForgetsTheTelemetryDrainedMarker(): Unit = runBlocking {
    val directory = Files.createTempDirectory("vescape-restore-drained").toFile()
    val source = directory.resolve("source.sqlite")
    open(source.path).apply {
      vescapeDao().publishMaintenanceFingerprint("telemetryStorage", "drained", 1)
      vescapeDao().publishMaintenanceFingerprint("telemetryBacklogDrain", "drained", 1)
      vescapeDao().insertDiagnosticEvent(DiagnosticEventEntity(occurredAtMs = 1, elapsedRealtimeMs = 0,
        eventName = "old", operation = null, phase = null, boardId = null, message = null, propertiesJson = "{}"))
      vescapeDao().upsertAppSetting(AppSettingEntity("kept", "\"yes\"", 2))
      close()
    }
    val archive = directory.resolve("backup.zip")
    archive.outputStream().use {
      DatabaseBackupArchive.write(source, DatabaseBackupArchive.manifest("android", VESCAPE_DATABASE_VERSION, "host", source.length(), 1), it)
    }
    val restored = directory.resolve("restored.sqlite")
    archive.inputStream().use { DatabaseBackupArchive.extract(it, restored) }
    BundledSQLiteDriver().open(restored.path).use(::prepareRestoredDatabase)
    val room = open(restored.path)
    try {
      assertNull(room.vescapeDao().storedMaintenanceFingerprint("telemetryStorage"))
      assertNull(room.vescapeDao().storedMaintenanceFingerprint("telemetryBacklogDrain"))
      val fence = DatabaseReplacementFence()
      fence.fence { }
      val scope = MaintenanceJobScope({ room.vescapeDao() }, fence, fence.ticket(), { 40 * 24 * 60 * 60_000L })
      val cleanup = CleanupJob()
      cleanup.begin(scope, AppSettings())
      assertEquals(MaintenanceJobOutcome.Completed, cleanup.run(scope, AppSettings()))
      cleanup.complete(scope, AppSettings())
      assertTrue(room.vescapeDao().getDiagnosticEvents(Long.MIN_VALUE, Long.MAX_VALUE, null, 10).isEmpty())
      assertEquals("\"yes\"", room.vescapeDao().getAllAppSettings().single { it.key == "kept" }.valueJson)
    } finally { room.close(); directory.deleteRecursively() }
  }

  @Test
  fun productionMigrationGraphRejectsVersionsWithoutAPath() {
    assertTrue((3..36).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
    assertTrue((40..VESCAPE_DATABASE_VERSION).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
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
