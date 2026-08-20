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
internal const val TELEMETRY_DATABASE_VERSION = 33

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
    FavoriteEntity::class,
    FavoriteMediaEntity::class,
    RideSummaryNotificationEntity::class,
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
     * Ride Summary Notification dedup markers (#410). One row per Ride History recording id
     * (`deviceId:firstSampleAtMs:lastSampleAtMs`); its presence means the single silent summary for
     * that ride was already claimed, so restoration, process restart, and repeated finalize
     * callbacks cannot send a second one.
     *
     * @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `v33_ride_summary_notifications`
     */
    internal val MIGRATION_32_33 = object : Migration(32, 33) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          """
          CREATE TABLE IF NOT EXISTS ride_summary_notifications (
            ride_id TEXT NOT NULL PRIMARY KEY,
            notified_at_ms INTEGER NOT NULL
          )
          """.trimIndent(),
        )
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
          )
          .fallbackToDestructiveMigration(true)
          .addCallback(object : Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
              db.execSQL(
                """
                CREATE INDEX IF NOT EXISTS index_telemetry_frames_fault
                ON telemetry_frames(captured_at_ms)
                WHERE fault_code IS NOT NULL AND fault_code != 0
                """.trimIndent(),
              )
            }

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
