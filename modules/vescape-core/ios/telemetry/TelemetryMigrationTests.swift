import GRDB
import XCTest
@testable import VescapeCore

/// Runs the real `TelemetryDatabase` migrator against an in-memory database. This is the guard every
/// future migration inherits: add a case here rather than shipping a schema change no Swift test has
/// executed.
///
/// `v27_alert_board_id` is the current last migration and the only one with data consequences —
/// Alert Rules become board-owned, pre-release global rules are dropped rather than reassigned, and
/// three former global settings keys are deleted from `app_settings`.
final class TelemetryMigrationTests: XCTestCase {
  private var queue: DatabaseQueue!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  private func migrate(upTo version: String? = nil) throws {
    if let version {
      try TelemetryDatabase.migrator.migrate(queue, upTo: version)
    } else {
      try TelemetryDatabase.migrator.migrate(queue)
    }
  }

  private func columnNames(_ table: String) throws -> [String] {
    try queue.read { db in try db.columns(in: table).map(\.name) }
  }

  private func alertCount() throws -> Int? {
    try queue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM alerts") }
  }

  /// The `v1` baseline already ships the board-owned `alerts` table, so a fresh install never takes
  /// `v27`'s rebuild branch. Recreate the pre-`v27` global shape by hand to exercise it, the way an
  /// install that predates the baseline reaches the migration.
  private func replaceAlertsWithLegacyGlobalTable() throws {
    try queue.write { db in
      try db.execute(sql: "DROP TABLE alerts")
      try db.execute(sql: """
        CREATE TABLE alerts (
          id TEXT NOT NULL PRIMARY KEY,
          control_id TEXT NOT NULL,
          threshold REAL NOT NULL,
          threshold_max REAL,
          enabled INTEGER NOT NULL,
          sound_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          source TEXT
        )
        """)
    }
  }

  private func insertSetting(_ key: String) throws {
    try queue.write { db in
      try db.execute(
        sql: "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
        arguments: [key, "1", 1_000]
      )
    }
  }

  func testEveryMigrationAppliesOnAFreshDatabase() throws {
    try migrate()

    let applied = try queue.read { db in try TelemetryDatabase.migrator.appliedIdentifiers(db) }
    XCTAssertEqual(applied, Set(TelemetryDatabase.migrator.migrations))
  }

  /// The fault migration is the only one that rewrites telemetry tables, so assert both halves:
  /// the fault tables arrive and the legacy per-frame fault storage is gone without losing frames.
  func testFaultMigrationDropsLegacyTelemetryFaultStorageAndKeepsFrames() throws {
    try migrate(upTo: "v36_motor_config_values")
    // iOS is greenfield and never created the fault columns, so the rebuild branch only runs for a
    // restored Room database. Add them by hand to arrive at the migration the way that backup does.
    try queue.write { db in
      try db.execute(sql: """
        ALTER TABLE telemetry_frames ADD COLUMN fault_code INTEGER;
        ALTER TABLE telemetry_minute_buckets ADD COLUMN fault_count INTEGER;
        INSERT INTO telemetry_frames (captured_at_ms, elapsed_realtime_ms, flags, changed_mask_1,
          changed_mask_2, speed_centi_kmh, fault_code)
        VALUES (1000, 5, 0, 0, 0, 2500, 9);
        """)
    }

    try migrate()

    XCTAssertFalse(try columnNames("telemetry_frames").contains("fault_code"))
    XCTAssertFalse(try columnNames("telemetry_minute_buckets").contains("fault_count"))
    let speeds = try queue.read { db in
      try Int.fetchAll(db, sql: "SELECT speed_centi_kmh FROM telemetry_frames")
    }
    XCTAssertEqual(speeds, [2500])
    for table in ["vesc_fault_occurrences", "vesc_fault_captures", "vesc_fault_capture_samples"] {
      XCTAssertTrue(try queue.read { db in try db.tableExists(table) }, "\(table) is missing")
    }
  }

  /// Tables the migrator delegates to a store's `createTables` are the easy ones to leave out of a
  /// fresh install, so assert the schema a clean upgrade actually lands on.
  func testFreshDatabaseHasEveryStoreTable() throws {
    try migrate()

    let tables = [
      "boards", "board_settings", "alerts", "app_settings", "telemetry_frames",
      "telemetry_minute_buckets", "telemetry_markers", "metric_exclusion_ranges",
      "diagnostic_events", "tune_profiles", "tune_history_entries", "board_warnings", "favorites",
      "favorite_media", "vesc_fault_occurrences", "vesc_fault_captures", "vesc_fault_capture_samples",
    ]
    for table in tables {
      XCTAssertTrue(try queue.read { db in try db.tableExists(table) }, "\(table) is missing")
    }
  }

  /// Alert Rules are owned by one Board: `board_id` is part of the primary key so preset ids repeat
  /// per board instead of colliding. Incremental sync keys off this shape.
  func testAlertsAreBoardOwnedAfterEveryMigration() throws {
    try migrate()

    XCTAssertTrue(try columnNames("alerts").contains("board_id"))
    let primaryKey = try queue.read { db in try db.primaryKey("alerts").columns }
    XCTAssertEqual(primaryKey, ["board_id", "id"])
  }

