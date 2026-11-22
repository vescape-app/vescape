package expo.modules.vescapecore.database

import androidx.sqlite.SQLiteConnection
import expo.modules.vescapecore.telemetry.ORPHAN_BOARD_ID_PREFIX
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_NAME

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift
internal const val DATABASE_NAME = "vescape.db"
internal const val LEGACY_DATABASE_NAME = "telemetry.db"

internal interface MigrationDatabase {
  fun execSQL(sql: String)

  fun hasColumn(tableName: String, columnName: String): Boolean
}

internal data class MigrationStep(
  val startVersion: Int,
  val endVersion: Int,
  val migrate: (MigrationDatabase) -> Unit,
) {
  fun migrate(connection: SQLiteConnection) = migrate(DriverMigrationDatabase(connection))
}

private class DriverMigrationDatabase(private val connection: SQLiteConnection) : MigrationDatabase {
  override fun execSQL(sql: String) {
    connection.prepare(sql).use { it.step() }
  }

  override fun hasColumn(tableName: String, columnName: String): Boolean =
    connection.prepare("PRAGMA table_info($tableName)").use { statement ->
      while (statement.step()) {
        if (statement.getText(1) == columnName) return@use true
      }
      false
    }
}

private fun migration(
  startVersion: Int,
  endVersion: Int,
  migrate: (MigrationDatabase) -> Unit,
) = MigrationStep(startVersion, endVersion, migrate)

internal object DatabaseMigrations {
    private fun hasColumn(db: MigrationDatabase, tableName: String, columnName: String): Boolean =
      db.hasColumn(tableName, columnName)

