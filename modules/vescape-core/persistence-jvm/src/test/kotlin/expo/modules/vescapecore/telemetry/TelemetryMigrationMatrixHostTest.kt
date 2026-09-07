package expo.modules.vescapecore.telemetry

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.room.Room
import androidx.room.migration.Migration
import java.nio.file.Files
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Executes every supported start with the production migration algorithms on real SQLite. */
class TelemetryMigrationMatrixHostTest {
  private val supportedStarts = (3..36).toList() + listOf(40, 41, 42, 43)

  private fun manifest() = JSONObject(
    Files.readString(java.nio.file.Path.of("../shared/migration-fixture-manifest.json")),
  )

  @Test fun sharedManifestExactlyCoversTheProductionRoomGraph() {
    val room = manifest().getJSONObject("room")
    val declared = room.getJSONArray("supportedStarts").let { values ->
      (0 until values.length()).map(values::getInt).toSet()
    }
    assertEquals(SUPPORTED_ANDROID_DATABASE_VERSIONS, declared)
    assertEquals(TelemetryMigrations.all.map { it.startVersion }.toSet(), declared - TELEMETRY_DATABASE_VERSION)
  }

  private fun SQLiteConnection.exec(sql: String) = prepare(sql).use { it.step() }

  private fun SQLiteConnection.text(sql: String): String? = prepare(sql).use {
    if (it.step() && !it.isNull(0)) it.getText(0) else null
  }

  private fun SQLiteConnection.long(sql: String): Long? = prepare(sql).use {
    if (it.step() && !it.isNull(0)) it.getLong(0) else null
  }