  func testBoardIdMigrationRebuildsLegacyGlobalAlertsAndDropsTheirRows() throws {
    try migrate(upTo: "v26_alert_source")
    try replaceAlertsWithLegacyGlobalTable()
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO alerts (id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source)
          VALUES ('rule-1', 'speed', 30.0, NULL, 1, 'beep', 1000, 'preset')
          """
      )
    }

    try migrate()

    XCTAssertEqual(try columnNames("alerts").first, "board_id")
    // Pre-release decision: global rules are dropped, not reassigned to an arbitrary board.
    XCTAssertEqual(try alertCount(), 0)
  }

  func testBoardIdMigrationDropsTheSettingsThatMovedToBoardSettings() throws {
    try migrate(upTo: "v26_alert_source")
    for key in ["alertPreset", "riderTopSpeedKmh", "alertPresetsOnboarded", "unitSystem"] {
      try insertSetting(key)
    }

    try migrate()

    let keys = try queue.read { db in try String.fetchSet(db, sql: "SELECT key FROM app_settings") }
    XCTAssertEqual(keys, ["unitSystem"])
  }

  /// A rider whose database already has the board-owned table must keep their rules: the migration
  /// must not rebuild the table a second time.
  // MARK: - Restoring a database GRDB has never migrated

  /// An Android backup carries the schema but not GRDB's ledger. Drop it to reproduce that.
  private func dropMigrationLedger() throws {
    try queue.write { db in try db.execute(sql: "DROP TABLE grdb_migrations") }
  }

  private func stamp(schemaVersion: Int) throws {
    try queue.write { db in
      try TelemetryDatabase.stampAppliedMigrations(db, schemaVersion: schemaVersion)
    }
  }

  private func applied() throws -> Set<String> {
    try queue.read { db in try TelemetryDatabase.migrator.appliedIdentifiers(db) }
  }

  /// Restoring an Android backup used to fail outright: no ledger meant `v1` replayed, and
  /// `CREATE TABLE boards` on a database that already has `boards` rolled the whole restore back.
  func testCurrentBackupIsStampedRatherThanReplayed() throws {
    try migrate()
    try dropMigrationLedger()

    try stamp(schemaVersion: TELEMETRY_SCHEMA_VERSION)
    try migrate()

    XCTAssertEqual(try applied(), Set(TelemetryDatabase.migrator.migrations))
  }

  /// A backup from an older build must still get the migrations it is missing — stamping is a claim
  /// about what the incoming schema already has, not a way to skip work.
  func testOlderBackupRunsOnlyTheMigrationsItIsMissing() throws {
    try migrate(upTo: "v25_board_warnings")
    try dropMigrationLedger()

    try stamp(schemaVersion: 25)
    let stamped = try applied()
    XCTAssertTrue(stamped.contains("v25_board_warnings"))
    XCTAssertFalse(stamped.contains("v26_alert_source"))

    try migrate()
    XCTAssertEqual(try applied(), Set(TelemetryDatabase.migrator.migrations))
  }

  /// Android files a Board's proven transport as a `board_settings` row; iOS keeps it as a column on
  /// `boards`. Rebuild the table without it, the way a restored Room database arrives.
  private func replaceBoardsWithAndroidShape() throws {
    try queue.write { db in
      try db.execute(sql: "DROP TABLE boards")
      try db.execute(sql: """
        CREATE TABLE boards (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          ble_id TEXT,
          created_at INTEGER NOT NULL
        )
        """)
      try db.execute(
        sql: "INSERT INTO boards (id, name, ble_id, created_at) VALUES ('board-1', 'Thor301', 'A1:B2', 1000)"
      )
      try db.execute(sql: """
        INSERT INTO board_settings (board_id, key, value_json, updated_at)
        VALUES ('board-1', 'transport', '"98"', 1000)
        """)
    }
  }

  /// Without this the restore "succeeded" and every board query threw on the missing column —
  /// swallowed by the repository's fallback, so the app showed "No board" with a full database.
  func testAndroidBoardsGainTheTransportColumnFromItsSetting() throws {
    try migrate()
    try replaceBoardsWithAndroidShape()
    try dropMigrationLedger()

    try queue.write { db in
      try TelemetryDatabase.stampAppliedMigrations(db, schemaVersion: TELEMETRY_SCHEMA_VERSION)
      try TelemetryDatabase.reconcileForeignSchema(db)
    }

    XCTAssertTrue(try columnNames("boards").contains("transport"))
    let transport = try queue.read { db in
      try String.fetchOne(db, sql: "SELECT transport FROM boards WHERE id = 'board-1'")
    }
    XCTAssertEqual(transport, "98")
  }

  func testBoardIdMigrationKeepsAlreadyBoardOwnedRules() throws {
    try migrate(upTo: "v26_alert_source")
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source)
          VALUES ('board-1', 'rule-1', 'speed', 30.0, NULL, 1, 'beep', 1000, 'preset')
          """
      )
    }

    try migrate()

    XCTAssertEqual(try alertCount(), 1)
  }
}