    private val MIGRATION_3_4 = migration(3, 4) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER NOT NULL DEFAULT 1 PRIMARY KEY,
            live_history_limit INTEGER NOT NULL DEFAULT 5,
            auto_connect INTEGER NOT NULL DEFAULT 1,
            auto_recording INTEGER NOT NULL DEFAULT 0
          )
          """.trimIndent(),
        )
    }

    private val MIGRATION_4_5 = migration(4, 5) { db ->
        db.execSQL("ALTER TABLE app_settings ADD COLUMN selected_board_id TEXT")
    }

    private val MIGRATION_5_6 = migration(5, 6) { db ->
        db.execSQL(
          """
          ALTER TABLE telemetry_minute_buckets
          ADD COLUMN battery_used_wh_milli INTEGER NOT NULL DEFAULT 0
          """.trimIndent(),
        )
        db.execSQL(
          """
          ALTER TABLE telemetry_minute_buckets
          ADD COLUMN battery_regen_wh_milli INTEGER NOT NULL DEFAULT 0
          """.trimIndent(),
        )
    }

    private val MIGRATION_6_7 = migration(6, 7) { db ->
        db.execSQL("ALTER TABLE app_settings ADD COLUMN last_gps_latitude REAL")
        db.execSQL("ALTER TABLE app_settings ADD COLUMN last_gps_longitude REAL")
    }

    private val MIGRATION_7_8 = migration(7, 8) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS tune_profiles (
            id TEXT NOT NULL PRIMARY KEY,
            board_id TEXT NOT NULL,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'sliders-horizontal',
            color TEXT NOT NULL DEFAULT 'purple',
            fields_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tune_profiles_board_id ON tune_profiles(board_id)")
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS tune_history_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            profile_id TEXT NOT NULL,
            fields_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tune_history_entries_profile_id ON tune_history_entries(profile_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tune_history_entries_created_at ON tune_history_entries(created_at)")
    }

    private val MIGRATION_8_9 = migration(8, 9) { db ->
        db.execSQL("DROP TABLE IF EXISTS history_locations")
        db.execSQL("DELETE FROM telemetry_minute_buckets WHERE sample_count = 0")
    }

    private val MIGRATION_9_10 = migration(9, 10) { db ->
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN moving_speed_sample_count INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN sum_moving_abs_speed_centi_kmh INTEGER")
    }

    private val MIGRATION_10_11 = migration(10, 11) { db ->
        db.execSQL("ALTER TABLE app_settings ADD COLUMN moving_avg_speed_threshold_kmh REAL NOT NULL DEFAULT 3.0")
    }

    private val MIGRATION_11_12 = migration(11, 12) { db ->
        db.execSQL("DROP TABLE IF EXISTS app_settings")
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT NOT NULL PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
    }

    private val MIGRATION_12_13 = migration(12, 13) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS diagnostic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            occurred_at_ms INTEGER NOT NULL,
            elapsed_realtime_ms INTEGER NOT NULL,
            event_name TEXT NOT NULL,
            operation TEXT,
            phase TEXT,
            device_id TEXT,
            device_name TEXT,
            message TEXT,
            properties_json TEXT NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_diagnostic_events_occurred_at_ms ON diagnostic_events(occurred_at_ms)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_diagnostic_events_event_name ON diagnostic_events(event_name)")
        db.execSQL(
          """
          CREATE INDEX IF NOT EXISTS index_diagnostic_events_device_id_occurred_at_ms
          ON diagnostic_events(device_id, occurred_at_ms)
          """.trimIndent(),
        )
    }

    private val MIGRATION_13_14 = migration(13, 14) { db ->
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN max_temp_mosfet_deci_c INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN max_temp_motor_deci_c INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_latitude_e7 INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_longitude_e7 INTEGER")
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `upgradeExportedAndroidDatabase`
     */
    private val MIGRATION_14_15 = migration(14, 15) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS metric_exclusions (
            captured_at_ms INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            metric TEXT NOT NULL,
            reason TEXT NOT NULL,
            PRIMARY KEY(captured_at_ms, device_id, metric)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_metric_exclusions_captured_at_ms ON metric_exclusions(captured_at_ms)")
        db.execSQL(
          """
          CREATE INDEX IF NOT EXISTS index_metric_exclusions_device_id_captured_at_ms
          ON metric_exclusions(device_id, captured_at_ms)
          """.trimIndent(),
        )
    }

    private val MIGRATION_15_16 = migration(15, 16) { db ->
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN raw_value TEXT")
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN reference_value TEXT")
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN context_json TEXT")
    }

    private val MIGRATION_16_17 = migration(16, 17) { db ->
        db.execSQL("DROP TABLE IF EXISTS metric_exclusions")
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS metric_exclusion_ranges (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            device_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            sample_count INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_start_ms_end_ms
          ON metric_exclusion_ranges(start_ms, end_ms)
          """.trimIndent(),
        )
        db.execSQL(
          """
          CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_device_id_start_ms_end_ms
          ON metric_exclusion_ranges(device_id, start_ms, end_ms)
          """.trimIndent(),
        )
    }

    private val MIGRATION_17_18 = migration(17, 18) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS privacy_zones (
            id TEXT NOT NULL PRIMARY KEY,
            preset TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            center_latitude_e7 INTEGER NOT NULL,
            center_longitude_e7 INTEGER NOT NULL,
            radius_meters INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
    }

    internal val MIGRATION_18_19 = migration(18, 19) { db ->
        db.execSQL("DROP INDEX IF EXISTS index_boards_created_at")
        db.execSQL("DROP INDEX IF EXISTS index_boards_is_starred")
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS boards_new (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            ble_id TEXT,
            is_starred INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            battery_config_json TEXT
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          INSERT INTO boards_new (id, name, description, ble_id, is_starred, created_at, battery_config_json)
          SELECT id, name, description, ble_id, is_starred, created_at, NULL
          FROM boards
          """.trimIndent(),
        )
        db.execSQL("DROP TABLE boards")
        db.execSQL("ALTER TABLE boards_new RENAME TO boards")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_boards_created_at ON boards(created_at)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_boards_is_starred ON boards(is_starred)")
    }

    internal val MIGRATION_19_20 = migration(19, 20) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS map_points (
            id TEXT NOT NULL PRIMARY KEY,
            kind TEXT NOT NULL,
            latitude_e7 INTEGER NOT NULL,
            longitude_e7 INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_map_points_kind ON map_points(kind)")
    }

    internal val MIGRATION_20_21 = migration(20, 21) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS board_settings (
            board_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (board_id, key)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_board_settings_board_id ON board_settings(board_id)")
        db.execSQL(
          """
          INSERT OR REPLACE INTO board_settings (board_id, key, value_json, updated_at)
          SELECT id, 'description', json_quote(description), created_at
          FROM boards
          WHERE description IS NOT NULL
          """.trimIndent(),
        )
        db.execSQL(
          """
          INSERT OR REPLACE INTO board_settings (board_id, key, value_json, updated_at)
          SELECT id, 'batteryConfig', battery_config_json, created_at
          FROM boards
          WHERE battery_config_json IS NOT NULL
          """.trimIndent(),
        )
        db.execSQL("DROP INDEX IF EXISTS index_boards_is_starred")
        db.execSQL("DROP INDEX IF EXISTS index_boards_created_at")
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS boards_new (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            ble_id TEXT,
            created_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          INSERT INTO boards_new (id, name, ble_id, created_at)
          SELECT id, name, ble_id, created_at
          FROM boards
          """.trimIndent(),
        )
        db.execSQL("DROP TABLE boards")
        db.execSQL("ALTER TABLE boards_new RENAME TO boards")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_boards_created_at ON boards(created_at)")
    }

    internal val MIGRATION_21_22 = migration(21, 22) { db ->
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_moving_at_ms INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN last_moving_at_ms INTEGER")
    }

    internal val MIGRATION_22_23 = migration(22, 23) { db ->
      if (!hasColumn(db, "tune_profiles", "icon")) {
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN icon TEXT NOT NULL DEFAULT 'sliders-horizontal'")
      }
      if (!hasColumn(db, "tune_profiles", "color")) {
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN color TEXT NOT NULL DEFAULT 'purple'")
      }
    }

    internal val MIGRATION_23_24 = migration(23, 24) { db ->
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN refloat_base_version TEXT NOT NULL DEFAULT ''")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)")
    }

    internal val MIGRATION_24_25 = migration(24, 25) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS board_warnings (
            board_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            severity TEXT NOT NULL,
            first_detected_at INTEGER NOT NULL,
            last_detected_at INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (board_id, kind)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_board_warnings_board_id ON board_warnings(board_id)")
    }

    internal val MIGRATION_25_26 = migration(25, 26) { db ->
        if (!hasColumn(db, "alerts", "source")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN source TEXT")
        }
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v27_alert_board_id`
     */
    internal val MIGRATION_26_27 = migration(26, 27) { db ->
        db.execSQL("DROP TABLE IF EXISTS alerts")
        db.execSQL(
          """
          CREATE TABLE alerts (
            board_id TEXT NOT NULL,
            id TEXT NOT NULL,
            control_id TEXT NOT NULL,
            threshold REAL NOT NULL,
            threshold_max REAL,
            enabled INTEGER NOT NULL,
            sound_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            source TEXT,
            PRIMARY KEY (board_id, id)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_board_id ON alerts(board_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_control_id ON alerts(control_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_enabled ON alerts(enabled)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_created_at ON alerts(created_at)")
        db.execSQL(
          "DELETE FROM app_settings WHERE key IN ('alertPreset', 'riderTopSpeedKmh', 'alertPresetsOnboarded')",
        )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v29_drop_map_points`
     */
    internal val MIGRATION_27_28 = migration(27, 28) { db ->
        dropMapPointTables(db)
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v29_drop_map_points`
     */
    internal val MIGRATION_28_29 = migration(28, 29) { db ->
        dropMapPointTables(db)
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v41_board_deleted_at`
     */
    internal val MIGRATION_40_41 = migration(40, 41) { db ->
        if (!hasColumn(db, "boards", "deleted_at")) {
          db.execSQL("ALTER TABLE boards ADD COLUMN deleted_at INTEGER")
        }
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `DEVICE_BOARD_MAP`
     */
    private const val DEVICE_BOARD_MAP = "telemetry_device_board_map"

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `telemetryTablesKeyedOnDeviceId`
     */
    private val TELEMETRY_TABLES_KEYED_ON_DEVICE_ID = listOf(
      "telemetry_frames" to "captured_at_ms",
      "telemetry_minute_buckets" to "bucket_start_ms",
      "telemetry_markers" to "occurred_at_ms",
      "diagnostic_events" to "occurred_at_ms",
      "metric_exclusion_ranges" to "start_ms",
    )

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v42_telemetry_board_id`
     */
    internal val MIGRATION_41_42 = migration(41, 42) { db ->
        mintOrphanBoards(db)
        buildDeviceBoardMap(db)
        rebuildFramesOnBoardId(db)
        rebuildBucketsOnBoardId(db)
        rebuildMarkersOnBoardId(db)
        rebuildDiagnosticEventsOnBoardId(db)
        rebuildExclusionRangesOnBoardId(db)
        db.execSQL("DROP TABLE IF EXISTS $DEVICE_BOARD_MAP")
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `mintOrphanBoards` */
    private fun mintOrphanBoards(db: MigrationDatabase) {
      val now = System.currentTimeMillis()
      for ((name, timeColumn) in TELEMETRY_TABLES_KEYED_ON_DEVICE_ID) {
        val historicalName =
          if (name == "metric_exclusion_ranges") {
            "NULL"
          } else {
            "(SELECT n.device_name FROM $name n WHERE n.device_id = t.device_id " +
              "AND n.device_name IS NOT NULL ORDER BY n.$timeColumn DESC LIMIT 1)"
          }
        db.execSQL(
          """
          INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at)
          SELECT
            '$ORPHAN_BOARD_ID_PREFIX' || t.device_id,
            COALESCE(
              $historicalName,
              '$UNKNOWN_TELEMETRY_BOARD_NAME'
            ),
            NULL,
            MIN(t.$timeColumn),
            $now
          FROM $name t
          WHERE t.device_id IS NOT NULL
            AND t.device_id != ''
            AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.ble_id = t.device_id)
          GROUP BY t.device_id
          """.trimIndent(),
        )
      }
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `buildDeviceBoardMap`
     */
    private fun buildDeviceBoardMap(db: MigrationDatabase) {
      db.execSQL(
        """
        CREATE TEMP TABLE $DEVICE_BOARD_MAP (
          device_id TEXT PRIMARY KEY NOT NULL,
          board_id TEXT NOT NULL
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO $DEVICE_BOARD_MAP (device_id, board_id)
        SELECT b.ble_id, MIN(b.id)
        FROM boards b
        WHERE b.ble_id IS NOT NULL AND b.ble_id != ''
        GROUP BY b.ble_id
        """.trimIndent(),
      )
    }

    private fun boardIdFromDeviceId(alias: String): String =
      """
      CASE
        WHEN $alias.device_id IS NULL OR $alias.device_id = '' THEN %s
        ELSE COALESCE(
          (SELECT m.board_id FROM $DEVICE_BOARD_MAP m WHERE m.device_id = $alias.device_id),
          '$ORPHAN_BOARD_ID_PREFIX' || $alias.device_id
        )
      END
      """.trimIndent()

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildFramesOnBoardId` */
    private fun rebuildFramesOnBoardId(db: MigrationDatabase) {
      val columns =
        "captured_at_ms, elapsed_realtime_ms, can_id, flags, changed_mask_1, changed_mask_2, " +
          "speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, duty_permille, " +
          "pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state, " +
          "switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c, " +
          "latitude_e7, longitude_e7, gps_speed_centi_mps, bearing_centi_deg, accuracy_cm, " +
          "altitude_cm, location_timestamp_ms"
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_device_id_captured_at_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_frames_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          captured_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          board_id TEXT,
          can_id INTEGER,
          flags INTEGER NOT NULL,
          changed_mask_1 INTEGER NOT NULL,
          changed_mask_2 INTEGER NOT NULL,
          speed_centi_kmh INTEGER,
          battery_voltage_mv INTEGER,
          motor_current_ma INTEGER,
          battery_current_ma INTEGER,
          duty_permille INTEGER,
          pitch_centi_deg INTEGER,
          roll_centi_deg INTEGER,
          balance_pitch_centi_deg INTEGER,
          balance_current_ma INTEGER,
          erpm INTEGER,
          state INTEGER,
          switch_state INTEGER,
          adc1_milli INTEGER,
          adc2_milli INTEGER,
          odometer_cm INTEGER,
          temp_mosfet_deci_c INTEGER,
          temp_motor_deci_c INTEGER,
          latitude_e7 INTEGER,
          longitude_e7 INTEGER,
          gps_speed_centi_mps INTEGER,
          bearing_centi_deg INTEGER,
          accuracy_cm INTEGER,
          altitude_cm INTEGER,
          location_timestamp_ms INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO telemetry_frames_new (id, board_id, $columns)
        SELECT f.id, ${boardIdFromDeviceId("f").format("NULL")}, $columns
        FROM telemetry_frames f
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE telemetry_frames")
      db.execSQL("ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms " +
          "ON telemetry_frames(captured_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms " +
          "ON telemetry_frames(board_id, captured_at_ms)",
      )
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildBucketsOnBoardId` */
    private fun rebuildBucketsOnBoardId(db: MigrationDatabase) {
      val columns =
        "bucket_start_ms, sample_count, first_sample_at_ms, last_sample_at_ms, " +
          "sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh, " +
          "max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma, " +
          "max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, " +
          "max_duty_abs_permille, first_odometer_cm, last_odometer_cm, gps_point_count, " +
          "precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c, " +
          "max_temp_motor_deci_c, first_latitude_e7, first_longitude_e7, first_moving_at_ms, " +
          "last_moving_at_ms"
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_minute_buckets_new (
          bucket_start_ms INTEGER NOT NULL,
          board_id TEXT NOT NULL,
          sample_count INTEGER NOT NULL,
          first_sample_at_ms INTEGER NOT NULL,
          last_sample_at_ms INTEGER NOT NULL,
          sum_abs_speed_centi_kmh INTEGER NOT NULL,
          moving_speed_sample_count INTEGER,
          sum_moving_abs_speed_centi_kmh INTEGER,
          max_abs_speed_centi_kmh INTEGER NOT NULL,
          min_battery_voltage_mv INTEGER,
          max_motor_current_abs_ma INTEGER NOT NULL,
          max_battery_current_abs_ma INTEGER NOT NULL,
          battery_used_wh_milli INTEGER NOT NULL,
          battery_regen_wh_milli INTEGER NOT NULL,
          max_duty_abs_permille INTEGER NOT NULL,
          first_odometer_cm INTEGER,
          last_odometer_cm INTEGER,
          gps_point_count INTEGER NOT NULL,
          precise_gps_point_count INTEGER NOT NULL,
          gps_distance_cm INTEGER NOT NULL,
          max_gps_speed_centi_mps INTEGER,
          max_temp_mosfet_deci_c INTEGER,
          max_temp_motor_deci_c INTEGER,
          first_latitude_e7 INTEGER,
          first_longitude_e7 INTEGER,
          first_moving_at_ms INTEGER,
          last_moving_at_ms INTEGER,
          PRIMARY KEY (bucket_start_ms, board_id)
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO telemetry_minute_buckets_new (board_id, $columns)
        SELECT
          ${boardIdFromDeviceId("b").format("''")} AS board_id,
          b.bucket_start_ms,
          SUM(b.sample_count),
          MIN(b.first_sample_at_ms),
          MAX(b.last_sample_at_ms),
          SUM(b.sum_abs_speed_centi_kmh),
          SUM(b.moving_speed_sample_count),
          SUM(b.sum_moving_abs_speed_centi_kmh),
          MAX(b.max_abs_speed_centi_kmh),
          MIN(b.min_battery_voltage_mv),
          MAX(b.max_motor_current_abs_ma),
          MAX(b.max_battery_current_abs_ma),
          SUM(b.battery_used_wh_milli),
          SUM(b.battery_regen_wh_milli),
          MAX(b.max_duty_abs_permille),
          MIN(b.first_odometer_cm),
          MAX(b.last_odometer_cm),
          SUM(b.gps_point_count),
          SUM(b.precise_gps_point_count),
          SUM(b.gps_distance_cm),
          MAX(b.max_gps_speed_centi_mps),
          MAX(b.max_temp_mosfet_deci_c),
          MAX(b.max_temp_motor_deci_c),
          MIN(b.first_latitude_e7),
          MIN(b.first_longitude_e7),
          MIN(b.first_moving_at_ms),
          MAX(b.last_moving_at_ms)
        FROM telemetry_minute_buckets b
        GROUP BY b.bucket_start_ms, board_id
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE telemetry_minute_buckets")
      db.execSQL("ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms " +
          "ON telemetry_minute_buckets(bucket_start_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildMarkersOnBoardId`
     */
    private fun rebuildMarkersOnBoardId(db: MigrationDatabase) {
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_markers_occurred_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_markers_device_id_occurred_at_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_markers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          occurred_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          type TEXT NOT NULL,
          board_id TEXT,
          message TEXT,
          gap_ms INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO telemetry_markers_new
          (id, occurred_at_ms, elapsed_realtime_ms, type, board_id, message, gap_ms)
        SELECT
          m.id, m.occurred_at_ms, m.elapsed_realtime_ms, m.type,
          ${boardIdFromDeviceId("m").format("NULL")},
          m.message, m.gap_ms
        FROM telemetry_markers m
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE telemetry_markers")
      db.execSQL("ALTER TABLE telemetry_markers_new RENAME TO telemetry_markers")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_markers_occurred_at_ms " +
          "ON telemetry_markers(occurred_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_markers_board_id_occurred_at_ms " +
          "ON telemetry_markers(board_id, occurred_at_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildDiagnosticEventsOnBoardId`
     */
    private fun rebuildDiagnosticEventsOnBoardId(db: MigrationDatabase) {
      db.execSQL("DROP INDEX IF EXISTS index_diagnostic_events_occurred_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_diagnostic_events_event_name")
      db.execSQL("DROP INDEX IF EXISTS index_diagnostic_events_device_id_occurred_at_ms")
      db.execSQL(
        """
        CREATE TABLE diagnostic_events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          occurred_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          event_name TEXT NOT NULL,
          operation TEXT,
          phase TEXT,
          board_id TEXT,
          message TEXT,
          properties_json TEXT NOT NULL
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO diagnostic_events_new
          (id, occurred_at_ms, elapsed_realtime_ms, event_name, operation, phase, board_id,
           message, properties_json)
        SELECT
          e.id, e.occurred_at_ms, e.elapsed_realtime_ms, e.event_name, e.operation, e.phase,
          ${boardIdFromDeviceId("e").format("NULL")},
          e.message, e.properties_json
        FROM diagnostic_events e
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE diagnostic_events")
      db.execSQL("ALTER TABLE diagnostic_events_new RENAME TO diagnostic_events")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_diagnostic_events_occurred_at_ms " +
          "ON diagnostic_events(occurred_at_ms)",
      )
      db.execSQL("CREATE INDEX IF NOT EXISTS index_diagnostic_events_event_name ON diagnostic_events(event_name)")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_diagnostic_events_board_id_occurred_at_ms " +
          "ON diagnostic_events(board_id, occurred_at_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildExclusionRangesOnBoardId`
     */
    private fun rebuildExclusionRangesOnBoardId(db: MigrationDatabase) {
      db.execSQL("DROP INDEX IF EXISTS index_metric_exclusion_ranges_start_ms_end_ms")
      db.execSQL("DROP INDEX IF EXISTS index_metric_exclusion_ranges_device_id_start_ms_end_ms")
      db.execSQL(
        """
        CREATE TABLE metric_exclusion_ranges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          board_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          sample_count INTEGER NOT NULL
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO metric_exclusion_ranges_new
          (id, board_id, reason, start_ms, end_ms, sample_count)
        SELECT
          r.id, ${boardIdFromDeviceId("r").format("''")}, r.reason, r.start_ms, r.end_ms,
          r.sample_count
        FROM metric_exclusion_ranges r
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE metric_exclusion_ranges")
      db.execSQL("ALTER TABLE metric_exclusion_ranges_new RENAME TO metric_exclusion_ranges")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_start_ms_end_ms " +
          "ON metric_exclusion_ranges(start_ms, end_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_board_id_start_ms_end_ms " +
          "ON metric_exclusion_ranges(board_id, start_ms, end_ms)",
      )
    }

    private fun dropMapPointTables(db: MigrationDatabase) {
      db.execSQL("DROP TABLE IF EXISTS map_point_reactions")
      db.execSQL("DROP TABLE IF EXISTS map_points")
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v30_favorites`
     */
    internal val MIGRATION_29_30 = migration(29, 30) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS favorites (
            id TEXT NOT NULL PRIMARY KEY,
            board_id TEXT,
            name TEXT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sample_count INTEGER NOT NULL,
            gps_point_count INTEGER NOT NULL,
            distance_cm INTEGER,
            moving_duration_ms INTEGER NOT NULL,
            avg_speed_centi_kmh INTEGER NOT NULL,
            max_speed_centi_kmh INTEGER NOT NULL,
            battery_used_wh_milli INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_favorites_start_ms_end_ms ON favorites(start_ms, end_ms)",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_favorites_board_id ON favorites(board_id)")
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v31_favorite_media`
     */
    internal val MIGRATION_30_31 = migration(30, 31) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS favorite_media (
            id TEXT NOT NULL PRIMARY KEY,
            favorite_id TEXT NOT NULL,
            captured_at INTEGER,
            mime_type TEXT NOT NULL,
            media_kind TEXT NOT NULL,
            byte_count INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          CREATE INDEX IF NOT EXISTS index_favorite_media_favorite_id_created_at
          ON favorite_media(favorite_id, created_at)
          """.trimIndent(),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v32_alert_repeat`
     */
    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v33_board_config_values`
     */
    internal val MIGRATION_32_33 = migration(32, 33) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS board_config_values (
            board_id TEXT NOT NULL,
            refloat_base_version TEXT NOT NULL,
            values_json TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            PRIMARY KEY (board_id, refloat_base_version)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_board_config_values_board_id ON board_config_values(board_id)")
    }

    internal val MIGRATION_33_34 = migration(33, 34) { db ->
        db.execSQL("CREATE TABLE IF NOT EXISTS board_config_change_notices (board_id TEXT NOT NULL PRIMARY KEY, detected_at INTEGER NOT NULL, diffs_json TEXT NOT NULL)")
    }
    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v36_motor_config_values`
     */
    internal val MIGRATION_35_36 = migration(35, 36) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS motor_config_values (
            board_id TEXT NOT NULL,
            mcconf_signature INTEGER NOT NULL,
            firmware TEXT NOT NULL,
            values_json TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            PRIMARY KEY (board_id, mcconf_signature)
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_motor_config_values_board_id ON motor_config_values(board_id)")
    }

    /**
     * @parity /modules/vescape-core/ios/faults/VescFaultStore.swift `createTables`
     */
    private fun createVescFaultOccurrences(db: MigrationDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS vesc_fault_occurrences (
            id TEXT NOT NULL PRIMARY KEY,
            board_id TEXT NOT NULL,
            code INTEGER NOT NULL,
            occurred_at INTEGER NOT NULL,
            last_observed_at INTEGER NOT NULL,
            cleared_at INTEGER,
            dismissed INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_vesc_fault_occurrences_board_id_occurred_at " +
            "ON vesc_fault_occurrences(board_id, occurred_at)",
        )
    }

    /**
     * @parity /modules/vescape-core/ios/faults/VescFaultCaptureStore.swift `createTables`
     */
    private fun createVescFaultCaptures(db: MigrationDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS vesc_fault_captures (
            occurrence_id TEXT NOT NULL PRIMARY KEY,
            board_id TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            opened_at INTEGER NOT NULL,
            sample_count INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_vesc_fault_captures_board_id " +
            "ON vesc_fault_captures(board_id)",
        )
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS vesc_fault_capture_samples (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            occurrence_id TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            speed REAL,
            duty_cycle REAL,
            erpm REAL,
            battery_voltage REAL,
            battery_current REAL,
            motor_current REAL,
            temp_mosfet REAL,
            temp_motor REAL,
            pitch REAL,
            roll REAL,
            balance_pitch REAL,
            adc1 REAL,
            adc2 REAL,
            state INTEGER
          )
          """.trimIndent(),
        )
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_vesc_fault_capture_samples_occurrence_id_captured_at " +
            "ON vesc_fault_capture_samples(occurrence_id, captured_at)",
        )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v40_vesc_faults`
     */
    internal val MIGRATION_36_40 = migration(36, 40) { db ->
        createVescFaultOccurrences(db)
        createVescFaultCaptures(db)
        db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_fault")
        if (hasColumn(db, "telemetry_frames", "fault_code")) {
          db.execSQL(
            """
            CREATE TABLE telemetry_frames_new (
              id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
              captured_at_ms INTEGER NOT NULL,
              elapsed_realtime_ms INTEGER NOT NULL,
              device_id TEXT,
              device_name TEXT,
              can_id INTEGER,
              flags INTEGER NOT NULL,
              changed_mask_1 INTEGER NOT NULL,
              changed_mask_2 INTEGER NOT NULL,
              speed_centi_kmh INTEGER,
              battery_voltage_mv INTEGER,
              motor_current_ma INTEGER,
              battery_current_ma INTEGER,
              duty_permille INTEGER,
              pitch_centi_deg INTEGER,
              roll_centi_deg INTEGER,
              balance_pitch_centi_deg INTEGER,
              balance_current_ma INTEGER,
              erpm INTEGER,
              state INTEGER,
              switch_state INTEGER,
              adc1_milli INTEGER,
              adc2_milli INTEGER,
              odometer_cm INTEGER,
              temp_mosfet_deci_c INTEGER,
              temp_motor_deci_c INTEGER,
              latitude_e7 INTEGER,
              longitude_e7 INTEGER,
              gps_speed_centi_mps INTEGER,
              bearing_centi_deg INTEGER,
              accuracy_cm INTEGER,
              altitude_cm INTEGER,
              location_timestamp_ms INTEGER
            )
            """.trimIndent(),
          )
          db.execSQL(
            """
            INSERT INTO telemetry_frames_new
            SELECT id, captured_at_ms, elapsed_realtime_ms, device_id, device_name, can_id, flags,
                   changed_mask_1, changed_mask_2, speed_centi_kmh, battery_voltage_mv,
                   motor_current_ma, battery_current_ma, duty_permille, pitch_centi_deg,
                   roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state,
                   switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c,
                   temp_motor_deci_c, latitude_e7, longitude_e7, gps_speed_centi_mps,
                   bearing_centi_deg, accuracy_cm, altitude_cm, location_timestamp_ms
            FROM telemetry_frames
            """.trimIndent(),
          )
          db.execSQL("DROP TABLE telemetry_frames")
          db.execSQL("ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
          db.execSQL("CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
          db.execSQL(
            "CREATE INDEX IF NOT EXISTS index_telemetry_frames_device_id_captured_at_ms " +
              "ON telemetry_frames(device_id, captured_at_ms)",
          )
        }

        if (hasColumn(db, "telemetry_minute_buckets", "fault_count")) {
          db.execSQL(
            """
            CREATE TABLE telemetry_minute_buckets_new (
              bucket_start_ms INTEGER NOT NULL,
              device_id TEXT NOT NULL,
              device_name TEXT,
              sample_count INTEGER NOT NULL,
              first_sample_at_ms INTEGER NOT NULL,
              last_sample_at_ms INTEGER NOT NULL,
              sum_abs_speed_centi_kmh INTEGER NOT NULL,
              moving_speed_sample_count INTEGER,
              sum_moving_abs_speed_centi_kmh INTEGER,
              max_abs_speed_centi_kmh INTEGER NOT NULL,
              min_battery_voltage_mv INTEGER,
              max_motor_current_abs_ma INTEGER NOT NULL,
              max_battery_current_abs_ma INTEGER NOT NULL,
              battery_used_wh_milli INTEGER NOT NULL,
              battery_regen_wh_milli INTEGER NOT NULL,
              max_duty_abs_permille INTEGER NOT NULL,
              first_odometer_cm INTEGER,
              last_odometer_cm INTEGER,
              gps_point_count INTEGER NOT NULL,
              precise_gps_point_count INTEGER NOT NULL,
              gps_distance_cm INTEGER NOT NULL,
              max_gps_speed_centi_mps INTEGER,
              max_temp_mosfet_deci_c INTEGER,
              max_temp_motor_deci_c INTEGER,
              first_latitude_e7 INTEGER,
              first_longitude_e7 INTEGER,
              first_moving_at_ms INTEGER,
              last_moving_at_ms INTEGER,
              PRIMARY KEY (bucket_start_ms, device_id)
            )
            """.trimIndent(),
          )
          db.execSQL(
            """
            INSERT INTO telemetry_minute_buckets_new
            SELECT bucket_start_ms, device_id, device_name, sample_count, first_sample_at_ms,
                   last_sample_at_ms, sum_abs_speed_centi_kmh, moving_speed_sample_count,
                   sum_moving_abs_speed_centi_kmh, max_abs_speed_centi_kmh, min_battery_voltage_mv,
                   max_motor_current_abs_ma, max_battery_current_abs_ma, battery_used_wh_milli,
                   battery_regen_wh_milli, max_duty_abs_permille, first_odometer_cm,
                   last_odometer_cm, gps_point_count, precise_gps_point_count, gps_distance_cm,
                   max_gps_speed_centi_mps, max_temp_mosfet_deci_c, max_temp_motor_deci_c,
                   first_latitude_e7, first_longitude_e7, first_moving_at_ms, last_moving_at_ms
            FROM telemetry_minute_buckets
            """.trimIndent(),
          )
          db.execSQL("DROP TABLE telemetry_minute_buckets")
          db.execSQL("ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
          db.execSQL("CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")
        }
    }

    internal val MIGRATION_34_35 = migration(34, 35) { db ->
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_kind TEXT NOT NULL DEFAULT 'fixed'")
        db.execSQL("ALTER TABLE alerts ADD COLUMN config_field_id TEXT")
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_offset REAL")
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_max_offset REAL")
    }

    internal val MIGRATION_31_32 = migration(31, 32) { db ->
        if (!hasColumn(db, "alerts", "repeat_every_seconds")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN repeat_every_seconds INTEGER")
        }
        if (!hasColumn(db, "alerts", "beep_count")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN beep_count INTEGER NOT NULL DEFAULT 3")
        }
    }

    internal val MIGRATION_42_43 = migration(42, 43) { db ->
        createRideRecordingTables(db)
        migrateFrameGpsIntoRideTrack(db)
        rebuildFramesWithoutGps(db)
        rebuildBucketsOnRecordingId(db)
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `createRideRecordingTables` */
    private fun createRideRecordingTables(db: MigrationDatabase) {
      db.execSQL(
        """
        CREATE TABLE IF NOT EXISTS ride_recordings (
          id TEXT NOT NULL PRIMARY KEY,
          board_id TEXT,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
          ended_reason TEXT
        )
        """.trimIndent(),
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_recordings_started_at_ms " +
          "ON ride_recordings(started_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_recordings_board_id_started_at_ms " +
          "ON ride_recordings(board_id, started_at_ms)",
      )
      db.execSQL(
        """
        CREATE TABLE IF NOT EXISTS ride_track_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          recording_id TEXT,
          board_id TEXT,
          fix_at_ms INTEGER NOT NULL,
          latitude_e7 INTEGER NOT NULL,
          longitude_e7 INTEGER NOT NULL,
          accuracy_cm INTEGER,
          gps_speed_centi_mps INTEGER,
          bearing_centi_deg INTEGER,
          altitude_cm INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_track_points_fix_at_ms " +
          "ON ride_track_points(fix_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_track_points_board_id_fix_at_ms " +
          "ON ride_track_points(board_id, fix_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_track_points_recording_id_fix_at_ms " +
          "ON ride_track_points(recording_id, fix_at_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `migrateFrameGpsIntoRideTrack`
     */
    private fun migrateFrameGpsIntoRideTrack(db: MigrationDatabase) {
      db.execSQL(
        """
        INSERT INTO ride_track_points (
          recording_id, board_id, fix_at_ms, latitude_e7, longitude_e7,
          accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm
        )
        SELECT
          NULL,
          f.board_id,
          COALESCE(f.location_timestamp_ms, f.captured_at_ms),
          f.latitude_e7,
          f.longitude_e7,
          f.accuracy_cm,
          f.gps_speed_centi_mps,
          f.bearing_centi_deg,
          f.altitude_cm
        FROM telemetry_frames f
        WHERE f.latitude_e7 IS NOT NULL AND f.longitude_e7 IS NOT NULL
        ORDER BY f.captured_at_ms ASC, f.id ASC
        """.trimIndent(),
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildFramesWithoutGps`
     */
    private fun rebuildFramesWithoutGps(db: MigrationDatabase) {
      val columns =
        "captured_at_ms, elapsed_realtime_ms, board_id, can_id, flags, changed_mask_1, " +
          "changed_mask_2, speed_centi_kmh, battery_voltage_mv, motor_current_ma, " +
          "battery_current_ma, duty_permille, pitch_centi_deg, roll_centi_deg, " +
          "balance_pitch_centi_deg, balance_current_ma, erpm, state, switch_state, adc1_milli, " +
          "adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c"
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_board_id_captured_at_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_frames_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          captured_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          board_id TEXT,
          recording_id TEXT,
          can_id INTEGER,
          flags INTEGER NOT NULL,
          changed_mask_1 INTEGER NOT NULL,
          changed_mask_2 INTEGER NOT NULL,
          speed_centi_kmh INTEGER,
          battery_voltage_mv INTEGER,
          motor_current_ma INTEGER,
          battery_current_ma INTEGER,
          duty_permille INTEGER,
          pitch_centi_deg INTEGER,
          roll_centi_deg INTEGER,
          balance_pitch_centi_deg INTEGER,
          balance_current_ma INTEGER,
          erpm INTEGER,
          state INTEGER,
          switch_state INTEGER,
          adc1_milli INTEGER,
          adc2_milli INTEGER,
          odometer_cm INTEGER,
          temp_mosfet_deci_c INTEGER,
          temp_motor_deci_c INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO telemetry_frames_new (id, recording_id, $columns)
        SELECT f.id, NULL, $columns
        FROM telemetry_frames f
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE telemetry_frames")
      db.execSQL("ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms " +
          "ON telemetry_frames(captured_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms " +
          "ON telemetry_frames(board_id, captured_at_ms)",
      )
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_recording_id_captured_at_ms " +
          "ON telemetry_frames(recording_id, captured_at_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildBucketsOnRecordingId`
     */
    private fun rebuildBucketsOnRecordingId(db: MigrationDatabase) {
      val columns =
        "bucket_start_ms, board_id, sample_count, first_sample_at_ms, last_sample_at_ms, " +
          "sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh, " +
          "max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma, " +
          "max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, " +
          "max_duty_abs_permille, first_odometer_cm, last_odometer_cm, gps_point_count, " +
          "precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps, " +
          "max_temp_mosfet_deci_c, max_temp_motor_deci_c, first_latitude_e7, first_longitude_e7, " +
          "first_moving_at_ms, last_moving_at_ms"
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_minute_buckets_new (
          bucket_start_ms INTEGER NOT NULL,
          board_id TEXT NOT NULL,
          recording_id TEXT NOT NULL DEFAULT '',
          sample_count INTEGER NOT NULL,
          first_sample_at_ms INTEGER NOT NULL,
          last_sample_at_ms INTEGER NOT NULL,
          sum_abs_speed_centi_kmh INTEGER NOT NULL,
          moving_speed_sample_count INTEGER,
          sum_moving_abs_speed_centi_kmh INTEGER,
          max_abs_speed_centi_kmh INTEGER NOT NULL,
          min_battery_voltage_mv INTEGER,
          max_motor_current_abs_ma INTEGER NOT NULL,
          max_battery_current_abs_ma INTEGER NOT NULL,
          battery_used_wh_milli INTEGER NOT NULL,
          battery_regen_wh_milli INTEGER NOT NULL,
          max_duty_abs_permille INTEGER NOT NULL,
          first_odometer_cm INTEGER,
          last_odometer_cm INTEGER,
          gps_point_count INTEGER NOT NULL,
          precise_gps_point_count INTEGER NOT NULL,
          gps_distance_cm INTEGER NOT NULL,
          max_gps_speed_centi_mps INTEGER,
          max_temp_mosfet_deci_c INTEGER,
          max_temp_motor_deci_c INTEGER,
          first_latitude_e7 INTEGER,
          first_longitude_e7 INTEGER,
          first_moving_at_ms INTEGER,
          last_moving_at_ms INTEGER,
          PRIMARY KEY (bucket_start_ms, board_id, recording_id)
        )
        """.trimIndent(),
      )
      db.execSQL(
        """
        INSERT INTO telemetry_minute_buckets_new ($columns, recording_id)
        SELECT $columns, ''
        FROM telemetry_minute_buckets
        """.trimIndent(),
      )
      db.execSQL("DROP TABLE telemetry_minute_buckets")
      db.execSQL("ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms " +
          "ON telemetry_minute_buckets(bucket_start_ms)",
      )
    }

    internal val MIGRATION_43_44 = migration(43, 44) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS accessories (
            accessory_id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            firmware_version TEXT NOT NULL,
            protocol_version INTEGER,
            device_id TEXT,
            capabilities_json TEXT NOT NULL,
            enrolled_at INTEGER NOT NULL,
            last_connected_at INTEGER
          )
          """.trimIndent(),
        )
    }

    internal val MIGRATION_44_45 = migration(44, 45) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS accessory_ground_clearance (
            accessory_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            near_cm REAL NOT NULL,
            far_cm REAL NOT NULL,
            direction TEXT NOT NULL,
            strength_percent INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(accessory_id, capability_id)
          )
          """.trimIndent(),
        )
    }

    internal val MIGRATION_45_46 = migration(45, 46) { db -> db.execSQL("CREATE TABLE IF NOT EXISTS accessory_brake_light (accessory_id TEXT NOT NULL, capability_id TEXT NOT NULL, sensitivity INTEGER NOT NULL, parked TEXT NOT NULL, PRIMARY KEY(accessory_id, capability_id))") }

    // @parity /modules/vescape-core/ios/database/PersistenceSchema.swift `createAccessoryCapabilitySettings`
    internal val MIGRATION_46_47 = migration(46, 47) { db ->
      db.execSQL("CREATE TABLE IF NOT EXISTS accessory_capability_settings (accessory_id TEXT NOT NULL, capability_id TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY(accessory_id, capability_id))")
    }

    // @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v48_accessory_sampling_rate`
    internal val MIGRATION_47_48 = migration(47, 48) { db ->
      db.execSQL("ALTER TABLE accessory_capability_settings ADD COLUMN sampling_rate_hz REAL")
    }

    // @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v49_bucket_route_preview`
    internal val MIGRATION_48_49 = migration(48, 49) { db ->
      db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN route_preview TEXT")
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v50_alert_sound_count`
     */
    internal val MIGRATION_49_50 = migration(49, 50) { db ->
        db.execSQL(ALERT_SOUND_COUNT_SQL)
        db.execSQL(
          """
          CREATE TABLE alerts_new (
            board_id TEXT NOT NULL,
            id TEXT NOT NULL,
            control_id TEXT NOT NULL,
            threshold REAL NOT NULL,
            threshold_max REAL,
            enabled INTEGER NOT NULL,
            sound_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            source TEXT,
            repeat_every_seconds INTEGER,
            threshold_kind TEXT NOT NULL DEFAULT 'fixed',
            config_field_id TEXT,
            threshold_offset REAL,
            threshold_max_offset REAL,
            PRIMARY KEY (board_id, id)
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          INSERT INTO alerts_new (board_id, id, control_id, threshold, threshold_max, enabled, sound_type,
            created_at, source, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
            threshold_max_offset)
          SELECT board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at,
            source, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
            threshold_max_offset
          FROM alerts
          """.trimIndent(),
        )
        db.execSQL("DROP TABLE alerts")
        db.execSQL("ALTER TABLE alerts_new RENAME TO alerts")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_board_id ON alerts(board_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_control_id ON alerts(control_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_enabled ON alerts(enabled)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_created_at ON alerts(created_at)")
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `alertSoundCountSql` */
    private val ALERT_SOUND_COUNT_SQL = """
      UPDATE alerts SET sound_type = 'alert(' || MAX(1, MIN(5, beep_count)) || '):' ||
        CASE sound_type
          WHEN 'preset:urgent' THEN 'critical' WHEN 'urgent' THEN 'critical'
          WHEN 'preset:notify' THEN 'info' WHEN 'notify' THEN 'info' WHEN 'pulse' THEN 'info'
          ELSE 'warning'
        END
      WHERE sound_type IN ('preset:beep', 'preset:urgent', 'preset:notify', 'default', 'beep', 'urgent', 'notify', 'pulse')
    """.trimIndent()

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v51_preset_rows`
     */
    internal val MIGRATION_50_51 = migration(50, 51) { db ->
        db.execSQL(
          """
          CREATE TABLE alerts_new (
            board_id TEXT NOT NULL,
            id TEXT NOT NULL,
            control_id TEXT NOT NULL,
            threshold REAL NOT NULL,
            threshold_max REAL,
            enabled INTEGER NOT NULL,
            spec TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            repeat_every_seconds INTEGER,
            threshold_kind TEXT NOT NULL DEFAULT 'fixed',
            config_field_id TEXT,
            threshold_offset REAL,
            threshold_max_offset REAL,
            PRIMARY KEY (board_id, id)
          )
          """.trimIndent(),
        )
        db.execSQL(
          """
          INSERT INTO alerts_new (board_id, id, control_id, threshold, threshold_max, enabled, spec,
            created_at, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
            threshold_max_offset)
          SELECT board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at,
            repeat_every_seconds, threshold_kind, config_field_id, threshold_offset, threshold_max_offset
          FROM alerts WHERE source IS NULL OR source != 'preset'
          """.trimIndent(),
        )
        db.execSQL(PRESET_ROWS_SQL)
        db.execSQL("DROP TABLE alerts")
        db.execSQL("ALTER TABLE alerts_new RENAME TO alerts")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_board_id ON alerts(board_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_control_id ON alerts(control_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_enabled ON alerts(enabled)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_created_at ON alerts(created_at)")
        db.execSQL("DELETE FROM board_settings WHERE key IN ('alertPreset', 'matchBoardConfig', 'alertPresetSound')")
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `presetRowsSql` */
    private val PRESET_ROWS_SQL = """
      INSERT OR REPLACE INTO alerts_new (board_id, id, control_id, threshold, threshold_max, enabled, spec, created_at)
      SELECT board_id, 'preset:' || metric, metric, 0, NULL, 1,
        'preset(' || level || ')' || CASE WHEN options = '' THEN '' ELSE ':' || options END, 0
      FROM (
        SELECT board_id, metric,
          CASE WHEN all_disabled = 1 THEN 'off' WHEN level IN ('safe', 'normal', 'minimal') THEN level ELSE 'off' END AS level,
          ltrim(
            CASE WHEN geiger IN ('soft', 'mid', 'hard') THEN ',geiger=' || geiger ELSE '' END ||
            CASE WHEN matched = 1 AND metric IN ('duty', 'motor-temp', 'controller-temp') THEN ',match=on' ELSE '' END,
            ','
          ) AS options
        FROM (
          SELECT boards.id AS board_id, metrics.metric AS metric,
            (SELECT json_extract(value_json, '$."' || metrics.metric || '"') FROM board_settings
              WHERE board_id = boards.id AND key = 'alertPreset' AND json_valid(value_json)) AS level,
            substr(COALESCE(
              (SELECT json_extract(value_json, '$."' || metrics.metric || '".geiger') FROM board_settings
                WHERE board_id = boards.id AND key = 'alertPresetSound' AND json_valid(value_json)),
              (SELECT sound_type FROM alerts WHERE alerts.board_id = boards.id AND control_id = metrics.metric
                AND source = 'preset' AND sound_type LIKE 'geiger:%' LIMIT 1)
            ), length('geiger:') + 1) AS geiger,
            (SELECT json_extract(value_json, '$."' || metrics.metric || '"') FROM board_settings
              WHERE board_id = boards.id AND key = 'matchBoardConfig' AND json_valid(value_json)) AS matched,
            -- Every old preset point disabled: the rider had silenced the metric.
            (SELECT COUNT(*) > 0 AND SUM(enabled) = 0 FROM alerts WHERE alerts.board_id = boards.id
              AND control_id = metrics.metric AND source = 'preset') AS all_disabled
          FROM boards
          CROSS JOIN (SELECT 'speed' AS metric UNION ALL SELECT 'duty' UNION ALL SELECT 'motor-temp'
            UNION ALL SELECT 'controller-temp' UNION ALL SELECT 'battery') AS metrics
          WHERE boards.deleted_at IS NULL
        )
      )
      -- The app default has no row.
      WHERE NOT (level = 'normal' AND options = '')
    """.trimIndent()

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v52_drop_ride_recordings`
     */
    internal val MIGRATION_51_52 = migration(51, 52) { db ->
        db.execSQL(
          "UPDATE ride_track_points SET accuracy_cm = 2000 " +
            "WHERE recording_id IS NULL AND accuracy_cm IS NULL",
        )
        rebuildRideTrackWithoutRecordingId(db)
        rebuildFramesWithoutRecordingId(db)
        foldBucketsWithoutRecordingId(db)
        db.execSQL("DROP TABLE IF EXISTS ride_recordings")
    }

    /**
     * @parity /modules/vescape-core/ios/database/PersistenceSchema.swift `createWeatherObservations`
     */
    internal val MIGRATION_52_53 = migration(52, 53) { db ->
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS weather_observations (
            observed_at_ms INTEGER NOT NULL,
            temperature_c INTEGER NOT NULL,
            weather_code INTEGER NOT NULL,
            gust_kmh INTEGER,
            is_day INTEGER NOT NULL,
            PRIMARY KEY(observed_at_ms)
          )
          """.trimIndent(),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v54_shared_schema`
     */
    internal val MIGRATION_53_54 = migration(53, 54) { db ->
      SHARED_SCHEMA_V54_SQL.forEach(db::execSQL)
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `sharedSchemaV54Sql` */
    private val SHARED_SCHEMA_V54_SQL = listOf(
      "CREATE TABLE alerts_v54 (board_id TEXT NOT NULL, id TEXT NOT NULL, control_id TEXT NOT NULL, threshold REAL NOT NULL, threshold_max REAL, threshold_kind TEXT NOT NULL DEFAULT 'fixed', config_field_id TEXT, threshold_offset REAL, threshold_max_offset REAL, enabled INTEGER NOT NULL, spec TEXT NOT NULL, created_at INTEGER NOT NULL, repeat_every_seconds INTEGER, PRIMARY KEY(board_id, id))",
      "INSERT INTO alerts_v54 (board_id, id, control_id, threshold, threshold_max, threshold_kind, config_field_id, threshold_offset, threshold_max_offset, enabled, spec, created_at, repeat_every_seconds) SELECT board_id, id, control_id, threshold, threshold_max, threshold_kind, config_field_id, threshold_offset, threshold_max_offset, enabled, spec, created_at, repeat_every_seconds FROM alerts",
      "DROP TABLE alerts",
      "ALTER TABLE alerts_v54 RENAME TO alerts",
      "CREATE INDEX index_alerts_board_id ON alerts(board_id)",
      "CREATE INDEX index_alerts_control_id ON alerts(control_id)",
      "CREATE INDEX index_alerts_enabled ON alerts(enabled)",
      "CREATE INDEX index_alerts_created_at ON alerts(created_at)",
      "CREATE TABLE tune_profiles_v54 (id TEXT NOT NULL, board_id TEXT NOT NULL, refloat_base_version TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'sliders-horizontal', color TEXT NOT NULL DEFAULT 'purple', fields_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(id))",
      "INSERT INTO tune_profiles_v54 (id, board_id, refloat_base_version, name, icon, color, fields_json, created_at, updated_at) SELECT id, board_id, refloat_base_version, name, icon, color, fields_json, created_at, updated_at FROM tune_profiles",
      "DROP TABLE tune_profiles",
      "ALTER TABLE tune_profiles_v54 RENAME TO tune_profiles",
      "CREATE INDEX index_tune_profiles_board_id ON tune_profiles(board_id)",
      "CREATE INDEX index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)",
    )

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v55_board_key`
     */
    internal val MIGRATION_54_55 = migration(54, 55) { db ->
      if (!hasColumn(db, "boards", "key")) BOARD_KEY_V55_SQL.forEach(db::execSQL)
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `v56_telemetry_chunks`
     */
    internal val MIGRATION_55_56 = migration(55, 56) { db -> TELEMETRY_CHUNKS_V56_SQL.forEach(db::execSQL) }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `telemetryChunksV56Sql` */
    private val TELEMETRY_CHUNKS_V56_SQL = listOf(
      "CREATE TABLE IF NOT EXISTS telemetry_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, board_key INTEGER, minute_start_ms INTEGER NOT NULL, codec_version INTEGER NOT NULL, sample_count INTEGER NOT NULL, first_at_ms INTEGER NOT NULL, last_at_ms INTEGER NOT NULL, payload BLOB NOT NULL, FOREIGN KEY(board_key) REFERENCES boards(key) ON UPDATE NO ACTION ON DELETE NO ACTION)",
      "CREATE UNIQUE INDEX IF NOT EXISTS index_telemetry_chunks_board_key_minute_start_ms ON telemetry_chunks(board_key, minute_start_ms)",
      "CREATE INDEX IF NOT EXISTS index_telemetry_chunks_minute_start_ms ON telemetry_chunks(minute_start_ms)",
    )

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `boardKeyV55Sql` */
    private val BOARD_KEY_V55_SQL = listOf(
      "DROP INDEX IF EXISTS index_boards_created_at",
      "CREATE TABLE boards_v55 (key INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, ble_id TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER)",
      "INSERT INTO boards_v55 (id, name, ble_id, created_at, deleted_at) SELECT id, name, ble_id, created_at, deleted_at FROM boards ORDER BY created_at, id",
      "DROP TABLE boards",
      "ALTER TABLE boards_v55 RENAME TO boards",
      "CREATE UNIQUE INDEX index_boards_id ON boards(id)",
      "CREATE INDEX index_boards_created_at ON boards(created_at)",
      "INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at) SELECT board_id, '$UNKNOWN_TELEMETRY_BOARD_NAME', NULL, MIN(at_ms), MAX(at_ms) FROM (SELECT board_id, fix_at_ms AS at_ms FROM ride_track_points UNION ALL SELECT board_id, captured_at_ms FROM telemetry_frames) WHERE board_id IS NOT NULL AND board_id != '' GROUP BY board_id ORDER BY MIN(at_ms), board_id",
      "DROP INDEX IF EXISTS index_ride_track_points_fix_at_ms",
      "DROP INDEX IF EXISTS index_ride_track_points_board_id_fix_at_ms",
      "CREATE TABLE ride_track_points_v55 (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, board_key INTEGER, fix_at_ms INTEGER NOT NULL, latitude_e7 INTEGER NOT NULL, longitude_e7 INTEGER NOT NULL, accuracy_cm INTEGER, gps_speed_centi_mps INTEGER, bearing_centi_deg INTEGER, altitude_cm INTEGER, FOREIGN KEY(board_key) REFERENCES boards(key) ON UPDATE NO ACTION ON DELETE NO ACTION)",
      "INSERT INTO ride_track_points_v55 (id, board_key, fix_at_ms, latitude_e7, longitude_e7, accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm) SELECT t.id, b.key, t.fix_at_ms, t.latitude_e7, t.longitude_e7, t.accuracy_cm, t.gps_speed_centi_mps, t.bearing_centi_deg, t.altitude_cm FROM ride_track_points t LEFT JOIN boards b ON b.id = t.board_id",
      "DROP TABLE ride_track_points",
      "ALTER TABLE ride_track_points_v55 RENAME TO ride_track_points",
      "CREATE INDEX index_ride_track_points_fix_at_ms ON ride_track_points(fix_at_ms)",
      "CREATE INDEX index_ride_track_points_board_key_fix_at_ms ON ride_track_points(board_key, fix_at_ms)",
    )

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildRideTrackWithoutRecordingId` */
    private fun rebuildRideTrackWithoutRecordingId(db: MigrationDatabase) {
      val columns = "id, board_id, fix_at_ms, latitude_e7, longitude_e7, accuracy_cm, " +
        "gps_speed_centi_mps, bearing_centi_deg, altitude_cm"
      db.execSQL("DROP INDEX IF EXISTS index_ride_track_points_fix_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_ride_track_points_board_id_fix_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_ride_track_points_recording_id_fix_at_ms")
      db.execSQL(
        """
        CREATE TABLE ride_track_points_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          board_id TEXT,
          fix_at_ms INTEGER NOT NULL,
          latitude_e7 INTEGER NOT NULL,
          longitude_e7 INTEGER NOT NULL,
          accuracy_cm INTEGER,
          gps_speed_centi_mps INTEGER,
          bearing_centi_deg INTEGER,
          altitude_cm INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL("INSERT INTO ride_track_points_new ($columns) SELECT $columns FROM ride_track_points")
      db.execSQL("DROP TABLE ride_track_points")
      db.execSQL("ALTER TABLE ride_track_points_new RENAME TO ride_track_points")
      db.execSQL("CREATE INDEX IF NOT EXISTS index_ride_track_points_fix_at_ms ON ride_track_points(fix_at_ms)")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_ride_track_points_board_id_fix_at_ms " +
          "ON ride_track_points(board_id, fix_at_ms)",
      )
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `rebuildFramesWithoutRecordingId` */
    private fun rebuildFramesWithoutRecordingId(db: MigrationDatabase) {
      val columns =
        "id, captured_at_ms, elapsed_realtime_ms, board_id, can_id, flags, changed_mask_1, " +
          "changed_mask_2, speed_centi_kmh, battery_voltage_mv, motor_current_ma, " +
          "battery_current_ma, duty_permille, pitch_centi_deg, roll_centi_deg, " +
          "balance_pitch_centi_deg, balance_current_ma, erpm, state, switch_state, adc1_milli, " +
          "adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c"
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_board_id_captured_at_ms")
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_frames_recording_id_captured_at_ms")
      db.execSQL(
        """
        CREATE TABLE telemetry_frames_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          captured_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          board_id TEXT,
          can_id INTEGER,
          flags INTEGER NOT NULL,
          changed_mask_1 INTEGER NOT NULL,
          changed_mask_2 INTEGER NOT NULL,
          speed_centi_kmh INTEGER,
          battery_voltage_mv INTEGER,
          motor_current_ma INTEGER,
          battery_current_ma INTEGER,
          duty_permille INTEGER,
          pitch_centi_deg INTEGER,
          roll_centi_deg INTEGER,
          balance_pitch_centi_deg INTEGER,
          balance_current_ma INTEGER,
          erpm INTEGER,
          state INTEGER,
          switch_state INTEGER,
          adc1_milli INTEGER,
          adc2_milli INTEGER,
          odometer_cm INTEGER,
          temp_mosfet_deci_c INTEGER,
          temp_motor_deci_c INTEGER
        )
        """.trimIndent(),
      )
      db.execSQL("INSERT INTO telemetry_frames_new ($columns) SELECT $columns FROM telemetry_frames")
      db.execSQL("DROP TABLE telemetry_frames")
      db.execSQL("ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
      db.execSQL("CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms " +
          "ON telemetry_frames(board_id, captured_at_ms)",
      )
    }

    /**
     * @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `foldBucketsWithoutRecordingId`
     */
    private fun foldBucketsWithoutRecordingId(db: MigrationDatabase) {
      db.execSQL("DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
      db.execSQL("ALTER TABLE telemetry_minute_buckets RENAME TO telemetry_minute_buckets_old")
      db.execSQL(
        """
        CREATE TABLE telemetry_minute_buckets (
          bucket_start_ms INTEGER NOT NULL,
          board_id TEXT NOT NULL,
          sample_count INTEGER NOT NULL,
          first_sample_at_ms INTEGER NOT NULL,
          last_sample_at_ms INTEGER NOT NULL,
          sum_abs_speed_centi_kmh INTEGER NOT NULL,
          moving_speed_sample_count INTEGER,
          sum_moving_abs_speed_centi_kmh INTEGER,
          max_abs_speed_centi_kmh INTEGER NOT NULL,
          min_battery_voltage_mv INTEGER,
          max_motor_current_abs_ma INTEGER NOT NULL,
          max_battery_current_abs_ma INTEGER NOT NULL,
          battery_used_wh_milli INTEGER NOT NULL,
          battery_regen_wh_milli INTEGER NOT NULL,
          max_duty_abs_permille INTEGER NOT NULL,
          first_odometer_cm INTEGER,
          last_odometer_cm INTEGER,
          gps_point_count INTEGER NOT NULL,
          precise_gps_point_count INTEGER NOT NULL,
          gps_distance_cm INTEGER NOT NULL,
          max_gps_speed_centi_mps INTEGER,
          max_temp_mosfet_deci_c INTEGER,
          max_temp_motor_deci_c INTEGER,
          first_latitude_e7 INTEGER,
          first_longitude_e7 INTEGER,
          first_moving_at_ms INTEGER,
          last_moving_at_ms INTEGER,
          route_preview TEXT,
          PRIMARY KEY (bucket_start_ms, board_id)
        )
        """.trimIndent(),
      )
      db.execSQL(FOLD_BUCKETS_SQL)
      db.execSQL("DROP TABLE telemetry_minute_buckets_old")
      db.execSQL(
        "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms " +
          "ON telemetry_minute_buckets(bucket_start_ms)",
      )
    }

    /** @parity /modules/vescape-core/ios/database/VescapeDatabase.swift `foldBucketsSql` */
    private val FOLD_BUCKETS_SQL = """
      INSERT INTO telemetry_minute_buckets (
        bucket_start_ms, board_id, sample_count, first_sample_at_ms, last_sample_at_ms,
        sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh,
        max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma,
        max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli,
        max_duty_abs_permille, first_odometer_cm, last_odometer_cm, gps_point_count,
        precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c,
        max_temp_motor_deci_c, first_latitude_e7, first_longitude_e7, first_moving_at_ms,
        last_moving_at_ms, route_preview
      )
      SELECT
        b.bucket_start_ms, b.board_id, SUM(b.sample_count), MIN(b.first_sample_at_ms),
        MAX(b.last_sample_at_ms), SUM(b.sum_abs_speed_centi_kmh), SUM(b.moving_speed_sample_count),
        SUM(b.sum_moving_abs_speed_centi_kmh), MAX(b.max_abs_speed_centi_kmh),
        MIN(b.min_battery_voltage_mv), MAX(b.max_motor_current_abs_ma),
        MAX(b.max_battery_current_abs_ma), SUM(b.battery_used_wh_milli),
        SUM(b.battery_regen_wh_milli), MAX(b.max_duty_abs_permille), MIN(b.first_odometer_cm),
        MAX(b.last_odometer_cm), SUM(b.gps_point_count), SUM(b.precise_gps_point_count),
        SUM(b.gps_distance_cm), MAX(b.max_gps_speed_centi_mps), MAX(b.max_temp_mosfet_deci_c),
        MAX(b.max_temp_motor_deci_c),
        (SELECT a.first_latitude_e7 FROM telemetry_minute_buckets_old a
          WHERE a.bucket_start_ms = b.bucket_start_ms AND a.board_id = b.board_id
            AND a.first_latitude_e7 IS NOT NULL ORDER BY a.first_sample_at_ms LIMIT 1),
        (SELECT a.first_longitude_e7 FROM telemetry_minute_buckets_old a
          WHERE a.bucket_start_ms = b.bucket_start_ms AND a.board_id = b.board_id
            AND a.first_latitude_e7 IS NOT NULL ORDER BY a.first_sample_at_ms LIMIT 1),
        MIN(b.first_moving_at_ms), MAX(b.last_moving_at_ms),
        CASE WHEN COUNT(*) = 1 THEN MAX(b.route_preview) END
      FROM telemetry_minute_buckets_old b
      GROUP BY b.bucket_start_ms, b.board_id
    """.trimIndent()

    val all = listOf(
      MIGRATION_3_4,
      MIGRATION_4_5,
      MIGRATION_5_6,
      MIGRATION_6_7,
      MIGRATION_7_8,
      MIGRATION_8_9,
      MIGRATION_9_10,
      MIGRATION_10_11,
      MIGRATION_11_12,
      MIGRATION_12_13,
      MIGRATION_13_14,
      MIGRATION_14_15,
      MIGRATION_15_16,
      MIGRATION_16_17,
      MIGRATION_17_18,
      MIGRATION_18_19,
      MIGRATION_19_20,
      MIGRATION_20_21,
      MIGRATION_21_22,
      MIGRATION_22_23,
      MIGRATION_23_24,
      MIGRATION_24_25,
      MIGRATION_25_26,
      MIGRATION_26_27,
      MIGRATION_27_28,
      MIGRATION_28_29,
      MIGRATION_29_30,
      MIGRATION_30_31,
      MIGRATION_31_32,
      MIGRATION_32_33,
      MIGRATION_33_34,
      MIGRATION_34_35,
      MIGRATION_35_36,
      MIGRATION_36_40,
      MIGRATION_40_41,
      MIGRATION_41_42,
      MIGRATION_42_43,
      MIGRATION_43_44,
      MIGRATION_44_45,
      MIGRATION_45_46,
      MIGRATION_46_47,
      MIGRATION_47_48,
      MIGRATION_48_49,
      MIGRATION_49_50,
      MIGRATION_50_51,
      MIGRATION_51_52,
      MIGRATION_52_53,
      MIGRATION_53_54,
      MIGRATION_54_55,
      MIGRATION_55_56,
    )

}
