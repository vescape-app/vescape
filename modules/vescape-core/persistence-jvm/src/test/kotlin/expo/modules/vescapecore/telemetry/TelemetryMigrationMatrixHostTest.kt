package expo.modules.vescapecore.telemetry

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.room.testing.MigrationTestHelper
import java.nio.file.Files
import java.nio.file.Path
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Room migration tests that start from the committed schema exports in `android/schemas/`: each one
 * is the database exactly as Room created it fresh at that version. Versions that only ever existed
 * as an intermediate step (10, 23, 28, 30, 33–35, 37–39, 41, 44–47, 50) have no export; every
 * migration edge still runs on the way up from v3.
 */
class TelemetryMigrationMatrixHostTest {
  private val schemas = Path.of("../android/schemas")

  private fun manifest() = JSONObject(
    Files.readString(Path.of("../shared/migration-fixture-manifest.json")),
  )

  @Test fun sharedManifestExactlyCoversTheProductionRoomGraph() {
    val room = manifest().getJSONObject("room")
    val declared = room.getJSONArray("supportedStarts").let { values ->
      (0 until values.length()).map(values::getInt).toSet()
    }
    assertEquals(SUPPORTED_ANDROID_DATABASE_VERSIONS, declared)
    assertEquals(TelemetryMigrations.all.map { it.startVersion }.toSet(), declared - VESCAPE_DATABASE_VERSION)
  }

  private fun SQLiteConnection.exec(sql: String) = prepare(sql).use { it.step() }

  private fun SQLiteConnection.text(sql: String): String? = prepare(sql).use {
    if (it.step() && !it.isNull(0)) it.getText(0) else null
  }

  private fun SQLiteConnection.long(sql: String): Long? = prepare(sql).use {
    if (it.step() && !it.isNull(0)) it.getLong(0) else null
  }

  /** Runs production edges one by one on an open connection, for tests that seed between steps. */
  private fun migrate(db: SQLiteConnection, from: Int, to: Int) {
    var version = from
    while (version < to) {
      val step = TelemetryMigrations.all.singleOrNull { it.startVersion == version }
        ?: error("No production migration from $version to $to")
      step.migrate(db)
      version = step.endVersion
    }
    assertEquals(to, version)
  }

  private fun productionMigrations(reached: MutableSet<Pair<Int, Int>> = mutableSetOf()): List<Migration> =
    TelemetryMigrations.all.map { step ->
      object : Migration(step.startVersion, step.endVersion) {
        override fun migrate(connection: SQLiteConnection) {
          step.migrate(connection)
          reached += step.startVersion to step.endVersion
        }
      }
    }

  private fun openWithProductionGraph(path: String) {
    val database = Room.databaseBuilder<VescapeRoomDatabase>(path)
      .setDriver(BundledSQLiteDriver())
      .addMigrations(*productionMigrations().toTypedArray())
      .build()
    try {
      runBlocking { database.telemetryDao().getAppSetting("matrix-open") }
    } finally {
      database.close()
    }
  }

  private fun exportedVersions(): List<Int> =
    Files.list(schemas.resolve(VescapeRoomDatabase::class.qualifiedName!!)).use { files ->
      files.map { it.fileName.toString().removeSuffix(".json").toInt() }.toList()
    }.sorted()

  /**
   * Creates [start] from its export, lets [seed] write rows in that version's shape, migrates to the
   * current version with Room validating every table, and hands the result to [check].
   */
  private fun migrateFromExport(
    start: Int,
    reached: MutableSet<Pair<Int, Int>> = mutableSetOf(),
    seed: SQLiteConnection.() -> Unit = {},
    check: SQLiteConnection.() -> Unit = {},
  ): Path {
    val path = Files.createTempFile("vescape-v$start-", ".db").also(Files::delete)
    val helper = MigrationTestHelper(schemas, path, BundledSQLiteDriver(), VescapeRoomDatabase::class)
    helper.createDatabase(start).use { it.seed() }
    helper.runMigrationsAndValidate(VESCAPE_DATABASE_VERSION, productionMigrations(reached)).use { it.check() }
    return path
  }

