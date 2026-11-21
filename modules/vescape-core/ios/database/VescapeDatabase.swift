import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt
/// @platform-diff iOS is greenfield, so the schema starts at a single `v1` migration that creates
/// the final table shapes directly instead of replaying Android's incremental Room migrations. The
/// telemetry tables are created schema-only here; their writers land in later slices (#60/#61/#63).
enum VescapeDatabase {
  private static let databaseName = "vescape.db"
  private static let legacyDatabaseName = "telemetry.db"

  private static var reopened: DatabasePool?

  private static let poolResult: Result<DatabasePool, Error> = {
    do {
      guard let url = databaseURL else { throw CocoaError(.fileNoSuchFile) }
      try migrateLegacyDatabaseFile(to: url)
      let pool = try DatabasePool(path: url.path)
      try migrator.migrate(pool)
      return .success(pool)
    } catch {
      return .failure(error)
    }
  }()

  static var pool: DatabasePool? {
    if let reopened { return reopened }
    if case let .success(pool) = poolResult { return pool }
    return nil
  }

  static func requirePool() throws -> DatabasePool {
    if let reopened { return reopened }
    return try poolResult.get()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `migrateLegacyDatabaseFile`
  internal static func migrateLegacyDatabaseFile(to url: URL) throws {
    let fm = FileManager.default
    let legacy = url.deletingLastPathComponent().appendingPathComponent(legacyDatabaseName)
    guard !fm.fileExists(atPath: url.path), fm.fileExists(atPath: legacy.path) else { return }
    let legacyPool = try DatabasePool(path: legacy.path)
    try legacyPool.writeWithoutTransaction { db in try db.checkpoint(.truncate) }
    try legacyPool.close()
    try moveLegacyDatabaseFile(from: legacy, to: url)
    for suffix in ["-wal", "-shm"] where fm.fileExists(atPath: legacy.path + suffix) {
      // intentional-suppression: obsolete sidecar cleanup is best effort and support-directory absence is explicit
      try? fm.removeItem(atPath: legacy.path + suffix)
    }
  }

  internal static func moveLegacyDatabaseFile(from legacy: URL, to target: URL) throws {
    try FileManager.default.moveItem(at: legacy, to: target)
  }

  static var databaseURL: URL? {
    // intentional-suppression: obsolete sidecar cleanup is best effort and support-directory absence is explicit
    guard let support = try? FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ) else { return nil }
    return support.appendingPathComponent(databaseName)
  }

  static func databaseSizeBytes(
    at url: URL? = databaseURL,
    attributes: (String) throws -> [FileAttributeKey: Any] = {
      try FileManager.default.attributesOfItem(atPath: $0)
    }
  ) throws -> Int64 {
    guard let url else { throw CocoaError(.fileNoSuchFile) }
    let attrs: [FileAttributeKey: Any]
    do { attrs = try attributes(url.path) }
    catch let error as NSError
      where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError
    { return 0 }
    guard let size = attrs[.size] as? NSNumber else { throw CocoaError(.fileReadUnknown) }
    return size.int64Value
  }

  private static let migrationLedgerTable = "grdb_migrations"

  private static func roomVersion(of identifier: String) -> Int {
    Int(identifier.dropFirst().prefix { $0.isNumber }) ?? Int.max
  }

