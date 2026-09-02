import Foundation
import GRDB

/// Single on-device database for iOS. One GRDB file backs both app data (boards, alert rules,
/// privacy zones, map points, settings) and telemetry tables — mirroring the single Android Room
/// database. GRDB `DatabasePool` opens in WAL mode by default, matching Room's WAL concurrency.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt
/// @platform-diff iOS is greenfield, so the schema starts at a single `v1` migration that creates
/// the final table shapes directly instead of replaying Android's incremental Room migrations. The
/// telemetry tables are created schema-only here; their writers land in later slices (#60/#61/#63).
enum TelemetryDatabase {
  private static let databaseName = "vescape.db"
  private static let legacyDatabaseName = "telemetry.db"

  /// Pool installed by a database restore, replacing the originally opened `poolResult`. Callers
  /// read `pool` on every access, so a swap is picked up transparently across the app.
  private static var reopened: DatabasePool?

  private static let poolResult: Result<DatabasePool, Error> = {
    do {
      guard let url = databaseURL else { throw CocoaError(.fileNoSuchFile) }
      migrateLegacyDatabaseFile(to: url)
      let pool = try DatabasePool(path: url.path)
      try migrator.migrate(pool)
      return .success(pool)
    } catch {
      return .failure(error)
    }
  }()

  /// The shared pool, or `nil` if the database could not be opened. Callers degrade gracefully
  /// (reads return empty, writes no-op) rather than crashing the bridge.
  static var pool: DatabasePool? {
    if let reopened { return reopened }
    if case let .success(pool) = poolResult { return pool }
    return nil
  }

  /// One-time file rename from the pre-release "telemetry.db" name. Checkpoints the legacy WAL so
  /// the whole database lives in the main file, then renames it in place. Idempotent: once the new
  /// file exists (or no legacy file is present) this is a no-op.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `migrateLegacyDatabaseFile`
  private static func migrateLegacyDatabaseFile(to url: URL) {
    let fm = FileManager.default
    let legacy = url.deletingLastPathComponent().appendingPathComponent(legacyDatabaseName)
    guard !fm.fileExists(atPath: url.path), fm.fileExists(atPath: legacy.path) else { return }
    if let legacyPool = try? DatabasePool(path: legacy.path) {
      _ = try? legacyPool.writeWithoutTransaction { db in try db.checkpoint(.truncate) }
      try? legacyPool.close()
    }
    do {
      try fm.moveItem(at: legacy, to: url)
      try? fm.removeItem(atPath: legacy.path + "-wal")
      try? fm.removeItem(atPath: legacy.path + "-shm")
    } catch {
      // Leave the legacy file untouched; the next launch retries.
    }
  }

