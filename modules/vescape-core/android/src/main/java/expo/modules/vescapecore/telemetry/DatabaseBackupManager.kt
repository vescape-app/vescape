package expo.modules.vescapecore.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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

    zipExport.outputStream().use { output ->
      DatabaseBackupArchive.write(sqliteExport, manifest(context, sqliteExport.length()), output)
    }
    sqliteExport.delete()

    return mapOf(
      "uri" to Uri.fromFile(zipExport).toString(),
      "name" to zipExport.name,
      "sizeBytes" to zipExport.length(),
    )
  }

  /** Caller must first await the BoardSessionController-owned stop callback. */
  internal fun restoreBackup(context: Context, uriString: String) {
    val appContext = context.applicationContext
    val workDir = File(appContext.cacheDir, "db-restore").apply {
      deleteRecursively()
      mkdirs()
    }
    val restoredDb = File(workDir, "restored.sqlite")
    val manifest = extractBackup(appContext, uriString, restoredDb)
    val manifestVersion = validateDatabase(restoredDb, validateManifest(manifest))
    if (manifestVersion.platform == "ios") reconcileIosSchema(restoredDb, manifestVersion.bootstrapLegacyTune)
    if (readDatabaseVersion(restoredDb) == 0) {
      SQLiteDatabase.openDatabase(restoredDb.path, null, SQLiteDatabase.OPEN_READWRITE).use {
        it.execSQL("PRAGMA user_version = ${manifestVersion.roomVersion}")
      }
    }

    val dbFile = appContext.getDatabasePath(TELEMETRY_DATABASE_NAME)
    dbFile.parentFile?.mkdirs()
    try {
      resetRepositoriesAndCloseDatabase()
      replaceDatabaseFiles(restoredDb, dbFile) { installed ->
        validateDatabase(installed, manifestVersion.copy(declaredVersion = manifestVersion.roomVersion))
        TelemetryDatabase.get(appContext).openHelper.readableDatabase.query("SELECT 1").close()
      }
    } catch (e: Exception) {
      resetRepositoriesAndCloseDatabase()
      TelemetryDatabase.get(appContext).openHelper.readableDatabase.query("SELECT 1").close()
      throw e
    } finally {
      workDir.deleteRecursively()
    }
  }

  private fun extractBackup(context: Context, uriString: String, restoredDb: File): JSONObject {
    val uri = Uri.parse(uriString)
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "Could not open backup file" }
      return DatabaseBackupArchive.extract(input, restoredDb)
    }
  }

  private data class BackupSchema(
    val platform: String,
    val declaredVersion: Int,
    val roomVersion: Int,
    val bootstrapLegacyTune: Boolean = false,
  )

  private fun validateManifest(manifest: JSONObject): BackupSchema {
    require(manifest.optString("format") == "vesc-db-backup") { "Unsupported backup format" }
    val schemaVersion = manifest.optInt("schemaVersion", -1)
    val platform = manifest.optString("platform")
    val roomVersion = roomVersionForBackup(platform, schemaVersion)
    if (!(platform == "ios" && schemaVersion == 1)) requireSupportedAndroidDatabaseVersion(roomVersion)
    return BackupSchema(platform, schemaVersion, roomVersion)
  }

  private fun validateDatabase(file: File, manifestVersion: BackupSchema): BackupSchema {
    val db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
    db.use {
      it.rawQuery("PRAGMA integrity_check", null).use { cursor ->
        require(cursor.moveToFirst() && cursor.getString(0) == "ok") { "Backup database integrity check failed" }
      }
      val resolved = it.rawQuery("PRAGMA user_version", null).use { cursor ->
        require(cursor.moveToFirst()) { "Backup database schema version missing" }
        val userVersion = cursor.getInt(0)
        require(userVersion == manifestVersion.declaredVersion || (userVersion == 0 && manifestVersion.platform == "ios")) {
          "Backup manifest schema version ${manifestVersion.declaredVersion} does not match database schema version $userVersion"
        }
        if (userVersion > 0) manifestVersion
        else {
          val (version, bootstrapTune) = effectiveRoomVersionFromIosLedger(it, manifestVersion)
          manifestVersion.copy(roomVersion = version, bootstrapLegacyTune = bootstrapTune)
        }
      }
      requireSupportedAndroidDatabaseVersion(resolved.roomVersion)
      return resolved
    }
  }

  private fun effectiveRoomVersionFromIosLedger(db: SQLiteDatabase, manifest: BackupSchema): Pair<Int, Boolean> {
    require(manifest.platform == "ios") { "Only iOS databases may omit user_version" }
    val registered = listOf(
      "v1", "v2_tune_profiles", "v23_tune_profile_metadata", "v24_tune_profile_refloat_base_version",
      "v25_board_warnings", "v26_alert_source", "v27_alert_board_id", "v29_drop_map_points",
      "v30_favorites", "v31_favorite_media", "v32_alert_repeat", "v33_board_config_values",
      "v34_board_config_change_notices", "v35_alert_config_relative", "v36_motor_config_values",
      "v40_vesc_faults", "v41_board_deleted_at", "v42_telemetry_board_id", "v43_ride_track",
    )
    val applied = db.rawQuery("SELECT identifier FROM grdb_migrations", null).use { cursor ->
      buildList { while (cursor.moveToNext()) add(cursor.getString(0)) }
    }
    val lastIndex = registered.indexOfLast(applied::contains)
    require(lastIndex >= 0 && applied.toSet() == registered.take(lastIndex + 1).toSet()) {
      "iOS migration ledger is not a valid production prefix"
    }
    val lastIdentifier = registered[lastIndex]
    val effective = lastIdentifier.drop(1).takeWhile(Char::isDigit).toInt()
    require(effective <= manifest.declaredVersion || manifest.declaredVersion == 1) {
      "Backup manifest schema version ${manifest.declaredVersion} is older than its migration ledger v$effective"
    }
    return (if (effective <= 2) 22 else effective) to (lastIdentifier == "v1")
  }

  /** Convert iOS-only columns into Room-owned settings before Room validates the candidate. */
  private fun reconcileIosSchema(file: File, bootstrapLegacyTune: Boolean) {
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
      val boardColumns = db.rawQuery("PRAGMA table_info(boards)", null).use { cursor ->
        buildSet { while (cursor.moveToNext()) add(cursor.getString(cursor.getColumnIndexOrThrow("name"))) }
      }
      if ("transport" in boardColumns) {
        val hasFaultCaptures = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vesc_fault_capture_samples'", null).use { it.moveToFirst() }
        iosSchemaReconciliationStatements("deleted_at" in boardColumns, hasFaultCaptures, bootstrapLegacyTune).forEach(db::execSQL)
      } else {
        require(db.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tune_profiles'", null).use { it.moveToFirst() }) {
          "iOS backup migration ledger claims Tune Profiles but the table is missing"
        }
      }
    }
  }

  private fun readDatabaseVersion(file: File): Int =
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.rawQuery("PRAGMA user_version", null).use { cursor ->
        check(cursor.moveToFirst())
        cursor.getInt(0)
      }
    }

  private fun manifest(context: Context, dbSizeBytes: Long): JSONObject =
    DatabaseBackupArchive.manifest(
      platform = "android",
      schemaVersion = TELEMETRY_DATABASE_VERSION,
      appVersion = appVersion(context),
      dbSizeBytes = dbSizeBytes,
      createdAt = System.currentTimeMillis(),
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

  private fun utcStamp(): String =
    SimpleDateFormat("yyyy-MM-dd_HHmmss", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())
}