  /** The v3 rows every era test starts from: one Board, one Alert, one frame, one bucket. */
  private fun SQLiteConnection.seedV3Board() {
    exec("INSERT INTO boards VALUES ('board-era3','Era Three','kept','ble-era3',1,100,42.0,63.0)")
    exec("INSERT INTO alerts VALUES ('alert-era3','speed',21.5,NULL,1,'beep',101)")
    exec("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,device_id,device_name,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'ble-era3','Era Three',1,1,0,1234)")
    exec("INSERT INTO telemetry_minute_buckets VALUES (960,'ble-era3','Era Three',2,1000,1010,2400,1300,50000,1200,800,700,0,100,120,1,1,20,300)")
  }

  /** An open connection on [version] exactly as Room created it, for tests that step edge by edge. */
  private fun createFromExport(version: Int, path: Path): SQLiteConnection =
    MigrationTestHelper(schemas, path, BundledSQLiteDriver(), VescapeRoomDatabase::class).createDatabase(version)

  @Test fun everyExportedSchemaMigratesToTheCurrentSchema() {
    val versions = exportedVersions()
    assertEquals("Commit the schema export for the current version", VESCAPE_DATABASE_VERSION, versions.last())
    assertEquals("The oldest supported start keeps its export", 3, versions.first())
    val reached = mutableSetOf<Pair<Int, Int>>()
    for (start in versions) {
      val path = migrateFromExport(start, reached)
      openWithProductionGraph(path.toString())
      assertMatchesSharedSchema("migrated-from-export-v$start", path)
      Files.deleteIfExists(path)
    }
    assertEquals(TelemetryMigrations.all.map { it.startVersion to it.endVersion }.toSet(), reached)
  }

