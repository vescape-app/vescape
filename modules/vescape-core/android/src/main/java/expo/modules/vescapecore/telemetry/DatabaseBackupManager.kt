package expo.modules.vescapecore.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

private const val MANIFEST_ENTRY = "manifest.json"
private const val DATABASE_ENTRY = "db.sqlite"

// @parity /modules/vescape-core/ios/telemetry/DatabaseBackupManager.swift
object DatabaseBackupManager {
  suspend fun createBackup(context: Context): Map<String, Any?> {
    val appContext = context.applicationContext
    TelemetryRepository.get(appContext).flushPending()

    val exportDir = File(appContext.cacheDir, "db-backups").apply { mkdirs() }
    val stamp = utcStamp()
    val sqliteExport = File(exportDir, "vescape-$stamp.sqlite")
    val zipExport = File(exportDir, "vesc-db-backup-$stamp.zip")
    sqliteExport.delete()
    zipExport.delete()

    val escapedPath = sqliteExport.absolutePath.replace("'", "''")
    TelemetryDatabase.get(appContext).openHelper.writableDatabase.execSQL("VACUUM INTO '$escapedPath'")

    ZipOutputStream(FileOutputStream(zipExport)).use { zip ->
      zip.putNextEntry(ZipEntry(MANIFEST_ENTRY))
      zip.write(manifest(context, sqliteExport.length()).toString().toByteArray(Charsets.UTF_8))
      zip.closeEntry()

      zip.putNextEntry(ZipEntry(DATABASE_ENTRY))
      FileInputStream(sqliteExport).use { it.copyTo(zip) }
      zip.closeEntry()
    }
    sqliteExport.delete()

    return mapOf(
      "uri" to Uri.fromFile(zipExport).toString(),
      "name" to zipExport.name,
      "sizeBytes" to zipExport.length(),
    )
  }

  fun restoreBackup(context: Context, uriString: String) {
    val appContext = context.applicationContext
    val workDir = File(appContext.cacheDir, "db-restore").apply {
      deleteRecursively()
      mkdirs()
    }
    val restoredDb = File(workDir, "restored.sqlite")
    val manifest = extractBackup(appContext, uriString, restoredDb)
    validateManifest(manifest)
    validateDatabase(restoredDb)

    resetRepositoriesAndCloseDatabase()

    val dbFile = appContext.getDatabasePath(TELEMETRY_DATABASE_NAME)
    dbFile.parentFile?.mkdirs()
    val rollback = File(dbFile.parentFile, "$TELEMETRY_DATABASE_NAME.restore-tmp")
    rollback.delete()
    sidecarFiles(dbFile).forEach { it.delete() }

    var movedActive = false
    try {
      if (dbFile.exists()) {
        check(dbFile.renameTo(rollback)) { "Could not prepare current database rollback file" }
        movedActive = true
      }
      check(restoredDb.copyTo(dbFile, overwrite = true).exists()) { "Could not install restored database" }
      validateDatabase(dbFile)
      TelemetryDatabase.get(appContext).openHelper.readableDatabase.query("SELECT 1").close()
      rollback.delete()
    } catch (e: Exception) {
      dbFile.delete()
      sidecarFiles(dbFile).forEach { it.delete() }
      if (movedActive && rollback.exists()) {
        rollback.renameTo(dbFile)
      }
      resetRepositoriesAndCloseDatabase()
      TelemetryDatabase.get(appContext).openHelper.readableDatabase.query("SELECT 1").close()
      throw e
    } finally {
      workDir.deleteRecursively()
    }
  }