  private fun createAuthenticV3(db: SQLiteConnection) {
    // Derived from f51663a8^, the last production Room v3 entities before MIGRATION_3_4.
    db.exec("CREATE TABLE telemetry_frames (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, captured_at_ms INTEGER NOT NULL, elapsed_realtime_ms INTEGER NOT NULL, device_id TEXT, device_name TEXT, can_id INTEGER, flags INTEGER NOT NULL, changed_mask_1 INTEGER NOT NULL, changed_mask_2 INTEGER NOT NULL, speed_centi_kmh INTEGER, battery_voltage_mv INTEGER, motor_current_ma INTEGER, battery_current_ma INTEGER, duty_permille INTEGER, pitch_centi_deg INTEGER, roll_centi_deg INTEGER, balance_pitch_centi_deg INTEGER, balance_current_ma INTEGER, erpm INTEGER, state INTEGER, switch_state INTEGER, adc1_milli INTEGER, adc2_milli INTEGER, odometer_cm INTEGER, temp_mosfet_deci_c INTEGER, temp_motor_deci_c INTEGER, fault_code INTEGER, latitude_e7 INTEGER, longitude_e7 INTEGER, gps_speed_centi_mps INTEGER, bearing_centi_deg INTEGER, accuracy_cm INTEGER, altitude_cm INTEGER, location_timestamp_ms INTEGER)")
    db.exec("CREATE INDEX index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
    db.exec("CREATE INDEX index_telemetry_frames_device_id_captured_at_ms ON telemetry_frames(device_id, captured_at_ms)")
    db.exec("CREATE INDEX index_telemetry_frames_fault ON telemetry_frames(captured_at_ms) WHERE fault_code IS NOT NULL AND fault_code != 0")
    db.exec("CREATE TABLE history_locations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, captured_at_ms INTEGER NOT NULL, elapsed_realtime_ms INTEGER NOT NULL, device_id TEXT, device_name TEXT, latitude_e7 INTEGER NOT NULL, longitude_e7 INTEGER NOT NULL, gps_speed_centi_mps INTEGER, bearing_centi_deg INTEGER, accuracy_cm INTEGER, altitude_cm INTEGER, location_timestamp_ms INTEGER NOT NULL, precise INTEGER NOT NULL, distance_from_previous_cm INTEGER)")
    db.exec("CREATE TABLE telemetry_minute_buckets (bucket_start_ms INTEGER NOT NULL, device_id TEXT NOT NULL, device_name TEXT, sample_count INTEGER NOT NULL, first_sample_at_ms INTEGER NOT NULL, last_sample_at_ms INTEGER NOT NULL, sum_abs_speed_centi_kmh INTEGER NOT NULL, max_abs_speed_centi_kmh INTEGER NOT NULL, min_battery_voltage_mv INTEGER, max_motor_current_abs_ma INTEGER NOT NULL, max_battery_current_abs_ma INTEGER NOT NULL, max_duty_abs_permille INTEGER NOT NULL, fault_count INTEGER NOT NULL, first_odometer_cm INTEGER, last_odometer_cm INTEGER, gps_point_count INTEGER NOT NULL, precise_gps_point_count INTEGER NOT NULL, gps_distance_cm INTEGER NOT NULL, max_gps_speed_centi_mps INTEGER, PRIMARY KEY(bucket_start_ms, device_id))")
    db.exec("CREATE INDEX index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")
    db.exec("CREATE TABLE telemetry_markers (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, occurred_at_ms INTEGER NOT NULL, elapsed_realtime_ms INTEGER NOT NULL, type TEXT NOT NULL, device_id TEXT, device_name TEXT, message TEXT, gap_ms INTEGER)")
    db.exec("CREATE INDEX index_telemetry_markers_occurred_at_ms ON telemetry_markers(occurred_at_ms)")
    db.exec("CREATE INDEX index_telemetry_markers_device_id_occurred_at_ms ON telemetry_markers(device_id, occurred_at_ms)")
    db.exec("CREATE TABLE boards (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, description TEXT, ble_id TEXT, is_starred INTEGER NOT NULL, created_at INTEGER NOT NULL, min_voltage REAL, max_voltage REAL)")
    db.exec("CREATE INDEX index_boards_created_at ON boards(created_at)")
    db.exec("CREATE INDEX index_boards_is_starred ON boards(is_starred)")
    db.exec("CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY, control_id TEXT NOT NULL, threshold REAL NOT NULL, threshold_max REAL, enabled INTEGER NOT NULL, sound_type TEXT NOT NULL, created_at INTEGER NOT NULL)")
    db.exec("CREATE INDEX index_alerts_control_id ON alerts(control_id)")
    db.exec("CREATE INDEX index_alerts_enabled ON alerts(enabled)")
    db.exec("CREATE INDEX index_alerts_created_at ON alerts(created_at)")
    db.exec("INSERT INTO boards VALUES ('board-era3','Era Three','kept','ble-era3',1,100,42.0,63.0)")
    db.exec("INSERT INTO alerts VALUES ('alert-era3','speed',21.5,NULL,1,'beep',101)")
    db.exec("INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,device_id,device_name,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'ble-era3','Era Three',1,1,0,1234)")
    db.exec("INSERT INTO telemetry_minute_buckets VALUES (960,'ble-era3','Era Three',2,1000,1010,2400,1300,50000,1200,800,700,0,100,120,1,1,20,300)")
  }

  private fun seedNewEraValues(db: SQLiteConnection, endVersion: Int) {
    when (endVersion) {
      4 -> db.exec("INSERT INTO app_settings (id,live_history_limit,auto_connect,auto_recording) VALUES (1,17,0,1)")
      12 -> db.exec("INSERT INTO app_settings VALUES ('era-setting','\"preserved\"',1200)")
      30 -> db.exec("INSERT INTO favorites VALUES ('favorite-era30','board-era3','Favorite',900,1100,30,31,2,1,20,100,1200,1234,3)")
      33 -> db.exec("INSERT INTO board_config_values VALUES ('board-era3','2.0','{\"motor_current_max\":55.5}',3300)")
    }
  }

  private fun migrate(
    db: SQLiteConnection,
    from: Int,
    to: Int,
    reached: MutableSet<Pair<Int, Int>>,
    seedFixtureValues: Boolean = false,
  ) {
    var version = from
    while (version < to) {
      val step = TelemetryMigrations.all.singleOrNull { it.startVersion == version }
        ?: error("No production migration from $version to $to")
      step.migrate(db)
      reached += step.startVersion to step.endVersion
      version = step.endVersion
      if (seedFixtureValues) seedNewEraValues(db, version)
    }
    assertEquals(to, version)
  }

  private fun openWithProductionGraph(path: String, reached: MutableSet<Pair<Int, Int>>) {
    val migrations = TelemetryMigrations.all.map { step ->
      object : Migration(step.startVersion, step.endVersion) {
        override fun migrate(connection: SQLiteConnection) {
          step.migrate(connection)
          reached += step.startVersion to step.endVersion
        }
      }
    }
    val database = Room.databaseBuilder<TelemetryRoomDatabase>(path)
      .setDriver(BundledSQLiteDriver())
      .addMigrations(*migrations.toTypedArray())
      .build()
    try {
      runBlocking { database.telemetryDao().getAppSetting("matrix-open") }
    } finally {
      database.close()
    }
  }

  @Test fun exportAuthenticFirstAndroidBackupGenerationForIOSHost() {
    if (System.getenv("VESCAPE_BACKUP_PHASE") != "export-android") return
    val exchange = System.getenv("VESCAPE_BACKUP_EXCHANGE")?.let(::File) ?: return
    val database = exchange.resolve("android-v14.sqlite")
    BundledSQLiteDriver().open(database.path).use { db ->
      createAuthenticV3(db)
      migrate(db, 3, 14, mutableSetOf(), seedFixtureValues = true)
      db.exec("INSERT INTO tune_profiles (id,board_id,name,fields_json,created_at,updated_at) VALUES ('v14-tune','board-era3','V14 Tune','{}',1400,1401)")
      db.exec("PRAGMA user_version = 14")
    }
    exchange.resolve("android-v14.zip").outputStream().use { output ->
      DatabaseBackupArchive.write(
        database,
        DatabaseBackupArchive.manifest("android", 14, "first-export", database.length(), 1),
        output,
      )
    }
    for (version in listOf(18, 19, 20)) {
      val eraDatabase = exchange.resolve("android-v$version.sqlite")
      BundledSQLiteDriver().open(eraDatabase.path).use { db ->
        createAuthenticV3(db)
        migrate(db, 3, version, mutableSetOf(), seedFixtureValues = true)
        db.exec("INSERT INTO privacy_zones VALUES ('era-zone','home','Era Zone',1,510000000,170000000,250,1800,1801)")
        if (version >= 19) {
          db.exec("UPDATE boards SET battery_config_json='{\"cells\":20}' WHERE id='board-era3'")
        }
        db.exec("PRAGMA user_version = $version")
      }
      exchange.resolve("android-v$version.zip").outputStream().use { output ->
        DatabaseBackupArchive.write(
          eraDatabase,
          DatabaseBackupArchive.manifest("android", version, "historical-export", eraDatabase.length(), 1),
          output,
        )
      }
    }
  }

  @Test fun everySupportedStartPreservesEraValuesAndReachesEveryEdge() {
    val reached = mutableSetOf<Pair<Int, Int>>()
    for (start in supportedStarts) {
      val path = Files.createTempFile("vescape-v$start-to-v43-", ".db")
      BundledSQLiteDriver().open(path.toString()).use { db ->
        createAuthenticV3(db)
        migrate(db, 3, start, reached, seedFixtureValues = true)
        db.exec("PRAGMA user_version = $start")
      }
      openWithProductionGraph(path.toString(), reached)
      BundledSQLiteDriver().open(path.toString()).use { db ->

        assertEquals("Era Three", db.text("SELECT name FROM boards WHERE id='board-era3'"))
        assertEquals("\"kept\"", db.text("SELECT value_json FROM board_settings WHERE board_id='board-era3' AND key='description'"))
        assertEquals(1234L, db.long("SELECT speed_centi_kmh FROM telemetry_frames WHERE captured_at_ms=1000"))
        assertEquals("board-era3", db.text("SELECT board_id FROM telemetry_frames WHERE captured_at_ms=1000"))
        assertEquals("board-era3", db.text("SELECT board_id FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(2L, db.long("SELECT sample_count FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(2400L, db.long("SELECT sum_abs_speed_centi_kmh FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(50000L, db.long("SELECT min_battery_voltage_mv FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(0L, db.long("SELECT battery_used_wh_milli FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(100L, db.long("SELECT first_odometer_cm FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(120L, db.long("SELECT last_odometer_cm FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(20L, db.long("SELECT gps_distance_cm FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        assertEquals(null, db.long("SELECT moving_speed_sample_count FROM telemetry_minute_buckets WHERE bucket_start_ms=960"))
        if (start >= 12) assertEquals("\"preserved\"", db.text("SELECT value_json FROM app_settings WHERE key='era-setting'"))
        if (start >= 30) assertEquals("Favorite", db.text("SELECT name FROM favorites WHERE id='favorite-era30'"))
        if (start >= 33) assertEquals("{\"motor_current_max\":55.5}", db.text("SELECT values_json FROM board_config_values WHERE board_id='board-era3'"))
      }
      Files.deleteIfExists(path)
    }
    assertEquals(TelemetryMigrations.all.map { it.startVersion to it.endVersion }.toSet(), reached)
  }

  @Test fun missingAndUnsupportedStartsFailWithoutCreatingTargetData() {
    for (start in listOf(1, 2, 37, 38, 39, 44)) {
      val path = Files.createTempFile("vescape-unsupported-v$start-", ".db")
      BundledSQLiteDriver().open(path.toString()).use { db ->
        db.exec("CREATE TABLE sentinel(value TEXT NOT NULL)")
        db.exec("INSERT INTO sentinel VALUES ('original')")
        val failed = runCatching { migrate(db, start, TELEMETRY_DATABASE_VERSION, mutableSetOf()) }.isFailure
        assertTrue("v$start must have no migration path", failed)
        assertEquals("original", db.text("SELECT value FROM sentinel"))
        assertFalse(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='boards'").use { it.step() })
      }
      Files.deleteIfExists(path)
    }
  }

  @Test fun authenticReleasedV22TuneShapeKeepsRowsWhenAddingPresentationColumns() {
    val path = Files.createTempFile("vescape-authentic-v22-", ".db")
    BundledSQLiteDriver().open(path.toString()).use { db ->
      createAuthenticV3(db)
      migrate(db, 3, 22, mutableSetOf())
      // 10deb46c^ is the released v22 entity: these columns did not exist yet. The current 7->8
      // definition includes them, so reconstruct the historical table rather than mistaking a
      // graph-generated fixture for the shipped schema.
      db.exec("ALTER TABLE tune_profiles DROP COLUMN icon")
      db.exec("ALTER TABLE tune_profiles DROP COLUMN color")
      db.exec("INSERT INTO tune_profiles VALUES ('tune-v22','board-era3','Classic','{}',22,23)")
      db.exec("PRAGMA user_version = 22")
    }
    openWithProductionGraph(path.toString(), mutableSetOf())
    BundledSQLiteDriver().open(path.toString()).use { db ->
      assertEquals("Classic", db.text("SELECT name FROM tune_profiles WHERE id='tune-v22'"))
      assertEquals("sliders-horizontal", db.text("SELECT icon FROM tune_profiles WHERE id='tune-v22'"))
      assertEquals("purple", db.text("SELECT color FROM tune_profiles WHERE id='tune-v22'"))
    }
    Files.deleteIfExists(path)
  }
}
