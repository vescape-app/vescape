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
          fault_code INTEGER,
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
        CREATE INDEX index_telemetry_frames_fault
        ON telemetry_frames(captured_at_ms)
        WHERE fault_code IS NOT NULL AND fault_code != 0
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
          fault_count INTEGER NOT NULL,
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

    return migrator
  }
}