  /**
   * Replace the app-data database with an empty one, taking the Sync Cursors, the pending Sync
   * Actions and the Account binding with it (#284).
   *
   * Deleting the file rather than clearing tables is what makes the Account change safe: nothing can
   * survive with a cursor position or a binding that belonged to the previous Account. The wipe is
   * local maintenance and emits no Sync Actions to either Account — the log is part of what goes.
   *
   * @parity /modules/vescape-core/ios/telemetry/DatabaseBackupManager.swift `replaceWithFreshDatabase`
   */
  fun replaceWithFreshDatabase(context: Context) {
    val appContext = context.applicationContext
    resetRepositoriesAndCloseDatabase()

    val dbFile = appContext.getDatabasePath(TELEMETRY_DATABASE_NAME)
    // Checked rather than best-effort: a delete that quietly failed would reopen the previous
    // Account's database, which the caller is about to hand a different Account's Device Token.
    check(!dbFile.exists() || dbFile.delete()) { "Could not remove the existing database" }
    sidecarFiles(dbFile).forEach { it.delete() }

    // Opening rebuilds the schema from the entities, so the new database starts unbound.
    TelemetryDatabase.get(appContext).openHelper.readableDatabase.query("SELECT 1").close()
  }

  private fun extractBackup(context: Context, uriString: String, restoredDb: File): JSONObject {
    var manifest: JSONObject? = null
    val uri = Uri.parse(uriString)
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "Could not open backup file" }
      ZipInputStream(input).use { zip ->
        generateSequence { zip.nextEntry }.forEach { entry ->
          when (entry.name) {
            MANIFEST_ENTRY -> manifest = JSONObject(zip.readBytes().toString(Charsets.UTF_8))
            DATABASE_ENTRY -> FileOutputStream(restoredDb).use { zip.copyTo(it) }
          }
          zip.closeEntry()
        }
      }
    }
    require(restoredDb.exists() && restoredDb.length() > 0) { "Backup missing db.sqlite" }
    return requireNotNull(manifest) { "Backup missing manifest.json" }
  }

  private fun validateManifest(manifest: JSONObject) {
    require(manifest.optString("format") == "vesc-db-backup") { "Unsupported backup format" }
    val schemaVersion = manifest.optInt("schemaVersion", -1)
    require(schemaVersion in 1..TELEMETRY_DATABASE_VERSION) {
      "Backup schema version $schemaVersion is newer than app schema $TELEMETRY_DATABASE_VERSION"
    }
  }

  private fun validateDatabase(file: File) {
    val db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
    db.use {
      it.rawQuery("PRAGMA integrity_check", null).use { cursor ->
        require(cursor.moveToFirst() && cursor.getString(0) == "ok") { "Backup database integrity check failed" }
      }
      it.rawQuery("PRAGMA user_version", null).use { cursor ->
        require(cursor.moveToFirst()) { "Backup database schema version missing" }
        val userVersion = cursor.getInt(0)
        require(userVersion in 1..TELEMETRY_DATABASE_VERSION) {
          "Backup schema version $userVersion is newer than app schema $TELEMETRY_DATABASE_VERSION"
        }
      }
    }
  }

  private fun manifest(context: Context, dbSizeBytes: Long): JSONObject =
    JSONObject(
      mapOf(
        "format" to "vesc-db-backup",
        "createdAt" to System.currentTimeMillis(),
        "schemaVersion" to TELEMETRY_DATABASE_VERSION,
        "appVersion" to appVersion(context),
        "platform" to "android",
        "dbSizeBytes" to dbSizeBytes,
      ),
    )

  private fun appVersion(context: Context): String {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return info.versionName ?: "unknown"
  }

  private fun resetRepositoriesAndCloseDatabase() {
    TelemetryRepository.resetForDatabaseSwap()
    AppDataRepository.resetForDatabaseSwap()
    ProfileStatsRepository.resetForDatabaseSwap()
    RideHistoryRepository.resetForDatabaseSwap()
    TelemetryDatabase.closeAndReset()
  }

  private fun sidecarFiles(dbFile: File): List<File> =
    listOf(File("${dbFile.absolutePath}-wal"), File("${dbFile.absolutePath}-shm"))

  private fun utcStamp(): String =
    SimpleDateFormat("yyyy-MM-dd_HHmmss", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())
}
