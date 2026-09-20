package expo.modules.vescapecore.telemetry

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import androidx.sqlite.execSQL
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.recording.RecordingStorageFailureKind
import java.io.File
import java.io.StringWriter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RideExportSnapshotTest {
  private fun resetDatabase(context: android.content.Context) {
    // All owners must release their DAO before closing the process-wide Room instance.
    TelemetryRepository.resetForDatabaseSwap()
    AppDataRepository.resetForDatabaseSwap()
    ProfileStatsRepository.resetForDatabaseSwap()
    RideHistoryRepository.resetForDatabaseSwap()
    TelemetryDatabase.closeAndReset()
    context.deleteDatabase(TELEMETRY_DATABASE_NAME)
  }

  @Test fun productionSnapshotKeepsRecordingWritable(): Unit = runBlocking {
    // Instrumentation APK context owns disposable data, never the installed application's DB.
    val context = InstrumentationRegistry.getInstrumentation().context
    val db = TelemetryDatabase.get(context)
    try {
      val dao = db.telemetryDao()
      fun point(i: Int) = RideTrackPointEntity(recordingId = "ride", boardId = "board", fixAtMs = i.toLong(),
        latitudeE7 = i, longitudeE7 = -i, accuracyCm = 100,
        gpsSpeedCentiMps = null, bearingCentiDeg = null, altitudeCm = null)
      val count = RideExport.BATCH_SIZE * 2 + 1
      dao.insertRideTrackPoints((0 until count).map(::point))
      val reading = CountDownLatch(1)
      val committed = CountDownLatch(1)
      val recording = async(Dispatchers.IO) {
        check(reading.await(10, TimeUnit.SECONDS))
        try { dao.insertRideTrackPoints(listOf(point(count))) } finally { committed.countDown() }
      }
      var paused = false
      val writer = object : StringWriter() {
        override fun write(text: String) {
          if (!paused && text.startsWith("<trkpt ")) {
            paused = true
            reading.countDown()
            check(committed.await(10, TimeUnit.SECONDS)) { "Export blocks recording commit" }
          }
          super.write(text)
        }
      }
      TelemetryDatabase.withRideExportSnapshot(context) {
        RideExport.writeGpx(it, writer, 0, count.toLong(), "board", "ride", "Snapshot")
      }
      recording.await()
      assertEquals(count, "<trkpt ".toRegex().findAll(writer.toString()).count())
      val fresh = StringWriter()
      TelemetryDatabase.withRideExportSnapshot(context) {
        RideExport.writeGpx(it, fresh, 0, count.toLong(), "board", "ride", "Fresh")
      }
      assertEquals(count + 1, "<trkpt ".toRegex().findAll(fresh.toString()).count())
    } finally {
      resetDatabase(context)
    }
  }

  @Test fun productionBackupRestoreAndStartupProbe(): Unit = runBlocking {
    val context = InstrumentationRegistry.getInstrumentation().context
    var backup: File? = null
    try {
      RecordingStorageFailure.initialize(context)
      assertNull(RecordingStorageFailure.value())
      val dao = TelemetryDatabase.get(context).telemetryDao()
      dao.insertRideTrackPoints(listOf(RideTrackPointEntity(recordingId = null, boardId = null, fixAtMs = 123,
        latitudeE7 = 1, longitudeE7 = -1, accuracyCm = 100,
        gpsSpeedCentiMps = null, bearingCentiDeg = null, altitudeCm = null)))
      RideHistoryRepository.get(context).getPage(emptyMap())
      ProfileStatsRepository.get(context).getProfileStatsSnapshot(emptyMap())
      val result = DatabaseBackupManager.createBackup(context)
      backup = File(java.net.URI(result["uri"] as String))
      dao.clearRideTrackPoints()
      assertNull(dao.lastRideTrackAt())
      DatabaseBackupManager.restoreBackup(context, result["uri"] as String)
      assertEquals(123L, TelemetryDatabase.get(context).telemetryDao().lastRideTrackAt())
    } finally {
      resetDatabase(context)
      backup?.delete()
    }
  }

  @Test fun bundledErrorsKeepStorageFailurePolicy() {
    val context = InstrumentationRegistry.getInstrumentation().context
    val file = File.createTempFile("storage-errors", ".sqlite", context.cacheDir)
    val driver = BundledSQLiteDriver()
    fun failure(kind: RecordingStorageFailureKind, operation: () -> Unit) {
      val error = runCatching(operation).exceptionOrNull() ?: error("Expected SQLite failure")
      assertEquals(kind, RecordingStorageFailure.classify(error))
      assertEquals(kind, RecordingStorageFailure.classify(IllegalStateException("wrapped", error)))
    }
    try {
      driver.open(file.path).use { db ->
        db.execSQL("CREATE TABLE probe (value BLOB)")
        failure(RecordingStorageFailureKind.WriteFailed) { db.execSQL("SELECT * FROM missing") }
        db.prepare("PRAGMA max_page_count=2").use { it.step() }
        failure(RecordingStorageFailureKind.FullDisk) { db.execSQL("INSERT INTO probe VALUES (zeroblob(100000))") }
      }
      driver.open(file.path, SQLITE_OPEN_READONLY).use { db ->
        failure(RecordingStorageFailureKind.StorageUnavailable) { db.execSQL("INSERT INTO probe VALUES (1)") }
      }
      failure(RecordingStorageFailureKind.StorageUnavailable) { driver.open(File(file, "missing.db").path).close() }
      file.writeText("invalid sqlite database".repeat(100))
      failure(RecordingStorageFailureKind.StorageUnavailable) {
        driver.open(file.path).use { it.execSQL("SELECT * FROM sqlite_master") }
      }
    } finally { file.delete() }
  }
}