  internal static func stampAppliedMigrations(_ db: Database, schemaVersion: Int) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS \(migrationLedgerTable) (identifier TEXT NOT NULL PRIMARY KEY)")
    for identifier in migrator.migrations where roomVersion(of: identifier) <= schemaVersion {
      try db.execute(
        sql: "INSERT OR IGNORE INTO \(migrationLedgerTable) (identifier) VALUES (?)",
        arguments: [identifier]
      )
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_14_15` through `MIGRATION_21_22`
  internal static func upgradeExportedAndroidDatabase(_ db: Database, from version: Int) throws {
    guard version < 22 else { return }
    guard version >= 14 else {
      throw NSError(
        domain: "VescapeDatabaseMigration",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Android backup predates backup export support"]
      )
    }

    if version < 15 {
      try db.execute(sql: """
        CREATE TABLE IF NOT EXISTS metric_exclusions (
          captured_at_ms INTEGER NOT NULL, device_id TEXT NOT NULL, metric TEXT NOT NULL,
          reason TEXT NOT NULL, PRIMARY KEY(captured_at_ms, device_id, metric)
        )
        """)
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusions_captured_at_ms ON metric_exclusions(captured_at_ms)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusions_device_id_captured_at_ms ON metric_exclusions(device_id, captured_at_ms)")
    }
    if version < 16 {
      try db.execute(sql: "ALTER TABLE metric_exclusions ADD COLUMN raw_value TEXT")
      try db.execute(sql: "ALTER TABLE metric_exclusions ADD COLUMN reference_value TEXT")
      try db.execute(sql: "ALTER TABLE metric_exclusions ADD COLUMN context_json TEXT")
    }
    if version < 17 {
      try db.execute(sql: "DROP TABLE IF EXISTS metric_exclusions")
      try db.execute(sql: """
        CREATE TABLE IF NOT EXISTS metric_exclusion_ranges (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, device_id TEXT NOT NULL,
          reason TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
          sample_count INTEGER NOT NULL
        )
        """)
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_start_ms_end_ms ON metric_exclusion_ranges(start_ms, end_ms)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_metric_exclusion_ranges_device_id_start_ms_end_ms ON metric_exclusion_ranges(device_id, start_ms, end_ms)")
    }
    if version < 18 {
      try db.execute(sql: """
        CREATE TABLE IF NOT EXISTS privacy_zones (
          id TEXT NOT NULL PRIMARY KEY, preset TEXT NOT NULL, name TEXT NOT NULL,
          enabled INTEGER NOT NULL, center_latitude_e7 INTEGER NOT NULL,
          center_longitude_e7 INTEGER NOT NULL, radius_meters INTEGER NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )
        """)
    }
    if version < 19 {
      try db.execute(sql: "DROP INDEX IF EXISTS index_boards_created_at")
      try db.execute(sql: "DROP INDEX IF EXISTS index_boards_is_starred")
      try db.execute(sql: """
        CREATE TABLE boards_v19 (
          id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, description TEXT, ble_id TEXT,
          is_starred INTEGER NOT NULL, created_at INTEGER NOT NULL, battery_config_json TEXT
        )
        """)
      try db.execute(sql: "INSERT INTO boards_v19 SELECT id,name,description,ble_id,is_starred,created_at,NULL FROM boards")
      try db.execute(sql: "DROP TABLE boards")
      try db.execute(sql: "ALTER TABLE boards_v19 RENAME TO boards")
      try db.execute(sql: "CREATE INDEX index_boards_created_at ON boards(created_at)")
      try db.execute(sql: "CREATE INDEX index_boards_is_starred ON boards(is_starred)")
    }
    if version < 20 {
      try db.execute(sql: """
        CREATE TABLE IF NOT EXISTS map_points (
          id TEXT NOT NULL PRIMARY KEY, kind TEXT NOT NULL, latitude_e7 INTEGER NOT NULL,
          longitude_e7 INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )
        """)
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_map_points_kind ON map_points(kind)")
    }
    if version < 21 {
      try db.execute(sql: """
        CREATE TABLE IF NOT EXISTS board_settings (
          board_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL, PRIMARY KEY(board_id,key)
        )
        """)
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_board_settings_board_id ON board_settings(board_id)")
      try db.execute(sql: "INSERT OR REPLACE INTO board_settings SELECT id,'description',json_quote(description),created_at FROM boards WHERE description IS NOT NULL")
      try db.execute(sql: "INSERT OR REPLACE INTO board_settings SELECT id,'batteryConfig',battery_config_json,created_at FROM boards WHERE battery_config_json IS NOT NULL")
      try db.execute(sql: "DROP INDEX IF EXISTS index_boards_is_starred")
      try db.execute(sql: "DROP INDEX IF EXISTS index_boards_created_at")
      try db.execute(sql: "CREATE TABLE boards_v21 (id TEXT NOT NULL PRIMARY KEY,name TEXT NOT NULL,ble_id TEXT,created_at INTEGER NOT NULL)")
      try db.execute(sql: "INSERT INTO boards_v21 SELECT id,name,ble_id,created_at FROM boards")
      try db.execute(sql: "DROP TABLE boards")
      try db.execute(sql: "ALTER TABLE boards_v21 RENAME TO boards")
      try db.execute(sql: "CREATE INDEX index_boards_created_at ON boards(created_at)")
    }
    if version < 22 {
      try db.execute(sql: "ALTER TABLE telemetry_minute_buckets ADD COLUMN first_moving_at_ms INTEGER")
      try db.execute(sql: "ALTER TABLE telemetry_minute_buckets ADD COLUMN last_moving_at_ms INTEGER")
    }
    try db.execute(sql: "PRAGMA user_version = 22")
  }

  static func replaceDatabase(withFileAt source: URL, schemaVersion: Int, afterInstall: (DatabasePool) throws -> Void = { _ in }) throws {
    guard let target = databaseURL else { throw CocoaError(.fileNoSuchFile) }
    do {
      if let reopened { try reopened.close() }
      else if case let .success(pool) = poolResult { try pool.close() }
      reopened = try replacingDatabaseFiles(source: source, target: target) { installed in
        let restored = try openRestoredDatabase(at: installed, schemaVersion: schemaVersion)
        do {
          try afterInstall(restored)
          return restored
        } catch {
          try restored.close()
          throw error
        }
      }
    } catch {
      let restoreError = error
      do {
        reopened = try DatabasePool(path: target.path)
        try reopened?.read { db in _ = try Int.fetchOne(db, sql: "SELECT 1") }
      } catch {
        throw NSError(
          domain: "VescapeDatabaseSwap",
          code: 3,
          userInfo: [
            NSLocalizedDescriptionKey: "Database restore failed and the original database could not be reopened",
            NSUnderlyingErrorKey: restoreError,
            "reopenError": String(describing: error),
          ]
        )
      }
      throw restoreError
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseUpgradeContract.kt `prepareRestoredDatabase`
  internal static func openRestoredDatabase(at url: URL, schemaVersion: Int) throws -> DatabasePool {
    let pool = try DatabasePool(path: url.path)
    try pool.write { db in
      guard try !db.tableExists(migrationLedgerTable) else { return }
      try upgradeExportedAndroidDatabase(db, from: schemaVersion)
      try stampAppliedMigrations(db, schemaVersion: max(schemaVersion, 22))
    }
    try migrator.migrate(pool)
    try pool.write { db in
      try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
      for table in try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type='table'") where isUnknownTable(table) {
        try db.execute(sql: "DROP TABLE `\(table)`")
      }
      try forgetTelemetryStorage(db)
    }
    return pool
  }

  internal static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()

    migrator.registerMigration("v1") { db in

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

    migrator.registerMigration("v2_tune_profiles") { db in
      try PersistenceSchema.createTuneProfiles(db)
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

    migrator.registerMigration("v25_board_warnings") { db in
      try PersistenceSchema.createBoardWarnings(db)
    }

    migrator.registerMigration("v26_alert_source") { db in
      let hasSource = try db.columns(in: "alerts").contains { $0.name == "source" }
      if !hasSource {
        try db.execute(sql: "ALTER TABLE alerts ADD COLUMN source TEXT")
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_26_27`
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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_28_29`
    migrator.registerMigration("v29_drop_map_points") { db in
      try db.execute(sql: "DROP TABLE IF EXISTS map_point_reactions")
      try db.execute(sql: "DROP TABLE IF EXISTS map_points")
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_29_30`
    migrator.registerMigration("v30_favorites") { db in
      try PersistenceSchema.createFavorites(db)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_30_31`
    migrator.registerMigration("v31_favorite_media") { db in
      try PersistenceSchema.createFavoriteMedia(db)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_31_32`
    migrator.registerMigration("v32_alert_repeat") { db in
      let columns = try db.columns(in: "alerts").map(\.name)
      if !columns.contains("repeat_every_seconds") {
        try db.execute(sql: "ALTER TABLE alerts ADD COLUMN repeat_every_seconds INTEGER")
      }
      if !columns.contains("beep_count") {
        try db.execute(
          sql: "ALTER TABLE alerts ADD COLUMN beep_count INTEGER NOT NULL DEFAULT 3"
        )
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_32_33`
    migrator.registerMigration("v33_board_config_values") { db in
      try PersistenceSchema.createBoardConfig(db)
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
      try PersistenceSchema.createMotorConfig(db)
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_36_40`
    migrator.registerMigration("v40_vesc_faults") { db in
      try PersistenceSchema.createVescFaults(db)
      try PersistenceSchema.createVescFaultCaptures(db)
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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_40_41`
    migrator.registerMigration("v41_board_deleted_at") { db in
      let hasDeletedAt = try db.columns(in: "boards").contains { $0.name == "deleted_at" }
      if !hasDeletedAt {
        try db.execute(sql: "ALTER TABLE boards ADD COLUMN deleted_at INTEGER")
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDatabase.kt `MIGRATION_41_42`
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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_42_43`
    migrator.registerMigration("v43_ride_track") { db in
      try createRideRecordingTables(db)
      try migrateFrameGpsIntoRideTrack(db)
      try rebuildFramesWithoutGps(db)
      try rebuildBucketsOnRecordingId(db)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_43_44`
    migrator.registerMigration("v44_accessories") { db in
      try PersistenceSchema.createAccessories(db)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_44_45`
    migrator.registerMigration("v45_accessory_ground_clearance") { db in
      try PersistenceSchema.createAccessoryGroundClearance(db)
    }

    migrator.registerMigration("v46_accessory_brake_light") { db in
      try PersistenceSchema.createAccessoryBrakeLight(db)
    }
    migrator.registerMigration("v47_accessory_capability_settings") { db in
      try PersistenceSchema.createAccessoryCapabilitySettings(db)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_47_48`
    migrator.registerMigration("v48_accessory_sampling_rate") { db in
      try db.execute(sql: "ALTER TABLE accessory_capability_settings ADD COLUMN sampling_rate_hz REAL")
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_48_49`
    migrator.registerMigration("v49_bucket_route_preview") { db in
      try db.execute(sql: "ALTER TABLE telemetry_minute_buckets ADD COLUMN route_preview TEXT")
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_49_50`
    migrator.registerMigration("v50_alert_sound_count") { db in
      try db.execute(sql: alertSoundCountSql)
      try db.execute(sql: """
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
        """)
      try db.execute(sql: """
        INSERT INTO alerts_new (board_id, id, control_id, threshold, threshold_max, enabled, sound_type,
          created_at, source, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
          threshold_max_offset)
        SELECT board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at,
          source, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
          threshold_max_offset
        FROM alerts
        """)
      try db.execute(sql: "DROP TABLE alerts")
      try db.execute(sql: "ALTER TABLE alerts_new RENAME TO alerts")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_board_id ON alerts(board_id)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_control_id ON alerts(control_id)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_enabled ON alerts(enabled)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_created_at ON alerts(created_at)")
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_50_51`
    migrator.registerMigration("v51_preset_rows") { db in
      try db.execute(sql: """
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
        """)
      try db.execute(sql: """
        INSERT INTO alerts_new (board_id, id, control_id, threshold, threshold_max, enabled, spec,
          created_at, repeat_every_seconds, threshold_kind, config_field_id, threshold_offset,
          threshold_max_offset)
        SELECT board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at,
          repeat_every_seconds, threshold_kind, config_field_id, threshold_offset, threshold_max_offset
        FROM alerts WHERE source IS NULL OR source != 'preset'
        """)
      try db.execute(sql: presetRowsSql)
      try db.execute(sql: "DROP TABLE alerts")
      try db.execute(sql: "ALTER TABLE alerts_new RENAME TO alerts")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_board_id ON alerts(board_id)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_control_id ON alerts(control_id)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_enabled ON alerts(enabled)")
      try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_alerts_created_at ON alerts(created_at)")
      try db.execute(sql: "DELETE FROM board_settings WHERE key IN ('alertPreset', 'matchBoardConfig', 'alertPresetSound')")
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_51_52`
    migrator.registerMigration("v52_drop_ride_recordings") { db in
      try db.execute(sql: "UPDATE ride_track_points SET accuracy_cm = 2000 WHERE recording_id IS NULL AND accuracy_cm IS NULL")
      try rebuildRideTrackWithoutRecordingId(db)
      try rebuildFramesWithoutRecordingId(db)
      try foldBucketsWithoutRecordingId(db)
      try db.execute(sql: "DROP TABLE IF EXISTS ride_recordings")
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_52_53`
    migrator.registerMigration("v53_weather_observations") { db in
      try PersistenceSchema.createWeatherObservations(db)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_53_54`
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseUpgradeContract.kt `iosSchemaReconciliationStatements`
    migrator.registerMigration("v54_shared_schema") { db in
      if try db.columns(in: "boards").contains(where: { $0.name == "transport" }) {
        try db.execute(sql: "INSERT OR REPLACE INTO board_settings (board_id, key, value_json, updated_at) SELECT id, 'transport', json_quote(transport), created_at FROM boards WHERE transport IS NOT NULL AND deleted_at IS NULL")
        try db.execute(sql: "CREATE TABLE boards_v54 (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, ble_id TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER)")
        try db.execute(sql: "INSERT INTO boards_v54 (id, name, ble_id, created_at, deleted_at) SELECT id, name, ble_id, created_at, deleted_at FROM boards")
        try db.execute(sql: "DROP TABLE boards")
        try db.execute(sql: "ALTER TABLE boards_v54 RENAME TO boards")
        try db.execute(sql: "CREATE INDEX index_boards_created_at ON boards(created_at)")
      }
      let nullableSampleId = try Bool.fetchOne(db, sql: "SELECT \"notnull\" = 0 FROM pragma_table_info('vesc_fault_capture_samples') WHERE name = 'id'") ?? false
      if nullableSampleId {
        try db.execute(sql: "DROP INDEX IF EXISTS index_vesc_fault_capture_samples_occurrence_id_captured_at")
        try db.execute(sql: "ALTER TABLE vesc_fault_capture_samples RENAME TO vesc_fault_capture_samples_v54")
        try PersistenceSchema.createVescFaultCaptures(db)
        try db.execute(sql: "INSERT INTO vesc_fault_capture_samples SELECT * FROM vesc_fault_capture_samples_v54")
        try db.execute(sql: "DROP TABLE vesc_fault_capture_samples_v54")
      }
      for sql in sharedSchemaV54Sql { try db.execute(sql: sql) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_54_55`
    migrator.registerMigration("v55_board_key") { db in
      guard try !db.columns(in: "boards").contains(where: { $0.name == "key" }) else { return }
      for sql in boardKeyV55Sql { try db.execute(sql: sql) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `MIGRATION_55_56`
    migrator.registerMigration("v56_telemetry_chunks") { db in
      for sql in telemetryChunksV56Sql { try db.execute(sql: sql) }
    }

    return migrator
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `TELEMETRY_CHUNKS_V56_SQL`
  private static let telemetryChunksV56Sql = [
    "CREATE TABLE IF NOT EXISTS telemetry_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, board_key INTEGER, minute_start_ms INTEGER NOT NULL, codec_version INTEGER NOT NULL, sample_count INTEGER NOT NULL, first_at_ms INTEGER NOT NULL, last_at_ms INTEGER NOT NULL, payload BLOB NOT NULL, FOREIGN KEY(board_key) REFERENCES boards(key) ON UPDATE NO ACTION ON DELETE NO ACTION)",
    "CREATE UNIQUE INDEX IF NOT EXISTS index_telemetry_chunks_board_key_minute_start_ms ON telemetry_chunks(board_key, minute_start_ms)",
    "CREATE INDEX IF NOT EXISTS index_telemetry_chunks_minute_start_ms ON telemetry_chunks(minute_start_ms)",
  ]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `BOARD_KEY_V55_SQL`
  private static let boardKeyV55Sql = [
    "DROP INDEX IF EXISTS index_boards_created_at",
    "CREATE TABLE boards_v55 (key INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, ble_id TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER)",
    "INSERT INTO boards_v55 (id, name, ble_id, created_at, deleted_at) SELECT id, name, ble_id, created_at, deleted_at FROM boards ORDER BY created_at, id",
    "DROP TABLE boards",
    "ALTER TABLE boards_v55 RENAME TO boards",
    "CREATE UNIQUE INDEX index_boards_id ON boards(id)",
    "CREATE INDEX index_boards_created_at ON boards(created_at)",
    "INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at) SELECT board_id, '\(UNKNOWN_TELEMETRY_BOARD_NAME)', NULL, MIN(at_ms), MAX(at_ms) FROM (SELECT board_id, fix_at_ms AS at_ms FROM ride_track_points UNION ALL SELECT board_id, captured_at_ms FROM telemetry_frames) WHERE board_id IS NOT NULL AND board_id != '' GROUP BY board_id ORDER BY MIN(at_ms), board_id",
    "DROP INDEX IF EXISTS index_ride_track_points_fix_at_ms",
    "DROP INDEX IF EXISTS index_ride_track_points_board_id_fix_at_ms",
    "CREATE TABLE ride_track_points_v55 (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, board_key INTEGER, fix_at_ms INTEGER NOT NULL, latitude_e7 INTEGER NOT NULL, longitude_e7 INTEGER NOT NULL, accuracy_cm INTEGER, gps_speed_centi_mps INTEGER, bearing_centi_deg INTEGER, altitude_cm INTEGER, FOREIGN KEY(board_key) REFERENCES boards(key) ON UPDATE NO ACTION ON DELETE NO ACTION)",
    "INSERT INTO ride_track_points_v55 (id, board_key, fix_at_ms, latitude_e7, longitude_e7, accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm) SELECT t.id, b.key, t.fix_at_ms, t.latitude_e7, t.longitude_e7, t.accuracy_cm, t.gps_speed_centi_mps, t.bearing_centi_deg, t.altitude_cm FROM ride_track_points t LEFT JOIN boards b ON b.id = t.board_id",
    "DROP TABLE ride_track_points",
    "ALTER TABLE ride_track_points_v55 RENAME TO ride_track_points",
    "CREATE INDEX index_ride_track_points_fix_at_ms ON ride_track_points(fix_at_ms)",
    "CREATE INDEX index_ride_track_points_board_key_fix_at_ms ON ride_track_points(board_key, fix_at_ms)",
  ]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `SHARED_SCHEMA_V54_SQL`
  private static let sharedSchemaV54Sql = [
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
  ]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `PRESET_ROWS_SQL`
  private static let presetRowsSql = """
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
    """

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `ALERT_SOUND_COUNT_SQL`
  private static let alertSoundCountSql = """
    UPDATE alerts SET sound_type = 'alert(' || MAX(1, MIN(5, beep_count)) || '):' ||
      CASE sound_type
        WHEN 'preset:urgent' THEN 'critical' WHEN 'urgent' THEN 'critical'
        WHEN 'preset:notify' THEN 'info' WHEN 'notify' THEN 'info' WHEN 'pulse' THEN 'info'
        ELSE 'warning'
      END
    WHERE sound_type IN ('preset:beep', 'preset:urgent', 'preset:notify', 'default', 'beep', 'urgent', 'notify', 'pulse')
    """
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `UNKNOWN_TELEMETRY_BOARD_ID`
internal let UNKNOWN_TELEMETRY_BOARD_ID = ""
internal let UNKNOWN_TELEMETRY_BOARD_NAME = "VESC Board"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `ORPHAN_BOARD_ID_PREFIX`
internal let ORPHAN_BOARD_ID_PREFIX = "orphan-"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `mintOrphanBoards`
internal func mintOrphanBoards(_ db: Database) throws {
  let now = telemetryNowMs()
  for (table, timeColumn) in telemetryTablesKeyedOnDeviceId {
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `TELEMETRY_TABLES_KEYED_ON_DEVICE_ID`
private let telemetryTablesKeyedOnDeviceId = [
  ("telemetry_frames", "captured_at_ms"),
  ("telemetry_minute_buckets", "bucket_start_ms"),
  ("telemetry_markers", "occurred_at_ms"),
  ("diagnostic_events", "occurred_at_ms"),
  ("metric_exclusion_ranges", "start_ms"),
]

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `DEVICE_BOARD_MAP`
private let DEVICE_BOARD_MAP = "telemetry_device_board_map"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `buildDeviceBoardMap`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `boardIdFromDeviceId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildFramesOnBoardId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildBucketsOnBoardId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildMarkersOnBoardId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildDiagnosticEventsOnBoardId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildExclusionRangesOnBoardId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `createRideRecordingTables`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `migrateFrameGpsIntoRideTrack`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildFramesWithoutGps`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildBucketsOnRecordingId`
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildRideTrackWithoutRecordingId`
private func rebuildRideTrackWithoutRecordingId(_ db: Database) throws {
  let columns = "id, board_id, fix_at_ms, latitude_e7, longitude_e7, accuracy_cm, " +
    "gps_speed_centi_mps, bearing_centi_deg, altitude_cm"
  try db.execute(sql: "DROP INDEX IF EXISTS index_ride_track_points_fix_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_ride_track_points_board_id_fix_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_ride_track_points_recording_id_fix_at_ms")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: "INSERT INTO ride_track_points_new (\(columns)) SELECT \(columns) FROM ride_track_points")
  try db.execute(sql: "DROP TABLE ride_track_points")
  try db.execute(sql: "ALTER TABLE ride_track_points_new RENAME TO ride_track_points")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_track_points_fix_at_ms ON ride_track_points(fix_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_ride_track_points_board_id_fix_at_ms ON ride_track_points(board_id, fix_at_ms)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `rebuildFramesWithoutRecordingId`
private func rebuildFramesWithoutRecordingId(_ db: Database) throws {
  let columns = "id, captured_at_ms, elapsed_realtime_ms, board_id, can_id, flags, changed_mask_1, " +
    "changed_mask_2, speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, " +
    "duty_permille, pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, " +
    "erpm, state, switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c"
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_captured_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_board_id_captured_at_ms")
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_frames_recording_id_captured_at_ms")
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
      temp_motor_deci_c INTEGER
    )
    """)
  try db.execute(sql: "INSERT INTO telemetry_frames_new (\(columns)) SELECT \(columns) FROM telemetry_frames")
  try db.execute(sql: "DROP TABLE telemetry_frames")
  try db.execute(sql: "ALTER TABLE telemetry_frames_new RENAME TO telemetry_frames")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_frames_captured_at_ms ON telemetry_frames(captured_at_ms)")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_frames_board_id_captured_at_ms ON telemetry_frames(board_id, captured_at_ms)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `foldBucketsWithoutRecordingId`
private func foldBucketsWithoutRecordingId(_ db: Database) throws {
  try db.execute(sql: "DROP INDEX IF EXISTS index_telemetry_minute_buckets_bucket_start_ms")
  try db.execute(sql: "ALTER TABLE telemetry_minute_buckets RENAME TO telemetry_minute_buckets_old")
  try db.execute(sql: """
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
    """)
  try db.execute(sql: foldBucketsSql)
  try db.execute(sql: "DROP TABLE telemetry_minute_buckets_old")
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_telemetry_minute_buckets_bucket_start_ms ON telemetry_minute_buckets(bucket_start_ms)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseMigrations.kt `FOLD_BUCKETS_SQL`
private let foldBucketsSql = """
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
  """