  /// On-disk location of the single database file.
  static var databaseURL: URL? {
    guard let support = try? FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ) else { return nil }
    return support.appendingPathComponent(databaseName)
  }

  /// Size of the live database file in bytes, or 0 when it does not exist yet.
  static var databaseSizeBytes: Int64 {
    guard let path = databaseURL?.path,
          let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let size = attrs[.size] as? NSNumber else { return 0 }
    return size.int64Value
  }

  /// GRDB's own ledger of applied migrations. A backup taken on Android carries the schema but not
  /// this table, so restoring one used to replay every migration against tables that already exist
  /// — `CREATE TABLE boards` on a database that has `boards` — and the whole restore rolled back.
  private static let migrationLedgerTable = "grdb_migrations"

  /// Room version a migration corresponds to, read off its `v<N>_…` identifier.
  ///
  /// The identifiers are named after Android's Room versions on purpose: the two schemas move
  /// together, so the number is what makes an incoming Room database comparable to this migrator.
  /// (`v1` is the exception in content, not in numbering — iOS is greenfield, so it creates the
  /// v1-era shapes directly rather than replaying Android's early steps.)
  private static func roomVersion(of identifier: String) -> Int {
    Int(identifier.dropFirst().prefix { $0.isNumber }) ?? Int.max
  }

  /// Mark the migrations an incoming foreign database already satisfies, so `migrate` runs only the
  /// genuinely newer ones. A backup from an older Android build stamps fewer of them and gets the
  /// remaining migrations applied for real.
  ///
  /// Internal, not private, so the migration tests can stamp a database the way a restore does.
  internal static func stampAppliedMigrations(_ db: Database, schemaVersion: Int) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS \(migrationLedgerTable) (identifier TEXT NOT NULL PRIMARY KEY)")
    for identifier in migrator.migrations where roomVersion(of: identifier) <= schemaVersion {
      try db.execute(
        sql: "INSERT OR IGNORE INTO \(migrationLedgerTable) (identifier) VALUES (?)",
        arguments: [identifier]
      )
    }
  }

  /// Bridge the places where the two platforms hold the same fact in different shapes. Stamping
  /// tells the migrator an incoming Room database is up to date, which it is — for Android. Where
  /// iOS keeps something Android files elsewhere, nothing else will ever add it, so it is added
  /// here. Every future divergence belongs in this function.
  ///
  /// Today that is one column: a Board's proven transport is a column on `boards` here and a
  /// `board_settings` row there.
  ///
  /// Internal, not private, so the migration tests can reconcile a database the way a restore does.
  internal static func reconcileForeignSchema(_ db: Database) throws {
    guard try db.tableExists("boards"),
          try !db.columns(in: "boards").contains(where: { $0.name == "transport" })
    else { return }
    try db.execute(sql: "ALTER TABLE boards ADD COLUMN transport TEXT")
    // `value_json` is a JSON string ("direct" or a CAN id) and the column stores it bare.
    try db.execute(sql: """
      UPDATE boards SET transport = (
        SELECT TRIM(value_json, '"') FROM board_settings
        WHERE board_settings.board_id = boards.id AND board_settings.key = 'transport'
      )
      """)
  }

  /// Hot-swap the database file with a validated restore, closing the live pool so SQLite releases
  /// the file + WAL sidecars, then reopening (and migrating) at the same path. On any failure the
  /// previous file is rolled back so the app is never left without a database.
  ///
  /// `schemaVersion` comes from the backup manifest and only matters for a database that has never
  /// been migrated by GRDB — an Android backup. An iOS backup brings its own ledger and is migrated
  /// from wherever it left off.
  static func replaceDatabase(withFileAt source: URL, schemaVersion: Int) throws {
    guard let target = databaseURL else { throw CocoaError(.fileNoSuchFile) }
    let fm = FileManager.default
    let sidecarSuffixes = ["", "-wal", "-shm"]

    if let reopened { try? reopened.close() }
    else if case let .success(pool) = poolResult { try? pool.close() }

    let rollbackDir = fm.temporaryDirectory.appendingPathComponent("db-rollback-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: rollbackDir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: rollbackDir) }

    var moved: [(original: URL, saved: URL)] = []
    for suffix in sidecarSuffixes {
      let file = URL(fileURLWithPath: target.path + suffix)
      guard fm.fileExists(atPath: file.path) else { continue }
      let saved = rollbackDir.appendingPathComponent(target.lastPathComponent + suffix)
      try fm.moveItem(at: file, to: saved)
      moved.append((file, saved))
    }

    do {
      try fm.copyItem(at: source, to: target)
      let pool = try DatabasePool(path: target.path)
      try pool.write { db in
        guard try !db.tableExists(migrationLedgerTable) else { return }
        try stampAppliedMigrations(db, schemaVersion: schemaVersion)
        try reconcileForeignSchema(db)
      }
      try migrator.migrate(pool)
      try pool.read { db in _ = try Int.fetchOne(db, sql: "SELECT 1") }
      reopened = pool
    } catch {
      for suffix in sidecarSuffixes { try? fm.removeItem(at: URL(fileURLWithPath: target.path + suffix)) }
      for entry in moved { try? fm.moveItem(at: entry.saved, to: entry.original) }
      reopened = try? DatabasePool(path: target.path)
      throw error
    }
  }

  /// Internal, not private, so migration tests can run the real migrator against an in-memory
  /// database and stop at a chosen version with `migrate(_:upTo:)`.
  internal static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()

    migrator.registerMigration("v1") { db in
      // MARK: App data

      try db.execute(sql: """
        CREATE TABLE boards (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          ble_id TEXT,
          transport TEXT,
          created_at INTEGER NOT NULL
        )
        """)
      try db.execute(sql: "CREATE INDEX index_boards_created_at ON boards(created_at)")

      try db.execute(sql: """
        CREATE TABLE board_settings (
          board_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (board_id, key)
        )
        """)
      try db.execute(sql: "CREATE INDEX index_board_settings_board_id ON board_settings(board_id)")

      try db.execute(sql: """
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
        """)
      try db.execute(sql: "CREATE INDEX index_alerts_board_id ON alerts(board_id)")
      try db.execute(sql: "CREATE INDEX index_alerts_control_id ON alerts(control_id)")
      try db.execute(sql: "CREATE INDEX index_alerts_enabled ON alerts(enabled)")
      try db.execute(sql: "CREATE INDEX index_alerts_created_at ON alerts(created_at)")

      try db.execute(sql: """
        CREATE TABLE privacy_zones (
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
        """)

      try db.execute(sql: """
        CREATE TABLE map_points (
          id TEXT NOT NULL PRIMARY KEY,
          kind TEXT NOT NULL,
          latitude_e7 INTEGER NOT NULL,
          longitude_e7 INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
        """)
      try db.execute(sql: "CREATE INDEX index_map_points_kind ON map_points(kind)")

      try db.execute(sql: """
        CREATE TABLE app_settings (
          key TEXT NOT NULL PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
        """)

      // MARK: Telemetry (schema only — populated by #60/#61/#63)

      try db.execute(sql: """
        CREATE TABLE telemetry_frames (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
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
        """)
      try db.execute(sql: "CREATE INDEX index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
      try db.execute(sql: """
        CREATE INDEX index_telemetry_frames_device_id_captured_at_ms
        ON telemetry_frames(device_id, captured_at_ms)
        """)
      try db.execute(sql: """
        CREATE TABLE telemetry_minute_buckets (
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
        """)
      try db.execute(sql: "CREATE INDEX index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")

      try db.execute(sql: """
        CREATE TABLE telemetry_markers (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          occurred_at_ms INTEGER NOT NULL,
          elapsed_realtime_ms INTEGER NOT NULL,
          type TEXT NOT NULL,
          device_id TEXT,
          device_name TEXT,
          message TEXT,
          gap_ms INTEGER
        )
        """)
      try db.execute(sql: "CREATE INDEX index_telemetry_markers_occurred_at_ms ON telemetry_markers(occurred_at_ms)")
      try db.execute(sql: """
        CREATE INDEX index_telemetry_markers_device_id_occurred_at_ms
        ON telemetry_markers(device_id, occurred_at_ms)
        """)

      try db.execute(sql: """
        CREATE TABLE metric_exclusion_ranges (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          device_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          sample_count INTEGER NOT NULL
        )
        """)
      try db.execute(sql: """
        CREATE INDEX index_metric_exclusion_ranges_start_ms_end_ms
        ON metric_exclusion_ranges(start_ms, end_ms)
        """)
      try db.execute(sql: """
        CREATE INDEX index_metric_exclusion_ranges_device_id_start_ms_end_ms
        ON metric_exclusion_ranges(device_id, start_ms, end_ms)
        """)

      try db.execute(sql: """
        CREATE TABLE diagnostic_events (
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
        """)
      try db.execute(sql: "CREATE INDEX index_diagnostic_events_occurred_at_ms ON diagnostic_events(occurred_at_ms)")
      try db.execute(sql: "CREATE INDEX index_diagnostic_events_event_name ON diagnostic_events(event_name)")
      try db.execute(sql: """
        CREATE INDEX index_diagnostic_events_device_id_occurred_at_ms
        ON diagnostic_events(device_id, occurred_at_ms)
        """)
    }

    // MARK: Tune Profiles (#161)
    // Per-board VESC tune configs with reversible Tune History. DDL lives on `TuneProfileStore` so
    // the schema stays single-source with the tests that reuse it.
    migrator.registerMigration("v2_tune_profiles") { db in
      try TuneProfileStore.createTables(db)
    }

    migrator.registerMigration("v23_tune_profile_metadata") { db in
      let columns = try Row.fetchAll(db, sql: "PRAGMA table_info(tune_profiles)")
        .compactMap { $0["name"] as String? }
      if !columns.contains("icon") {
        try db.execute(sql: "ALTER TABLE tune_profiles ADD COLUMN icon TEXT NOT NULL DEFAULT 'sliders-horizontal'")
      }
      if !columns.contains("color") {
        try db.execute(sql: "ALTER TABLE tune_profiles ADD COLUMN color TEXT NOT NULL DEFAULT 'purple'")
      }
    }

    migrator.registerMigration("v24_tune_profile_refloat_base_version") { db in
      let hasRefloatBaseVersion = try db.columns(in: "tune_profiles").contains { $0.name == "refloat_base_version" }
      if !hasRefloatBaseVersion {
        try db.execute(sql: "ALTER TABLE tune_profiles ADD COLUMN refloat_base_version TEXT NOT NULL DEFAULT ''")
      }
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)")
    }

    // MARK: Board Warnings (#208)
    // Durable one-row-per-(board, kind) warning store. DDL lives on `BoardWarningStore` so the schema
    // stays single-source with the tests that reuse it. Mirrors Android Room migration 24→25.
    migrator.registerMigration("v25_board_warnings") { db in
      try BoardWarningStore.createTables(db)
    }

    migrator.registerMigration("v26_alert_source") { db in
      let hasSource = try db.columns(in: "alerts").contains { $0.name == "source" }
      if !hasSource {
        try db.execute(sql: "ALTER TABLE alerts ADD COLUMN source TEXT")
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_26_27`
    // Per-board Alert Rules (#254). Existing global rules are intentionally dropped; the former
    // global alert settings are now board-scoped settings.
    migrator.registerMigration("v27_alert_board_id") { db in
      let hasBoardId = try db.columns(in: "alerts").contains { $0.name == "board_id" }
      if !hasBoardId {
        try db.execute(sql: "DROP TABLE IF EXISTS alerts")
        try db.execute(sql: """
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
          """)
        try db.execute(sql: "CREATE INDEX index_alerts_board_id ON alerts(board_id)")
        try db.execute(sql: "CREATE INDEX index_alerts_control_id ON alerts(control_id)")
        try db.execute(sql: "CREATE INDEX index_alerts_enabled ON alerts(enabled)")
        try db.execute(sql: "CREATE INDEX index_alerts_created_at ON alerts(created_at)")
      }
      try db.execute(sql: """
        DELETE FROM app_settings WHERE key IN ('alertPreset', 'riderTopSpeedKmh', 'alertPresetsOnboarded')
        """)
    }

    // Map Points became server-owned (server ADR-0009), so the app keeps no local copy. Drops the
    // v27 table and the reaction table that only ever existed on a feature branch. The direction
    // target it used to hold moves to app settings, which start empty here — a rider re-picks it.
    // GRDB keys migrations by name, so one migration covers both released and feature-branch
    // installs; Room needs two steps because it keys them by version number.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_28_29`
    migrator.registerMigration("v29_drop_map_points") { db in
      try db.execute(sql: "DROP TABLE IF EXISTS map_point_reactions")
      try db.execute(sql: "DROP TABLE IF EXISTS map_points")
    }

    // MARK: Favorites (#287)
    // Durable, optionally named time ranges over Ride History (ADR 0029). DDL lives on
    // `FavoriteStore` so the schema stays single-source with the tests that reuse it. Mirrors
    // Android Room migration 29→30.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_29_30`
    migrator.registerMigration("v30_favorites") { db in
      try FavoriteStore.createTables(db)
    }

    // Favorite Media (#291). Native manifest metadata truth; bytes live in canonical Favorite-owned
    // app storage (ADR 0030).
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_30_31`
    migrator.registerMigration("v31_favorite_media") { db in
      try FavoriteMediaStore.createTables(db)
    }

    // Per-rule repeat cadence and beep count (#348). Existing rows land on one-shot with the
    // former hardcoded 3 beeps, so nothing a rider already configured changes how it sounds.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_31_32`
    migrator.registerMigration("v32_alert_repeat") { db in
      let columns = try db.columns(in: "alerts").map(\.name)
      if !columns.contains("repeat_every_seconds") {
        try db.execute(sql: "ALTER TABLE alerts ADD COLUMN repeat_every_seconds INTEGER")
      }
      if !columns.contains("beep_count") {
        try db.execute(
          sql: "ALTER TABLE alerts ADD COLUMN beep_count INTEGER NOT NULL DEFAULT \(alertBeepCountDefault)"
        )
      }
    }

    // Last Known Board Config Values: latest decoded Refloat config per Board + base version,
    // restored as `lastKnown` on connect (#393).
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_32_33`
    migrator.registerMigration("v33_board_config_values") { db in
      try BoardConfigStore.createTables(db)
    }

    migrator.registerMigration("v34_board_config_change_notices") { db in
      try db.execute(sql: "CREATE TABLE IF NOT EXISTS board_config_change_notices (board_id TEXT NOT NULL PRIMARY KEY, detected_at INTEGER NOT NULL, diffs_json TEXT NOT NULL)")
    }
    migrator.registerMigration("v35_alert_config_relative") { db in
      let columns = try db.columns(in: "alerts").map(\.name)
      if !columns.contains("threshold_kind") { try db.execute(sql: "ALTER TABLE alerts ADD COLUMN threshold_kind TEXT NOT NULL DEFAULT 'fixed'") }
      if !columns.contains("config_field_id") { try db.execute(sql: "ALTER TABLE alerts ADD COLUMN config_field_id TEXT") }
      if !columns.contains("threshold_offset") { try db.execute(sql: "ALTER TABLE alerts ADD COLUMN threshold_offset REAL") }
      if !columns.contains("threshold_max_offset") { try db.execute(sql: "ALTER TABLE alerts ADD COLUMN threshold_max_offset REAL") }
    }

    migrator.registerMigration("v36_motor_config_values") { db in
      try MotorConfigStore.createTables(db)
    }

    /// VESC Fault Evidence (#430): dedicated Board-owned fault storage replaces the partial Ride
    /// History fault path. Creates the fault tables and removes the legacy telemetry fault storage —
    /// `telemetry_frames.fault_code` with its partial index, and
    /// `telemetry_minute_buckets.fault_count`. Legacy values are dropped, not backfilled.
    ///
    /// Both tables are rebuilt by copy rather than `DROP COLUMN`, matching Android and staying
    /// correct on SQLite builds older than 3.35.
    ///
    /// Numbered `v40` rather than `v37` because Room reached the same shape at version 40. The
    /// identifiers in between only existed in development builds while the feature was being cut
    /// down; a database that recorded them is beyond this migrator and has to be reinstalled.
    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_36_40`
    migrator.registerMigration("v40_vesc_faults") { db in
      try VescFaultStore.createTables(db)
      try VescFaultCaptureStore.createTables(db)
      try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_fault")
      if try db.columns(in: "telemetry_frames").map(\.name).contains("fault_code") {
        try db.execute(sql: """
          CREATE TABLE telemetry_frames_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          """)
        try db.execute(sql: """
          INSERT INTO telemetry_frames_new
          SELECT id, captured_at_ms, elapsed_realtime_ms, device_id, device_name, can_id, flags,
                 changed_mask_1, changed_mask_2, speed_centi_kmh, battery_voltage_mv,
                 motor_current_ma, battery_current_ma, duty_permille, pitch_centi_deg,
                 roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state,
                 switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c,
                 temp_motor_deci_c, latitude_e7, longitude_e7, gps_speed_centi_mps,
                 bearing_centi_deg, accuracy_cm, altitude_cm, location_timestamp_ms
          FROM telemetry_frames
          """)
        try db.execute(sql: "DROP TABLE telemetry_frames")
        try db.execute(sql: "ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
        try db.execute(sql: "CREATE INDEX index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
        try db.execute(sql: """
          CREATE INDEX index_telemetry_frames_device_id_captured_at_ms
          ON telemetry_frames(device_id, captured_at_ms)
          """)
      }

      if try db.columns(in: "telemetry_minute_buckets").map(\.name).contains("fault_count") {
        try db.execute(sql: """
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
          """)
        try db.execute(sql: """
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
          """)
        try db.execute(sql: "DROP TABLE telemetry_minute_buckets")
        try db.execute(sql: "ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
        try db.execute(sql: "CREATE INDEX index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")
      }
    }

    // Board tombstones (#279). Deleting a Board stops removing its row and stamps `deleted_at`
    // instead, so Ride History outlives the Board that produced it (ADR 0027). Additive: existing
    // rows stay null, i.e. alive.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_40_41`
    migrator.registerMigration("v41_board_deleted_at") { db in
      let hasDeletedAt = try db.columns(in: "boards").contains { $0.name == "deleted_at" }
      if !hasDeletedAt {
        try db.execute(sql: "ALTER TABLE boards ADD COLUMN deleted_at INTEGER")
      }
    }

    // Telemetry keys on the Board id (#280, ADR 0028). `telemetry_frames` and
    // `telemetry_minute_buckets` gain `board_id` and lose `device_id` (the BLE identifier) and
    // `device_name` (the Board name denormalized at capture time); Ride History resolves the name
    // by looking the Board up instead.
    //
    // Both tables are rebuilt rather than altered: the bucket primary key moves to
    // `(bucket_start_ms, board_id)`, and the rebuild is what drops the two retired columns.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_41_42`
    migrator.registerMigration("v42_telemetry_board_id") { db in
      try mintOrphanBoards(db)
      try buildDeviceBoardMap(db)
      try rebuildFramesOnBoardId(db)
      try rebuildBucketsOnBoardId(db)
      try rebuildMarkersOnBoardId(db)
      try rebuildDiagnosticEventsOnBoardId(db)
      try rebuildExclusionRangesOnBoardId(db)
      try db.execute(sql: "DROP TABLE IF EXISTS \(DEVICE_BOARD_MAP)")
    }

    // Ride Track becomes the durable home for ride position (#448, ADR 0038). GPS stops being seven
    // nullable columns on the telemetry row and gets its own table on its own clock, so a board
    // dropout no longer erases the route; Ride Recordings gain durable identity and explicit
    // boundaries, held apart from the Board they belong to.
    //
    // The existing values are moved, not dropped — the frames' own `board_id` is the attribution,
    // already resolved once by the board-id migration, so this migration never re-decides who owns
    // a row. Rides recorded before today gain no new points: their tracks come out exactly as
    // sparse as their telemetry was. Legacy rows get no recording identity either;
    // `rideSplitGapMinutes` still groups them.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `MIGRATION_42_43`
    migrator.registerMigration("v43_ride_track") { db in
      try createRideRecordingTables(db)
      try migrateFrameGpsIntoRideTrack(db)
      try rebuildFramesWithoutGps(db)
      try rebuildBucketsOnRecordingId(db)
    }

    return migrator
  }
}

/// Stand-in Board id for buckets whose samples match no saved Board. `board_id` is part of the
/// bucket primary key, so unattributed rows need a value rather than null.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `UNKNOWN_TELEMETRY_BOARD_ID`
internal let UNKNOWN_TELEMETRY_BOARD_ID = ""
internal let UNKNOWN_TELEMETRY_BOARD_NAME = "VESC Board"

/// Id prefix for the tombstoned Boards the board-id migration mints for telemetry whose BLE
/// identifier resolves to nothing. Derived from the identifier rather than random so the mint is
/// idempotent.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `ORPHAN_BOARD_ID_PREFIX`
internal let ORPHAN_BOARD_ID_PREFIX = "orphan-"

/// Telemetry whose `device_id` matches no Board would lose both its identity and its label: either
/// the Board was hard-deleted before tombstones existed (ADR 0027), or it was re-linked to a
/// different peripheral and the old identifier no longer resolves. One tombstoned Board is minted
/// per unresolved identifier, named from that telemetry's own historical `device_name`, so the
/// history stays joinable, keeps a label, and can be backed up.
///
/// The minted row is a tombstone with no Board Link: `deleted_at` keeps it out of every
/// Rider-facing list, and a null `ble_id` stops it from ever capturing a future re-link.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `mintOrphanBoards`
internal func mintOrphanBoards(_ db: Database) throws {
  let now = telemetryNowMs()
  for (table, timeColumn) in telemetryTablesKeyedOnDeviceId {
    // Metric Exclusion Ranges never carried a `device_name`, so there is nothing to name a Board
    // after there — a range on an identifier no other table saw falls back to the generic name.
    let historicalName =
      table == "metric_exclusion_ranges"
        ? "NULL"
        : """
          (SELECT n.device_name FROM \(table) n WHERE n.device_id = t.device_id \
          AND n.device_name IS NOT NULL ORDER BY n.\(timeColumn) DESC LIMIT 1)
          """
    try db.execute(
      sql: """
        INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at)
        SELECT
          ? || t.device_id,
          COALESCE(\(historicalName), ?),
          NULL,
          MIN(t.\(timeColumn)),
          ?
        FROM \(table) t
        WHERE t.device_id IS NOT NULL
          AND t.device_id != ''
          AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.ble_id = t.device_id)
        GROUP BY t.device_id
        """,
      arguments: [ORPHAN_BOARD_ID_PREFIX, UNKNOWN_TELEMETRY_BOARD_NAME, now]
    )
  }
}

/// Every table the board-id migration moves off the BLE identifier, with the time column its rows
/// are ordered by. All five are minted for and rebuilt together: a Board minted from one table's
/// identifiers has to exist before any other table resolves the same identifier, or the two
/// disagree about who owns the history — the defect this migration exists to remove.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `TELEMETRY_TABLES_KEYED_ON_DEVICE_ID`
private let telemetryTablesKeyedOnDeviceId = [
  ("telemetry_frames", "captured_at_ms"),
  ("telemetry_minute_buckets", "bucket_start_ms"),
  ("telemetry_markers", "occurred_at_ms"),
  ("diagnostic_events", "occurred_at_ms"),
  ("metric_exclusion_ranges", "start_ms"),
]

/// Scratch table holding the board-id migration's one and only BLE identifier → Board decision.
/// Temp, so it belongs to the connection and never reaches the durable schema.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `DEVICE_BOARD_MAP`
private let DEVICE_BOARD_MAP = "telemetry_device_board_map"

/// One BLE identifier can be claimed by more than one Board — the same peripheral linked twice,
/// which the app supports and a Rider produces by pairing a board they already own a second time.
/// Telemetry predating this migration recorded only the identifier, so for such rows there is no
/// evidence of which of those Boards was connected, and no rule can recover it.
///
/// What must not happen is the two rebuilds disagreeing. Resolved independently, each
/// `SELECT … LIMIT 1` is free to return a different Board for the same identifier, and then the
/// frames of a ride sit under one Board while its buckets sit under another: History lists the ride
/// from the buckets and finds no frames for it, so stats render over an empty route.
///
/// So the choice is made exactly once, here, and both rebuilds read it. `MIN(b.id)` is an arbitrary
/// but stable pick among the claimants — arbitrary because the information to do better does not
/// exist, stable because re-running the migration reaches the same answer. Deliberately not left
/// unattributed: an unowned row is never uploaded and is pruned on age, so "unknown" would quietly
/// destroy the history a merely mis-labelled ride keeps intact.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `buildDeviceBoardMap`
internal func buildDeviceBoardMap(_ db: Database) throws {
  try db.execute(sql: """
    CREATE TEMP TABLE \(DEVICE_BOARD_MAP) (
      device_id TEXT PRIMARY KEY NOT NULL,
      board_id TEXT NOT NULL
    )
    """)
  try db.execute(sql: """
    INSERT INTO \(DEVICE_BOARD_MAP) (device_id, board_id)
    SELECT b.ble_id, MIN(b.id)
    FROM boards b
    WHERE b.ble_id IS NOT NULL AND b.ble_id != ''
    GROUP BY b.ble_id
    """)
}

/// Resolves a telemetry row's `device_id` to a Board id: the Board `buildDeviceBoardMap` chose for
/// the identifier, otherwise the tombstone minted for it. A row that never carried an identifier
/// stays unattributed — `unattributed` is NULL for frames and the sentinel for buckets, whose
/// column is part of the primary key.
///
/// The lookup hits a primary key holding one row per identifier, so unlike a scan over `boards` it
/// cannot resolve the same identifier two ways in two statements.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `boardIdFromDeviceId`
private func boardIdFromDeviceId(_ alias: String, unattributed: String) -> String {
  """
  CASE
    WHEN \(alias).device_id IS NULL OR \(alias).device_id = '' THEN \(unattributed)
    ELSE COALESCE(
      (SELECT m.board_id FROM \(DEVICE_BOARD_MAP) m WHERE m.device_id = \(alias).device_id),
      '\(ORPHAN_BOARD_ID_PREFIX)' || \(alias).device_id
    )
  END
  """
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildFramesOnBoardId`
private func rebuildFramesOnBoardId(_ db: Database) throws {
  let columns = """
    captured_at_ms, elapsed_realtime_ms, can_id, flags, changed_mask_1, changed_mask_2, \
    speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, duty_permille, \
    pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state, \
    switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c, \
    latitude_e7, longitude_e7, gps_speed_centi_mps, bearing_centi_deg, accuracy_cm, \
    altitude_cm, location_timestamp_ms
    """
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_device_id_captured_at_ms")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: """
    INSERT INTO telemetry_frames_new (id, board_id, \(columns))
    SELECT f.id, \(boardIdFromDeviceId("f", unattributed: "NULL")), \(columns)
    FROM telemetry_frames f
    """)
  try db.execute(sql: "DROP TABLE telemetry_frames")
  try db.execute(sql: "ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
  try db.execute(sql: """
    CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms
    ON telemetry_frames(captured_at_ms)
    """)
  try db.execute(sql: """
    CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms
    ON telemetry_frames(board_id, captured_at_ms)
    """)
}

/// The primary key move from `(bucket_start_ms, device_id)` to `(bucket_start_ms, board_id)` is a
/// table rebuild, not an `ALTER`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildBucketsOnBoardId`
private func rebuildBucketsOnBoardId(_ db: Database) throws {
  let columns = """
    bucket_start_ms, sample_count, first_sample_at_ms, last_sample_at_ms, \
    sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh, \
    max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma, \
    max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, \
    max_duty_abs_permille, first_odometer_cm, last_odometer_cm, gps_point_count, \
    precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c, \
    max_temp_motor_deci_c, first_latitude_e7, first_longitude_e7, first_moving_at_ms, \
    last_moving_at_ms
    """
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
  try db.execute(sql: """
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
    """)
  // Grouped rather than copied row-for-row so the rebuild is total. A `board_id` collision on the
  // new key needs two identifiers resolving to one Board inside one minute, which the resolver
  // cannot produce — the map is keyed on the identifier and a Board carries one — but an ungrouped
  // copy would abort the whole migration on a constraint error if it ever did, stranding the
  // database mid-upgrade. The fold sums the additive lanes and takes the extreme of the peaks, as
  // an upsert merge would.
  try db.execute(sql: """
    INSERT INTO telemetry_minute_buckets_new (board_id, \(columns))
    SELECT
      \(boardIdFromDeviceId("b", unattributed: "''")) AS board_id,
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
    """)
  try db.execute(sql: "DROP TABLE telemetry_minute_buckets")
  try db.execute(sql: "ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
  try db.execute(sql: """
    CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms
    ON telemetry_minute_buckets(bucket_start_ms)
    """)
}

/// A Marker notes something that happened while recording — a gap, a resume. It belongs to the
/// Board it happened on, and `board_id` stays nullable because a Marker can be written with no
/// Board connected. `device_name` goes with the identifier: the Board holds that text once.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildMarkersOnBoardId`
private func rebuildMarkersOnBoardId(_ db: Database) throws {
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_markers_occurred_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_markers_device_id_occurred_at_ms")
  try db.execute(sql: """
    CREATE TABLE telemetry_markers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      elapsed_realtime_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      board_id TEXT,
      message TEXT,
      gap_ms INTEGER
    )
    """)
  try db.execute(sql: """
    INSERT INTO telemetry_markers_new
      (id, occurred_at_ms, elapsed_realtime_ms, type, board_id, message, gap_ms)
    SELECT
      m.id, m.occurred_at_ms, m.elapsed_realtime_ms, m.type,
      \(boardIdFromDeviceId("m", unattributed: "NULL")),
      m.message, m.gap_ms
    FROM telemetry_markers m
    """)
  try db.execute(sql: "DROP TABLE telemetry_markers")
  try db.execute(sql: "ALTER TABLE telemetry_markers_new RENAME TO telemetry_markers")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_markers_occurred_at_ms ON telemetry_markers(occurred_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_markers_board_id_occurred_at_ms ON telemetry_markers(board_id, occurred_at_ms)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildDiagnosticEventsOnBoardId`
private func rebuildDiagnosticEventsOnBoardId(_ db: Database) throws {
  try db.execute(sql: "DROP INDEX IF EXISTS index_diagnostic_events_occurred_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_diagnostic_events_event_name")
  try db.execute(sql: "DROP INDEX IF EXISTS index_diagnostic_events_device_id_occurred_at_ms")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: """
    INSERT INTO diagnostic_events_new
      (id, occurred_at_ms, elapsed_realtime_ms, event_name, operation, phase, board_id,
       message, properties_json)
    SELECT
      e.id, e.occurred_at_ms, e.elapsed_realtime_ms, e.event_name, e.operation, e.phase,
      \(boardIdFromDeviceId("e", unattributed: "NULL")),
      e.message, e.properties_json
    FROM diagnostic_events e
    """)
  try db.execute(sql: "DROP TABLE diagnostic_events")
  try db.execute(sql: "ALTER TABLE diagnostic_events_new RENAME TO diagnostic_events")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_diagnostic_events_occurred_at_ms ON diagnostic_events(occurred_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_diagnostic_events_event_name ON diagnostic_events(event_name)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_diagnostic_events_board_id_occurred_at_ms ON diagnostic_events(board_id, occurred_at_ms)")
}

/// A Metric Exclusion Range is a span of *one Board's* samples the app decided not to count, so
/// unlike a Marker it has no meaning without one: `board_id` is NOT NULL, as `device_id` was. A row
/// that never named a device takes the same unattributed sentinel a bucket does — the column is NOT
/// NULL on both, so one sentinel across the two keeps "no Board" a single idea.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildExclusionRangesOnBoardId`
private func rebuildExclusionRangesOnBoardId(_ db: Database) throws {
  try db.execute(sql: "DROP INDEX IF EXISTS index_metric_exclusion_ranges_start_ms_end_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_metric_exclusion_ranges_device_id_start_ms_end_ms")
  try db.execute(sql: """
    CREATE TABLE metric_exclusion_ranges_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      board_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      sample_count INTEGER NOT NULL
    )
    """)
  try db.execute(sql: """
    INSERT INTO metric_exclusion_ranges_new
      (id, board_id, reason, start_ms, end_ms, sample_count)
    SELECT
      r.id, \(boardIdFromDeviceId("r", unattributed: "''")), r.reason, r.start_ms, r.end_ms,
      r.sample_count
    FROM metric_exclusion_ranges r
    """)
  try db.execute(sql: "DROP TABLE metric_exclusion_ranges")
  try db.execute(sql: "ALTER TABLE metric_exclusion_ranges_new RENAME TO metric_exclusion_ranges")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_start_ms_end_ms ON metric_exclusion_ranges(start_ms, end_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_board_id_start_ms_end_ms ON metric_exclusion_ranges(board_id, start_ms, end_ms)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `createRideRecordingTables`
internal func createRideRecordingTables(_ db: Database) throws {
  try db.execute(sql: """
    CREATE TABLE IF NOT EXISTS ride_recordings (
      id TEXT NOT NULL PRIMARY KEY,
      board_id TEXT,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      ended_reason TEXT
    )
    """)
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_recordings_started_at_ms ON ride_recordings(started_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_recordings_board_id_started_at_ms ON ride_recordings(board_id, started_at_ms)")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_track_points_fix_at_ms ON ride_track_points(fix_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_track_points_board_id_fix_at_ms ON ride_track_points(board_id, fix_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_track_points_recording_id_fix_at_ms ON ride_track_points(recording_id, fix_at_ms)")
}

/// Every frame that carried a fix becomes a Ride Track point. `location_timestamp_ms` is the GPS
/// clock and is preferred over the frame's capture time, which is the clock the fix was merely
/// stamped onto. A frame with no coordinates contributes nothing — a ride recorded without GPS
/// migrates to an empty track, not to fabricated points.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `migrateFrameGpsIntoRideTrack`
internal func migrateFrameGpsIntoRideTrack(_ db: Database) throws {
  try db.execute(sql: """
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
    """)
}

/// Drops the seven raw GPS columns and adds `recording_id`. A rebuild rather than an `ALTER`, which
/// keeps the two platforms' migrations shaped the same way.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildFramesWithoutGps`
internal func rebuildFramesWithoutGps(_ db: Database) throws {
  let columns = """
    captured_at_ms, elapsed_realtime_ms, board_id, can_id, flags, changed_mask_1, changed_mask_2, \
    speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, duty_permille, \
    pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state, \
    switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c
    """
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_board_id_captured_at_ms")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: """
    INSERT INTO telemetry_frames_new (id, recording_id, \(columns))
    SELECT f.id, NULL, \(columns)
    FROM telemetry_frames f
    """)
  try db.execute(sql: "DROP TABLE telemetry_frames")
  try db.execute(sql: "ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms ON telemetry_frames(board_id, captured_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_frames_recording_id_captured_at_ms ON telemetry_frames(recording_id, captured_at_ms)")
}

/// The bucket primary key gains `recording_id`, so two recordings of one Board inside one minute
/// stop aggregating into a single row. Existing buckets take `LEGACY_RIDE_RECORDING_ID` and keep
/// grouping exactly as they did.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `rebuildBucketsOnRecordingId`
internal func rebuildBucketsOnRecordingId(_ db: Database) throws {
  let columns = """
    bucket_start_ms, board_id, sample_count, first_sample_at_ms, last_sample_at_ms, \
    sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh, \
    max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma, \
    max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, \
    max_duty_abs_permille, first_odometer_cm, last_odometer_cm, gps_point_count, \
    precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c, \
    max_temp_motor_deci_c, first_latitude_e7, first_longitude_e7, first_moving_at_ms, \
    last_moving_at_ms
    """
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: """
    INSERT INTO telemetry_minute_buckets_new (\(columns), recording_id)
    SELECT \(columns), ''
    FROM telemetry_minute_buckets
    """)
  try db.execute(sql: "DROP TABLE telemetry_minute_buckets")
  try db.execute(sql: "ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")
}
