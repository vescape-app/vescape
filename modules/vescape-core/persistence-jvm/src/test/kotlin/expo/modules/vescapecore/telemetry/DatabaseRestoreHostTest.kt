package expo.modules.vescapecore.telemetry

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

class DatabaseRestoreHostTest {
  private fun open(path: String) =
    Room.databaseBuilder<TelemetryRoomDatabase>(path).setDriver(BundledSQLiteDriver()).build()

  @Test
  fun crossPlatformProductionArchivePipeline(): Unit = runBlocking {
    val exchange = System.getenv("VESCAPE_BACKUP_EXCHANGE")?.let(::File) ?: return@runBlocking
    exchange.mkdirs()
    when (System.getenv("VESCAPE_BACKUP_PHASE")) {
      "export-android" -> {
        val database = exchange.resolve("android.sqlite")
        val room = open(database.path)
        val dao = room.telemetryDao()
        dao.upsertBoard(BoardEntity("cross-board", "Cross Board", "cross-ble", 100))
        dao.upsertBoardSetting(BoardSettingEntity("cross-board", "description", "\"durable\"", 101))
        dao.upsertAppSetting(AppSettingEntity("cross-setting", "\"android\"", 102))
        dao.upsertTuneProfile(TuneProfileEntity("cross-tune", "cross-board", "2.0", "Cross Tune", fieldsJson = "{\"kp\":2}", createdAt = 103, updatedAt = 104))
        dao.insertFavorite(FavoriteEntity("cross-favorite", "cross-board", "Cross Favorite", 900, 1100, 105, 106, 1, 0, 200, 100, 2400, 2468, 2))
        dao.upsertBoardConfigValues(BoardConfigValuesEntity("cross-board", "2.0", "{\"motor_current_max\":55.5}", 107))
        room.close()
        val connection = BundledSQLiteDriver().open(database.path)
        connection.execSQL("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,board_id,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'cross-board',1,1,0,2468)")
        connection.close()
        val archive = exchange.resolve("android.zip")
        archive.outputStream().use { output ->
          DatabaseBackupArchive.write(
            database,
            DatabaseBackupArchive.manifest("android", TELEMETRY_DATABASE_VERSION, "host", database.length(), 1),
            output,
          )
        }
      }
      "import-ios" -> {
        val database = exchange.resolve("ios-restored.sqlite")
        val manifest = exchange.resolve("ios.zip").inputStream().use { DatabaseBackupArchive.extract(it, database) }
        assertEquals("ios", manifest.getString("platform"))
        assertEquals(TELEMETRY_DATABASE_VERSION, manifest.getInt("schemaVersion"))
        val connection = BundledSQLiteDriver().open(database.path)
        iosSchemaReconciliationStatements(hasDeletedAt = true, hasFaultCaptures = true, bootstrapLegacyTune = false)
          .forEach(connection::execSQL)
        connection.close()
        val room = open(database.path)
        val dao = room.telemetryDao()
        assertEquals("Cross Board", dao.getBoard("cross-board")?.name)
        assertEquals("\"durable\"", dao.getBoardSettings("cross-board").single { it.key == "description" }.valueJson)
        assertEquals("Cross Tune", dao.getTuneProfile("cross-tune")?.name)
        assertEquals("Cross Favorite", dao.getFavorite("cross-favorite")?.name)
        assertEquals("{\"motor_current_max\":55.5}", dao.getBoardConfigValues("cross-board", "2.0")?.valuesJson)
        val frame = dao.getFrames(0, 2000, "cross-board", 10).single()
        assertEquals("cross-board", frame.boardId)
        assertEquals(1000L, frame.capturedAtMs)
        assertEquals(2468, frame.speedCentiKmh)
        assertEquals(listOf(1000L), dao.getVescFaultCaptureSamples("cross-fault").map { it.capturedAtMs })
        room.close()
      }
    }
  }

  @Test
  fun productionMigrationGraphRejectsVersionsWithoutAPath() {
    assertTrue((3..36).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
    assertTrue((40..42).all { it in SUPPORTED_ANDROID_DATABASE_VERSIONS })
    assertTrue(listOf(1, 2, 37, 38, 39, 43).all { it !in SUPPORTED_ANDROID_DATABASE_VERSIONS })
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
    database.telemetryDao().upsertAppSetting(AppSettingEntity("sentinel", "\"original\"", 1)); database.close()
    database = open(incoming.path)
    database.telemetryDao().upsertAppSetting(AppSettingEntity("sentinel", "\"candidate\"", 2)); database.close()

    var failed = false
    try {
      replaceDatabaseFiles(incoming, target) { installed ->
        database = open(installed.path)
        runBlocking {
          assertEquals("\"candidate\"", database.telemetryDao().getAppSetting("sentinel")?.valueJson)
        }
        database.close()
        error("forced failure after candidate open")
      }
    } catch (_: IllegalStateException) { failed = true }

    assertTrue(failed)
    database = open(target.path)
    assertEquals("\"original\"", database.telemetryDao().getAppSetting("sentinel")?.valueJson)
    database.close()
    directory.deleteRecursively()
  }
}