  /** A v3 phone that never updated reaches today with its Board, telemetry, and buckets intact. */
  @Test fun v3BoardTelemetryAndBucketsSurviveTheWholeUpgrade() {
    val path = migrateFromExport(3, seed = { seedV3Board() }) {
      assertEquals("Era Three", text("SELECT name FROM boards WHERE id='board-era3'"))
      assertEquals("\"kept\"", text("SELECT value_json FROM board_settings WHERE board_id='board-era3' AND key='description'"))
      assertEquals(1234L, long("SELECT speed_centi_kmh FROM telemetry_frames WHERE captured_at_ms=1000"))
      assertEquals("board-era3", text("SELECT board_id FROM telemetry_frames WHERE captured_at_ms=1000"))
      assertEquals("board-era3", text("SELECT board_id FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
      fun bucket(column: String) = long("SELECT $column FROM telemetry_minute_buckets WHERE bucket_start_ms=960")
      assertEquals(2L, bucket("sample_count"))
      assertEquals(2400L, bucket("sum_abs_speed_centi_kmh"))
      assertEquals(50000L, bucket("min_battery_voltage_mv"))
      assertEquals(0L, bucket("battery_used_wh_milli"))
      assertEquals(100L, bucket("first_odometer_cm"))
      assertEquals(120L, bucket("last_odometer_cm"))
      assertEquals(20L, bucket("gps_distance_cm"))
      assertEquals(null, bucket("moving_speed_sample_count"))
      // Before v50's Alert Presets existed nothing was selected, so every metric is Off (#591).
      for (metric in listOf("speed", "duty", "motor-temp", "controller-temp", "battery")) {
        assertEquals(metric, "preset(off)", text("SELECT spec FROM alerts WHERE id='preset:$metric'"))
      }
      assertEquals(0L, long("SELECT COUNT(*) FROM pragma_table_info('alerts') WHERE name IN ('source','sound_type','beep_count')"))
    }
    Files.deleteIfExists(path)
  }

  /** v12 replaced the single settings row with key-value settings; the old row is not carried. */
  @Test fun v4SingletonSettingsGiveWayToKeyValueSettings() {
    val path = migrateFromExport(4, seed = {
      exec("INSERT INTO app_settings (id,live_history_limit,auto_connect,auto_recording) VALUES (1,17,0,1)")
    }) {
      assertEquals(0L, long("SELECT COUNT(*) FROM app_settings"))
    }
    Files.deleteIfExists(path)
  }

  @Test fun v12AppSettingKeepsItsValue() {
    val path = migrateFromExport(12, seed = {
      exec("INSERT INTO app_settings VALUES ('era-setting','\"preserved\"',1200)")
    }) {
      assertEquals("\"preserved\"", text("SELECT value_json FROM app_settings WHERE key='era-setting'"))
    }
    Files.deleteIfExists(path)
  }

  @Test fun v31FavoriteSurvives() {
    val path = migrateFromExport(31, seed = {
      exec("INSERT INTO favorites VALUES ('favorite-era31','board-era3','Favorite',900,1100,30,31,2,1,20,100,1200,1234,3)")
    }) {
      assertEquals("Favorite", text("SELECT name FROM favorites WHERE id='favorite-era31'"))
    }
    Files.deleteIfExists(path)
  }

  /** Single alerts carry their beep count in the sound string (#578); the column is gone. */
  @Test fun v32AlertSoundsBecomeSpecs() {
    val path = migrateFromExport(32, seed = {
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,beep_count) VALUES ('board-era3','speech-era32','speed',20,1,'tts:Slow down',3200,3)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,beep_count) VALUES ('board-era3','beep-era32','speed',25,1,'preset:beep',3201,2)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,beep_count) VALUES ('board-era3','urgent-era32','speed',30,1,'preset:urgent',3202,5)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,beep_count) VALUES ('board-era3','tick-era32','duty',80,90,1,'preset:tick',3203,3)")
      for (index in 0..2) {
        exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,source,beep_count) VALUES ('board-era3','preset:battery:$index','battery',${30 - index * 10},1,'tts:Battery {percent}%',3204,'preset',3)")
      }
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,source,beep_count) VALUES ('board-era3','preset:motor-temp:0','motor-temp',95,1,'tts:Motor {value} {unit}',3205,'preset',3)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at,beep_count) VALUES ('board-era3','custom-battery-era32','battery',25,1,'tts:Battery {percent}%',3206,3)")
    }) {
      assertEquals("tts:Slow down", text("SELECT spec FROM alerts WHERE id='speech-era32'"))
      assertEquals("alert(2):warning", text("SELECT spec FROM alerts WHERE id='beep-era32'"))
      assertEquals("alert(5):critical", text("SELECT spec FROM alerts WHERE id='urgent-era32'"))
      assertEquals("preset:tick", text("SELECT spec FROM alerts WHERE id='tick-era32'"))
      assertEquals("tts:Battery {percent}%", text("SELECT spec FROM alerts WHERE id='custom-battery-era32'"))
      assertEquals(0L, long("SELECT COUNT(*) FROM alerts WHERE id LIKE 'preset:%:%'"))
    }
    Files.deleteIfExists(path)
  }

  @Test fun v36BoardConfigValuesSurvive() {
    val path = migrateFromExport(36, seed = {
      exec("INSERT INTO board_config_values VALUES ('board-era3','2.0','{\"motor_current_max\":55.5}',3300)")
    }) {
      assertEquals("{\"motor_current_max\":55.5}", text("SELECT values_json FROM board_config_values WHERE board_id='board-era3'"))
    }
    Files.deleteIfExists(path)
  }

  /** The v49 Alert Preset Board Settings and copied preset rows fold into one row per metric (#591). */
  @Test fun v49AlertPresetSettingsFoldIntoPresetRows() {
    val path = migrateFromExport(49, seed = {
      exec("INSERT INTO boards (id,name,created_at) VALUES ('board-era3','Era Three',100)")
      exec("INSERT INTO board_settings VALUES ('board-era3','alertPreset','{\"speed\":\"safe\",\"duty\":\"custom\",\"motor-temp\":\"normal\"}',5000)")
      exec("INSERT INTO board_settings VALUES ('board-era3','alertPresetSound','{\"speed\":{\"geiger\":\"geiger:mid\"}}',5000)")
      exec("INSERT INTO board_settings VALUES ('board-era3','matchBoardConfig','{\"motor-temp\":true,\"speed\":true}',5000)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,source,threshold_kind,beep_count) VALUES ('board-era3','preset:speed:0','speed',36,45,1,'geiger:hard',5001,'preset','fixed',3)")
      exec("INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,source,threshold_kind,beep_count) VALUES ('board-era3','preset:duty:0','duty',80,90,1,'geiger:soft',5002,'preset','fixed',3)")
    }) {
      val presets = mapOf(
        "speed" to "preset(safe):geiger=mid",
        "duty" to "preset(off):geiger=soft",
        "motor-temp" to "preset(normal):match=on",
        "controller-temp" to "preset(off)",
        "battery" to "preset(off)",
      )
      for ((metric, spec) in presets) {
        assertEquals(metric, spec, text("SELECT spec FROM alerts WHERE id='preset:$metric'"))
      }
      assertEquals(0L, long("SELECT COUNT(*) FROM alerts WHERE id LIKE 'preset:%:%'"))
      assertEquals(0L, long("SELECT COUNT(*) FROM board_settings WHERE key IN ('alertPreset','matchBoardConfig','alertPresetSound')"))
    }
    Files.deleteIfExists(path)
  }

  /** The first Android backups (v14) and the Privacy Zone era (v18–v20) the iOS host restores. */
  @Test fun exportAuthenticFirstAndroidBackupGenerationForIOSHost() {
    if (System.getenv("VESCAPE_BACKUP_PHASE") != "export-android") return
    val exchange = System.getenv("VESCAPE_BACKUP_EXCHANGE")?.let(::File) ?: return
    for (version in listOf(14, 18, 19, 20)) {
      val database = exchange.resolve("android-v$version.sqlite")
      MigrationTestHelper(schemas, database.toPath(), BundledSQLiteDriver(), VescapeRoomDatabase::class)
        .createDatabase(version).use { db ->
          val battery = if (version >= 19) "'{\"cells\":20}'" else "42.0,63.0"
          db.exec("INSERT INTO boards VALUES ('board-era3','Era Three','kept','ble-era3',1,100,$battery)")
          db.exec("INSERT INTO app_settings VALUES ('era-setting','\"preserved\"',1200)")
          db.exec("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,device_id,device_name,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'ble-era3','Era Three',1,1,0,1234)")
          db.exec("INSERT INTO telemetry_minute_buckets (bucket_start_ms,device_id,device_name,sample_count,first_sample_at_ms,last_sample_at_ms,sum_abs_speed_centi_kmh,max_abs_speed_centi_kmh,min_battery_voltage_mv,max_motor_current_abs_ma,max_battery_current_abs_ma,battery_used_wh_milli,battery_regen_wh_milli,max_duty_abs_permille,fault_count,first_odometer_cm,last_odometer_cm,gps_point_count,precise_gps_point_count,gps_distance_cm,max_gps_speed_centi_mps) VALUES (960,'ble-era3','Era Three',2,1000,1010,2400,1300,50000,1200,800,0,0,700,0,100,120,1,1,20,300)")
          if (version == 14) {
            db.exec("INSERT INTO tune_profiles (id,board_id,name,fields_json,created_at,updated_at) VALUES ('v14-tune','board-era3','V14 Tune','{}',1400,1401)")
          } else {
            db.exec("INSERT INTO privacy_zones VALUES ('era-zone','home','Era Zone',1,510000000,170000000,250,1800,1801)")
          }
        }
      val kind = if (version == 14) "first-export" else "historical-export"
      exchange.resolve("android-v$version.zip").outputStream().use { output ->
        DatabaseBackupArchive.write(database, DatabaseBackupArchive.manifest("android", version, kind, database.length(), 1), output)
      }
    }
  }

  /**
   * v51 folds each live Board's own settings and old preset rows (#591): nothing leaks between
   * Boards, a tombstone gets no preset rows, geiger falls back to the old rows, and a metric whose
   * old preset points were all disabled becomes Off while a partly disabled ladder keeps its level.
   * A plain Normal level is the app default and writes no row; an unset level stays an explicit Off.
   * @parity /modules/vescape-core/ios/telemetry/TelemetryMigrationTests.swift `testPresetRowsMigrationKeepsBoardsApartAndHonoursDisabledPoints`
   */
  @Test fun presetRowsMigrationKeepsBoardsApartAndHonoursDisabledPoints() {
    val path = Files.createTempFile("vescape-v50-presets-", ".db").also(Files::delete)
    createFromExport(49, path).use { db ->
      migrate(db, 49, 50)
      db.exec("INSERT INTO boards (id,name,ble_id,created_at,deleted_at) VALUES ('board-1','One',NULL,1,NULL),('board-2','Two',NULL,2,NULL),('board-3','Three',NULL,3,4)")
      db.exec("""INSERT INTO board_settings VALUES ('board-1','alertPreset','{"speed":"minimal","battery":"safe"}',1),('board-1','alertPresetSound','{"speed":{"geiger":"geiger:hard"}}',1),('board-2','alertPreset','{"speed":"normal","duty":"normal"}',1),('board-2','matchBoardConfig','{"duty":true}',1),('board-3','alertPreset','{"speed":"safe"}',1)""")
      for ((board, id, control, enabled, sound, source) in listOf(
        Row6("board-1", "preset:speed:0", "speed", 0, "geiger:soft", "'preset'"),
        Row6("board-1", "preset:speed:1", "speed", 1, "geiger:soft", "'preset'"),
        Row6("board-1", "preset:battery:0", "battery", 0, "tts:Battery {percent}%", "'preset'"),
        Row6("board-1", "preset:battery:1", "battery", 0, "tts:Battery {percent}%", "'preset'"),
        Row6("board-2", "preset:duty:0", "duty", 0, "geiger:mid", "'preset'"),
        Row6("board-2", "preset:duty:1", "duty", 0, "geiger:mid", "'preset'"),
        Row6("board-3", "preset:speed:0", "speed", 1, "geiger:soft", "'preset'"),
        Row6("board-3", "rider-3", "speed", 1, "alert(1):warning", "NULL"),
      )) {
        db.exec("INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,source) VALUES ('$board','$id','$control',20,NULL,$enabled,'$sound',1,$source)")
      }
      migrate(db, 50, 51)
      fun specs(board: String) = db.prepare("SELECT id, spec FROM alerts WHERE board_id='$board'").use { statement ->
        buildMap { while (statement.step()) put(statement.getText(0), statement.getText(1)) }
      }
      assertEquals(
        mapOf(
          "preset:speed" to "preset(minimal):geiger=hard",
          "preset:duty" to "preset(off)",
          "preset:motor-temp" to "preset(off)",
          "preset:controller-temp" to "preset(off)",
          "preset:battery" to "preset(off)",
        ),
        specs("board-1"),
      )
      assertEquals(
        mapOf(
          // Normal with no options is the app default: no row.
          "preset:duty" to "preset(off):geiger=mid,match=on",
          "preset:motor-temp" to "preset(off)",
          "preset:controller-temp" to "preset(off)",
          "preset:battery" to "preset(off)",
        ),
        specs("board-2"),
      )
      assertEquals(mapOf("rider-3" to "alert(1):warning"), specs("board-3"))
    }
    Files.deleteIfExists(path)
  }

  /**
   * v52 drops durable recording identity (ADR 0041): two recordings of one Board in one minute fold
   * into one bucket, legacy fixes without accuracy keep reading as precise, and Room opens the
   * result against the production entities.
   * @parity /modules/vescape-core/ios/telemetry/TelemetryMigrationTests.swift `testDropRideRecordingsFoldsSharedMinutes`
   */
  @Test fun dropRideRecordingsFoldsSharedMinutes() {
    val path = Files.createTempFile("vescape-v51-recordings-", ".db").also(Files::delete)
    createFromExport(51, path).use { db ->
      db.exec("INSERT INTO ride_recordings VALUES ('ride-a','board-era3',60000,61000,'stopped'),('ride-b','board-era3',61500,NULL,NULL)")
      db.exec("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,board_id,recording_id,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (60500,1,'board-era3','ride-a',1,1,0,900),(61800,2,'board-era3','ride-b',1,1,0,1100)")
      db.exec("INSERT INTO ride_track_points (recording_id,board_id,fix_at_ms,latitude_e7,longitude_e7,accuracy_cm) VALUES (NULL,'board-era3',500,1,1,NULL),('ride-a','board-era3',60600,2,2,NULL),('ride-b','board-era3',61900,3,3,400)")
      val columns = "bucket_start_ms,board_id,recording_id,sample_count,first_sample_at_ms,last_sample_at_ms,sum_abs_speed_centi_kmh,moving_speed_sample_count,sum_moving_abs_speed_centi_kmh,max_abs_speed_centi_kmh,min_battery_voltage_mv,max_motor_current_abs_ma,max_battery_current_abs_ma,battery_used_wh_milli,battery_regen_wh_milli,max_duty_abs_permille,first_odometer_cm,last_odometer_cm,gps_point_count,precise_gps_point_count,gps_distance_cm,max_gps_speed_centi_mps,first_latitude_e7,first_longitude_e7,route_preview"
      db.exec("INSERT INTO telemetry_minute_buckets ($columns) VALUES (60000,'board-era3','ride-a',2,60500,61000,1800,2,1800,900,50000,100,200,10,1,300,1000,1100,1,1,50,300,NULL,NULL,'[]')")
      db.exec("INSERT INTO telemetry_minute_buckets ($columns) VALUES (60000,'board-era3','ride-b',3,61800,62000,3300,3,3300,1100,49000,300,100,20,2,400,1100,1300,1,1,70,500,520000000,170000000,'[]')")
      db.exec("INSERT INTO telemetry_minute_buckets ($columns) VALUES (120000,'board-era3','ride-b',1,120500,120500,1000,1,1000,1000,49000,0,0,0,0,0,1300,1300,0,0,0,NULL,NULL,NULL,'[[1,2,\"?\"]]')")
      migrate(db, 51, 52)
      db.exec("PRAGMA user_version = 52")

      assertFalse(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ride_recordings'").use { it.step() })
      for (table in listOf("telemetry_frames", "ride_track_points", "telemetry_minute_buckets")) {
        assertEquals(table, 0L, db.long("SELECT COUNT(*) FROM pragma_table_info('$table') WHERE name='recording_id'"))
      }
      assertEquals(2L, db.long("SELECT COUNT(*) FROM telemetry_frames WHERE board_id='board-era3' AND captured_at_ms > 60000"))
      assertEquals("legacy fix stays precise", 2000L, db.long("SELECT accuracy_cm FROM ride_track_points WHERE fix_at_ms=500"))
      assertEquals("live fix without accuracy stays unknown", null, db.long("SELECT accuracy_cm FROM ride_track_points WHERE fix_at_ms=60600"))
      assertEquals(1L, db.long("SELECT COUNT(*) FROM telemetry_minute_buckets WHERE bucket_start_ms=60000"))
      fun folded(column: String) = db.long("SELECT $column FROM telemetry_minute_buckets WHERE bucket_start_ms=60000")
      assertEquals(5L, folded("sample_count"))
      assertEquals(60500L, folded("first_sample_at_ms"))
      assertEquals(62000L, folded("last_sample_at_ms"))
      assertEquals(5100L, folded("sum_abs_speed_centi_kmh"))
      assertEquals(1100L, folded("max_abs_speed_centi_kmh"))
      assertEquals(49000L, folded("min_battery_voltage_mv"))
      assertEquals(30L, folded("battery_used_wh_milli"))
      assertEquals(1000L, folded("first_odometer_cm"))
      assertEquals(1300L, folded("last_odometer_cm"))
      assertEquals(120L, folded("gps_distance_cm"))
      assertEquals("anchor from the earliest row that has one", 520000000L, folded("first_latitude_e7"))
      assertEquals("a folded minute regenerates its preview", null, db.text("SELECT route_preview FROM telemetry_minute_buckets WHERE bucket_start_ms=60000"))
      assertEquals("[[1,2,\"?\"]]", db.text("SELECT route_preview FROM telemetry_minute_buckets WHERE bucket_start_ms=120000"))
    }
    openWithProductionGraph(path.toString())
    Files.deleteIfExists(path)
  }

  private data class Row6(val board: String, val id: String, val control: String, val enabled: Int, val sound: String, val source: String)

  @Test fun missingAndUnsupportedStartsFailWithoutCreatingTargetData() {
    for (start in listOf(1, 2, 37, 38, 39, VESCAPE_DATABASE_VERSION + 1)) {
      val path = Files.createTempFile("vescape-unsupported-v$start-", ".db")
      BundledSQLiteDriver().open(path.toString()).use { db ->
        db.exec("CREATE TABLE sentinel(value TEXT NOT NULL)")
        db.exec("INSERT INTO sentinel VALUES ('original')")
        val failed = runCatching { migrate(db, start, VESCAPE_DATABASE_VERSION) }.isFailure
        assertTrue("v$start must have no migration path", failed)
        assertEquals("original", db.text("SELECT value FROM sentinel"))
        assertFalse(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='boards'").use { it.step() })
      }
      Files.deleteIfExists(path)
    }
  }

  /** The released v22 Tune Profile had no presentation columns; the upgrade adds them with defaults. */
  @Test fun authenticReleasedV22TuneShapeKeepsRowsWhenAddingPresentationColumns() {
    val path = Files.createTempFile("vescape-authentic-v22-", ".db").also(Files::delete)
    createFromExport(22, path).use { db ->
      db.exec("INSERT INTO tune_profiles VALUES ('tune-v22','board-era3','Classic','{}',22,23)")
    }
    openWithProductionGraph(path.toString())
    BundledSQLiteDriver().open(path.toString()).use { db ->
      assertEquals("Classic", db.text("SELECT name FROM tune_profiles WHERE id='tune-v22'"))
      assertEquals("sliders-horizontal", db.text("SELECT icon FROM tune_profiles WHERE id='tune-v22'"))
      assertEquals("purple", db.text("SELECT color FROM tune_profiles WHERE id='tune-v22'"))
    }
    Files.deleteIfExists(path)
  }
}
