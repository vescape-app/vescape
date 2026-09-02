package expo.modules.vescapecore.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import expo.modules.vescapecore.alerts.ALERT_BEEP_COUNT_DEFAULT
import java.io.File

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift
internal const val TELEMETRY_DATABASE_NAME = "vescape.db"
internal const val LEGACY_TELEMETRY_DATABASE_NAME = "telemetry.db"
// @parity /modules/vescape-core/ios/telemetry/DatabaseBackupManager.swift `TELEMETRY_SCHEMA_VERSION`
internal const val TELEMETRY_DATABASE_VERSION = 47

@Database(
  entities = [
    TelemetryFrameEntity::class,
    TelemetryMinuteBucketEntity::class,
    TelemetryMarkerEntity::class,
    MetricExclusionRangeEntity::class,
    BoardEntity::class,
    BoardSettingEntity::class,
    AlertRuleEntity::class,
    AppSettingEntity::class,
    TuneProfileEntity::class,
    TuneHistoryEntryEntity::class,
    DiagnosticEventEntity::class,
    PrivacyZoneEntity::class,
    BoardWarningEntity::class,
    SyncSequenceEntity::class,
    SyncActionEntity::class,
    SyncBindingEntity::class,
    VescFaultOccurrenceEntity::class,
    VescFaultCaptureEntity::class,
    VescFaultCaptureSampleEntity::class,
    FavoriteEntity::class,
    FavoriteMediaEntity::class,
    BoardConfigValuesEntity::class,
    MotorConfigValuesEntity::class,
    BoardConfigChangeNoticeEntity::class,
  ],
  version = TELEMETRY_DATABASE_VERSION,
  exportSchema = false,
)
abstract class TelemetryDatabase : RoomDatabase() {
  abstract fun telemetryDao(): TelemetryDao

  companion object {
    @Volatile
    private var instance: TelemetryDatabase? = null

    private fun hasColumn(db: SupportSQLiteDatabase, tableName: String, columnName: String): Boolean {
      db.query("PRAGMA table_info($tableName)").use { cursor ->
        val nameIndex = cursor.getColumnIndex("name")
        while (cursor.moveToNext()) {
          if (cursor.getString(nameIndex) == columnName) return true
        }
      }
      return false
    }

    private val MIGRATION_3_4 = object : Migration(3, 4) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_4_5 = object : Migration(4, 5) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE app_settings ADD COLUMN selected_board_id TEXT")
      }
    }

    private val MIGRATION_5_6 = object : Migration(5, 6) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_6_7 = object : Migration(6, 7) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE app_settings ADD COLUMN last_gps_latitude REAL")
        db.execSQL("ALTER TABLE app_settings ADD COLUMN last_gps_longitude REAL")
      }
    }

    private val MIGRATION_7_8 = object : Migration(7, 8) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_8_9 = object : Migration(8, 9) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DROP TABLE IF EXISTS history_locations")
        db.execSQL("DELETE FROM telemetry_minute_buckets WHERE sample_count = 0")
      }
    }

    private val MIGRATION_9_10 = object : Migration(9, 10) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN moving_speed_sample_count INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN sum_moving_abs_speed_centi_kmh INTEGER")
      }
    }

    private val MIGRATION_10_11 = object : Migration(10, 11) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE app_settings ADD COLUMN moving_avg_speed_threshold_kmh REAL NOT NULL DEFAULT 3.0")
      }
    }

    private val MIGRATION_11_12 = object : Migration(11, 12) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_12_13 = object : Migration(12, 13) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_13_14 = object : Migration(13, 14) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN max_temp_mosfet_deci_c INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN max_temp_motor_deci_c INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_latitude_e7 INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_longitude_e7 INTEGER")
      }
    }

    private val MIGRATION_14_15 = object : Migration(14, 15) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_15_16 = object : Migration(15, 16) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN raw_value TEXT")
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN reference_value TEXT")
        db.execSQL("ALTER TABLE metric_exclusions ADD COLUMN context_json TEXT")
      }
    }

    private val MIGRATION_16_17 = object : Migration(16, 17) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    private val MIGRATION_17_18 = object : Migration(17, 18) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_18_19 = object : Migration(18, 19) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_19_20 = object : Migration(19, 20) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_20_21 = object : Migration(20, 21) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_21_22 = object : Migration(21, 22) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN first_moving_at_ms INTEGER")
        db.execSQL("ALTER TABLE telemetry_minute_buckets ADD COLUMN last_moving_at_ms INTEGER")
      }
    }

    internal val MIGRATION_22_23 = object : Migration(22, 23) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN icon TEXT NOT NULL DEFAULT 'sliders-horizontal'")
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN color TEXT NOT NULL DEFAULT 'purple'")
      }
    }

    internal val MIGRATION_23_24 = object : Migration(23, 24) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE tune_profiles ADD COLUMN refloat_base_version TEXT NOT NULL DEFAULT ''")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)")
      }
    }

    internal val MIGRATION_24_25 = object : Migration(24, 25) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_25_26 = object : Migration(25, 26) {
      override fun migrate(db: SupportSQLiteDatabase) {
        if (!hasColumn(db, "alerts", "source")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN source TEXT")
        }
      }
    }

    /**
     * Per-board Alert Rules (#254). Alert Rules become owned by one Board (`board_id NOT NULL`,
     * composite PK so preset ids repeat per board). Pre-release decision: existing global rules are
     * dropped, not reassigned — riders redo alert setup per board. The three former global settings
     * keys (Alert Preset selection, Rider Top Speed, onboarding flag) move to Board Settings, so
     * their app_settings rows are dropped.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v27_alert_board_id`
     */
    internal val MIGRATION_26_27 = object : Migration(26, 27) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    /**
     * Map Points became server-owned (server ADR-0009), so the app keeps no local copy. Drops the
     * v27 table. The direction target it used to hold moves to app settings, which start empty
     * here — a rider re-picks it.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v29_drop_map_points`
     */
    internal val MIGRATION_27_28 = object : Migration(27, 28) {
      override fun migrate(db: SupportSQLiteDatabase) {
        dropMapPointTables(db)
      }
    }

    /**
     * Feature-branch builds shipped a different v28 that added Map Point columns and a reaction
     * table. Those installs never pass through 27 again, so the same drop runs once more for them.
     * A device that arrived through the migration above finds nothing left to drop.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v29_drop_map_points`
     */
    internal val MIGRATION_28_29 = object : Migration(28, 29) {
      override fun migrate(db: SupportSQLiteDatabase) {
        dropMapPointTables(db)
      }
    }

    /**
     * Board tombstones (#279). Deleting a Board stops removing its row and stamps `deleted_at`
     * instead, so Ride History outlives the Board that produced it (ADR 0027). Additive: existing
     * rows stay null, i.e. alive.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v41_board_deleted_at`
     */
    internal val MIGRATION_40_41 = object : Migration(40, 41) {
      override fun migrate(db: SupportSQLiteDatabase) {
        if (!hasColumn(db, "boards", "deleted_at")) {
          db.execSQL("ALTER TABLE boards ADD COLUMN deleted_at INTEGER")
        }
      }
    }

    /**
     * Scratch table holding migration 41→42's one and only BLE identifier → Board decision. Temp,
     * so it belongs to the connection and never reaches the schema Room validates.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `DEVICE_BOARD_MAP`
     */
    private const val DEVICE_BOARD_MAP = "telemetry_device_board_map"

    /**
     * Every table migration 41→42 moves off the BLE identifier, with the time column its rows are
     * ordered by. All five are minted for and rebuilt together: a Board minted from one table's
     * identifiers has to exist before any other table resolves the same identifier, or the two
     * disagree about who owns the history — the defect this migration exists to remove.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `telemetryTablesKeyedOnDeviceId`
     */
    private val TELEMETRY_TABLES_KEYED_ON_DEVICE_ID = listOf(
      "telemetry_frames" to "captured_at_ms",
      "telemetry_minute_buckets" to "bucket_start_ms",
      "telemetry_markers" to "occurred_at_ms",
      "diagnostic_events" to "occurred_at_ms",
      "metric_exclusion_ranges" to "start_ms",
    )

    /**
     * Telemetry keys on the Board id (#280, ADR 0028). `telemetry_frames` and
     * `telemetry_minute_buckets` gain `board_id` and lose `device_id` (the BLE identifier) and
     * `device_name` (the Board name denormalized at capture time); Ride History resolves the name
     * by looking the Board up instead.
     *
     * Both tables are rebuilt rather than altered: the bucket primary key moves to
     * `(bucket_start_ms, board_id)`, and dropping a column in place needs a SQLite newer than the
     * oldest supported device ships. The rebuild is a full copy, so it is the expensive step of
     * this upgrade on a phone with a long Ride History.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v42_telemetry_board_id`
     */
    internal val MIGRATION_41_42 = object : Migration(41, 42) {
      override fun migrate(db: SupportSQLiteDatabase) {
        mintOrphanBoards(db)
        buildDeviceBoardMap(db)
        rebuildFramesOnBoardId(db)
        rebuildBucketsOnBoardId(db)
        rebuildMarkersOnBoardId(db)
        rebuildDiagnosticEventsOnBoardId(db)
        rebuildExclusionRangesOnBoardId(db)
        db.execSQL("DROP TABLE IF EXISTS $DEVICE_BOARD_MAP")
      }
    }

    /**
     * Change Timestamps for the three tables that had none (#275). `boards` and `alerts` carried
     * `created_at` only and `telemetry_minute_buckets` carried nothing, so a rename, a toggle or a
     * bucket still filling was invisible to an "everything changed since T" scan. Additive, and
     * existing rows are backfilled rather than left at the `DEFAULT 0` a scan would re-send.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v43_sync_cursors`
     */
    internal val MIGRATION_42_43 = object : Migration(42, 43) {
      override fun migrate(db: SupportSQLiteDatabase) {
        if (!hasColumn(db, "boards", "updated_at")) {
          db.execSQL("ALTER TABLE boards ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
          db.execSQL("UPDATE boards SET updated_at = created_at")
        }
        db.execSQL("CREATE INDEX IF NOT EXISTS index_boards_updated_at ON boards(updated_at)")

        if (!hasColumn(db, "alerts", "updated_at")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
          db.execSQL("UPDATE alerts SET updated_at = created_at")
        }
        db.execSQL("CREATE INDEX IF NOT EXISTS index_alerts_updated_at ON alerts(updated_at)")

        if (!hasColumn(db, "telemetry_minute_buckets", "updated_at")) {
          db.execSQL(
            "ALTER TABLE telemetry_minute_buckets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
          )
          db.execSQL("UPDATE telemetry_minute_buckets SET updated_at = last_sample_at_ms")
        }
        db.execSQL(
          "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_updated_at " +
            "ON telemetry_minute_buckets(updated_at)",
        )
      }
    }

    /**
     * Splits the device-local Sync Cursor from the wall-clock last-write-wins timestamp (#275).
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v44_sync_seq`
     */
    internal val MIGRATION_43_44 = object : Migration(43, 44) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS sync_sequences (
            name TEXT NOT NULL PRIMARY KEY,
            last_value INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        for (table in SYNC_SEQ_TABLES_V44) {
          if (!hasColumn(db, table, "sync_seq")) {
            db.execSQL("ALTER TABLE $table ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0")
            db.execSQL("UPDATE $table SET sync_seq = rowid")
          }
          db.execSQL("CREATE INDEX IF NOT EXISTS index_${table}_sync_seq ON $table(sync_seq)")
          db.execSQL(
            "INSERT OR REPLACE INTO sync_sequences (name, last_value) " +
              "VALUES ('$table', (SELECT COALESCE(MAX(sync_seq), 0) FROM $table))",
          )
        }
      }
    }


    /**
     * Sync Cursors for the six remaining mutable tables (#281). `board_warnings` also gains the
     * wall-clock `updated_at` every other mutable table already carries, backfilled from its newest
     * detection.
     *
     * Existing rows are backfilled from `rowid` — distinct and non-zero, so no two rows share a
     * cursor position and none of them sit at the seed value — and each table's sequence is seeded
     * past the highest value handed out. Every step is guarded, so a re-run is a no-op.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v45_sync_seq_remaining`
     */
    internal val MIGRATION_44_45 = object : Migration(44, 45) {
      override fun migrate(db: SupportSQLiteDatabase) {
        if (!hasColumn(db, "board_warnings", "updated_at")) {
          db.execSQL("ALTER TABLE board_warnings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
          db.execSQL("UPDATE board_warnings SET updated_at = last_detected_at")
        }

        for (table in SYNC_SEQ_TABLES_V45) {
          if (!hasColumn(db, table, "sync_seq")) {
            db.execSQL("ALTER TABLE $table ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0")
            db.execSQL("UPDATE $table SET sync_seq = rowid")
          }
          db.execSQL("CREATE INDEX IF NOT EXISTS index_${table}_sync_seq ON $table(sync_seq)")
          db.execSQL(
            "INSERT OR REPLACE INTO sync_sequences (name, last_value) " +
              "VALUES ('$table', (SELECT COALESCE(MAX(sync_seq), 0) FROM $table))",
          )
        }

        // Phone-local keys are defined by their absence from the scan, so the backfill above has to
        // be undone for them: an uploader would otherwise ship whatever this phone happened to hold
        // at upgrade time, exactly once. See NOT_SYNCED_SETTING_KEYS.
        val phoneLocal = NOT_SYNCED_SETTING_KEYS.joinToString(",") { "'$it'" }
        db.execSQL("UPDATE app_settings SET sync_seq = 0 WHERE key IN ($phoneLocal)")
      }
    }

    /**
     * The Sync Action log (#282): an append-only record of semantic removals, which no surviving row
     * can express. Additive — a new table only — and guarded, so a re-run is a no-op.
     *
     * The log is keyed on its own `AUTOINCREMENT` cursor and carries no `sync_seq`: SQLite
     * guarantees that key monotonic and never reused, so it already *is* the cursor.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v46_sync_actions`
     */
    internal val MIGRATION_45_46 = object : Migration(45, 46) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS sync_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            type TEXT NOT NULL,
            target TEXT NOT NULL,
            board_id TEXT,
            key TEXT NOT NULL,
            deleted_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_sync_actions_target ON sync_actions(target)")
      }
    }


    /**
     * The Account binding (#284): which Vescape Account this local database belongs to. Additive and
     * guarded, and deliberately left empty — an existing install is unbound until an Account signs
     * in and claims it, which is also what keeps the current age-only retention behaviour until
     * then.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v47_sync_binding`
     */
    internal val MIGRATION_46_47 = object : Migration(46, 47) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS sync_binding (
            id INTEGER PRIMARY KEY NOT NULL,
            account_id TEXT NOT NULL,
            bound_at INTEGER NOT NULL
          )
          """.trimIndent(),
        )
      }
    }

    /**
     * Telemetry whose `device_id` matches no Board would lose both its identity and its label:
     * either the Board was hard-deleted before tombstones existed (ADR 0027), or it was re-linked
     * to a different peripheral and the old identifier no longer resolves. One tombstoned Board is
     * minted per unresolved identifier, named from that telemetry's own historical `device_name`,
     * so the history stays joinable, keeps a label, and can be backed up.
     *
     * The minted row is a tombstone with no Board Link: `deleted_at` keeps it out of every
     * Rider-facing list, and a null `ble_id` stops it from ever capturing a future re-link. The id
     * is derived from the identifier rather than random so re-running the migration is a no-op.
     */
    /** @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `mintOrphanBoards` */
    private fun mintOrphanBoards(db: SupportSQLiteDatabase) {
      val now = System.currentTimeMillis()
      for ((name, timeColumn) in TELEMETRY_TABLES_KEYED_ON_DEVICE_ID) {
        // Metric Exclusion Ranges never carried a `device_name`, so there is nothing to name a
        // Board after there — a range on an identifier no other table saw falls back to the
        // generic name. Every other table names the mint from its own newest label.
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
     * One BLE identifier can be claimed by more than one Board — the same peripheral linked twice,
     * which the app supports and a Rider produces by pairing a board they already own a second
     * time. Telemetry predating this migration recorded only the identifier, so for such rows there
     * is no evidence of which of those Boards was connected, and no rule can recover it.
     *
     * What must not happen is the two rebuilds below disagreeing. Resolved independently, each
     * `SELECT … LIMIT 1` is free to return a different Board for the same identifier, and then the
     * frames of a ride sit under one Board while its buckets sit under another: History lists the
     * ride from the buckets and finds no frames for it, so stats render over an empty route.
     *
     * So the choice is made exactly once, here, and both rebuilds read it. `MIN(b.id)` is an
     * arbitrary but stable pick among the claimants — arbitrary because the information to do
     * better does not exist, stable because re-running the migration reaches the same answer.
     * Deliberately not left unattributed: an unowned row is never uploaded and is pruned on age, so
     * "unknown" would quietly destroy the history a merely mis-labelled ride keeps intact.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `buildDeviceBoardMap`
     */
    private fun buildDeviceBoardMap(db: SupportSQLiteDatabase) {
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

    /**
     * Resolves a telemetry row's `device_id` to a Board id: the Board [buildDeviceBoardMap] chose
     * for the identifier, otherwise the tombstone minted for it above. A row that never carried an
     * identifier stays unattributed.
     *
     * The lookup hits a primary key holding one row per identifier, so unlike a scan over `boards`
     * it cannot resolve the same identifier two ways in two statements.
     */
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

    /** @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `rebuildFramesOnBoardId` */
    private fun rebuildFramesOnBoardId(db: SupportSQLiteDatabase) {
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

    /**
     * The primary key move from `(bucket_start_ms, device_id)` to `(bucket_start_ms, board_id)` is
     * a table rebuild, not an `ALTER`.
     */
    /** @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `rebuildBucketsOnBoardId` */
    private fun rebuildBucketsOnBoardId(db: SupportSQLiteDatabase) {
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
      // Grouped rather than copied row-for-row so the rebuild is total. A `board_id` collision on
      // the new key needs two identifiers resolving to one Board inside one minute, which the
      // resolver cannot produce — the map is keyed on the identifier and a Board carries one — but
      // an ungrouped copy would abort the whole migration on a constraint error if it ever did,
      // stranding the database mid-upgrade. The fold sums the additive lanes and takes the extreme
      // of the peaks, as an upsert merge would.
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
     * A Marker notes something that happened while recording — a gap, a resume. It belongs to the
     * Board it happened on, and `board_id` stays nullable because a Marker can be written with no
     * Board connected. `device_name` goes with the identifier: the Board holds that text once.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `rebuildMarkersOnBoardId`
     */
    private fun rebuildMarkersOnBoardId(db: SupportSQLiteDatabase) {
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
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `rebuildDiagnosticEventsOnBoardId`
     */
    private fun rebuildDiagnosticEventsOnBoardId(db: SupportSQLiteDatabase) {
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
     * A Metric Exclusion Range is a span of *one Board's* samples the app decided not to count, so
     * unlike a Marker it has no meaning without one: `board_id` is NOT NULL, as `device_id` was.
     *
     * A range whose row never named a device takes the same unattributed sentinel a bucket does —
     * the column is NOT NULL on both, so both need a value rather than a null, and one sentinel
     * across the two keeps "no Board" a single idea.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `rebuildExclusionRangesOnBoardId`
     */
    private fun rebuildExclusionRangesOnBoardId(db: SupportSQLiteDatabase) {
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

    private fun dropMapPointTables(db: SupportSQLiteDatabase) {
      db.execSQL("DROP TABLE IF EXISTS map_point_reactions")
      db.execSQL("DROP TABLE IF EXISTS map_points")
    }

    /**
     * Favorites (#287). Durable, optionally named time ranges over Ride History (ADR 0029). The row
     * carries a native-minted UUID id, native-owned timestamps, and the summary stats computed once
     * from the raw samples inside the range.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v30_favorites`
     */
    internal val MIGRATION_29_30 = object : Migration(29, 30) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    /**
     * Favorite Media (#291). Native manifest metadata truth; bytes live in canonical Favorite-owned
     * app storage (ADR 0030).
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v31_favorite_media`
     */
    internal val MIGRATION_30_31 = object : Migration(30, 31) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    /**
     * Per-rule repeat cadence and beep count (#348). Existing rows land on one-shot with the
     * former hardcoded 3 beeps, so nothing a rider already configured changes how it sounds.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v32_alert_repeat`
     */
    /**
     * Last Known Board Config Values: latest decoded Refloat config per Board + base version,
     * restored as `lastKnown` on connect (#393).
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v33_board_config_values`
     */
    internal val MIGRATION_32_33 = object : Migration(32, 33) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_33_34 = object : Migration(33, 34) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS board_config_change_notices (board_id TEXT NOT NULL PRIMARY KEY, detected_at INTEGER NOT NULL, diffs_json TEXT NOT NULL)")
      }
    }
    /**
     * Last Known Motor Config Values: latest decoded VESC motor config per Board + MCCONF signature,
     * restored as `lastKnown` on connect.
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v36_motor_config_values`
     */
    internal val MIGRATION_35_36 = object : Migration(35, 36) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    /**
     * One durable row per fault activation, keyed by a native-minted id.
     * @parity /modules/vescape-core/ios/faults/VescFaultStore.swift `createTables`
     */
    private fun createVescFaultOccurrences(db: SupportSQLiteDatabase) {
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
     * VESC Fault Captures: the self-contained window of decoded Board samples each occurrence owns.
     * Additive only — dedicated tables, no Ride History coupling, no GPS.
     * @parity /modules/vescape-core/ios/faults/VescFaultCaptureStore.swift `createTables`
     */
    private fun createVescFaultCaptures(db: SupportSQLiteDatabase) {
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
     * VESC Fault Evidence (#430): dedicated Board-owned fault storage replaces the partial Ride
     * History fault path.
     *
     * Creates the fault tables and removes the legacy telemetry fault storage — the `fault_code`
     * column and its partial index on `telemetry_frames`, and `fault_count` on
     * `telemetry_minute_buckets`. Legacy values are dropped, not backfilled: a fault code repeated
     * across frames was never a distinct activation, so there is nothing faithful to migrate.
     *
     * SQLite before 3.35 has no `DROP COLUMN`, so both tables are rebuilt by copy.
     *
     * 36 to 40 in one step: versions 37 to 39 only ever existed in development builds while the
     * feature was being cut down, and none of their shapes shipped. A database sitting on one of
     * them has no path here and is rebuilt by the destructive fallback.
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v40_vesc_faults`
     */
    internal val MIGRATION_36_40 = object : Migration(36, 40) {
      override fun migrate(db: SupportSQLiteDatabase) {
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
    }

    internal val MIGRATION_34_35 = object : Migration(34, 35) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_kind TEXT NOT NULL DEFAULT 'fixed'")
        db.execSQL("ALTER TABLE alerts ADD COLUMN config_field_id TEXT")
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_offset REAL")
        db.execSQL("ALTER TABLE alerts ADD COLUMN threshold_max_offset REAL")
      }
    }

    internal val MIGRATION_31_32 = object : Migration(31, 32) {
      override fun migrate(db: SupportSQLiteDatabase) {
        if (!hasColumn(db, "alerts", "repeat_every_seconds")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN repeat_every_seconds INTEGER")
        }
        if (!hasColumn(db, "alerts", "beep_count")) {
          db.execSQL("ALTER TABLE alerts ADD COLUMN beep_count INTEGER NOT NULL DEFAULT $ALERT_BEEP_COUNT_DEFAULT")
        }
      }
    }

    /**
     * One-time file rename from the pre-release "telemetry.db" name. Checkpoints the legacy WAL so
     * the whole database lives in the main file, then renames it in place. Idempotent: once the new
     * file exists (or no legacy file is present) this is a no-op.
     */
    private fun migrateLegacyDatabaseFile(context: Context) {
      val target = context.getDatabasePath(TELEMETRY_DATABASE_NAME)
      val legacy = context.getDatabasePath(LEGACY_TELEMETRY_DATABASE_NAME)
      if (target.exists() || !legacy.exists()) return
      runCatching {
        SQLiteDatabase.openDatabase(legacy.path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
          db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null).close()
        }
      }
      target.parentFile?.mkdirs()
      if (legacy.renameTo(target)) {
        File("${legacy.path}-wal").delete()
        File("${legacy.path}-shm").delete()
      }
    }

    fun get(context: Context): TelemetryDatabase {
      return instance ?: synchronized(this) {
        migrateLegacyDatabaseFile(context.applicationContext)
        instance ?: Room.databaseBuilder(
          context.applicationContext,
          TelemetryDatabase::class.java,
          TELEMETRY_DATABASE_NAME,
        )
          .addMigrations(
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
          )
          .fallbackToDestructiveMigration(true)
          .addCallback(object : Callback() {
            override fun onOpen(db: SupportSQLiteDatabase) {
              db.execSQL("PRAGMA optimize")
            }
          })
          .build()
          .also { instance = it }
      }
    }

    fun closeAndReset() {
      synchronized(this) {
        instance?.close()
        instance = null
      }
    }
  }
}
