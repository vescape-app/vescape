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

  // MARK: - Telemetry keys on the Board id (#280, ADR 0028)

  /// The last migration before `v42_telemetry_board_id`. Stopping here leaves both telemetry tables
  /// in their `device_id` shape.
  private static let beforeBoardId = "v41_board_deleted_at"

  private func insertBoard(id: String, name: String, bleId: String?) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO boards (id, name, ble_id, created_at)
          VALUES (?, ?, ?, 1000)
          """,
        arguments: [id, name, bleId]
      )
    }
  }

  private func insertLegacyFrame(deviceId: String?, deviceName: String?, capturedAtMs: Int64) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_frames
            (captured_at_ms, elapsed_realtime_ms, device_id, device_name, flags, changed_mask_1, changed_mask_2)
          VALUES (?, 0, ?, ?, 1, 0, 0)
          """,
        arguments: [capturedAtMs, deviceId, deviceName]
      )
    }
  }

  private func insertLegacyBucket(
    deviceId: String,
    deviceName: String?,
    bucketStartMs: Int64,
    sampleCount: Int = 1
  ) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_minute_buckets (
            bucket_start_ms, device_id, device_name, sample_count, first_sample_at_ms,
            last_sample_at_ms, sum_abs_speed_centi_kmh, max_abs_speed_centi_kmh,
            max_motor_current_abs_ma, max_battery_current_abs_ma, battery_used_wh_milli,
            battery_regen_wh_milli, max_duty_abs_permille, gps_point_count,
            precise_gps_point_count, gps_distance_cm
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
          """,
        arguments: [
          bucketStartMs, deviceId, deviceName, sampleCount, bucketStartMs, bucketStartMs + 500,
        ]
      )
    }
  }

  private func boardIds(fromFrames: Bool = true) throws -> [String?] {
    let table = fromFrames ? "telemetry_frames" : "telemetry_minute_buckets"
    return try queue.read { db in
      try Row.fetchAll(db, sql: "SELECT board_id FROM \(table) ORDER BY rowid")
        .map { $0["board_id"] as String? }
    }
  }

  private func board(_ id: String) throws -> Row? {
    try queue.read { db in
      try Row.fetchOne(db, sql: "SELECT * FROM boards WHERE id = ?", arguments: [id])
    }
  }

  /// Telemetry that still resolves keeps its Board; the retired columns go with the rebuild.
  func testTelemetryBackfillsBoardIdFromTheLinkedBoardAndDropsTheOldColumns() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertBoard(id: "board-1", name: "ADV", bleId: "ble-a")
    try insertLegacyFrame(deviceId: "ble-a", deviceName: "ADV", capturedAtMs: 60_000)
    try insertLegacyBucket(deviceId: "ble-a", deviceName: "ADV", bucketStartMs: 60_000)

    try migrate()

    XCTAssertEqual(try boardIds(), ["board-1"])
    XCTAssertEqual(try boardIds(fromFrames: false), ["board-1"])
    for table in ["telemetry_frames", "telemetry_minute_buckets"] {
      let columns = try columnNames(table)
      XCTAssertFalse(columns.contains("device_id"), "\(table) kept device_id")
      XCTAssertFalse(columns.contains("device_name"), "\(table) kept device_name")
    }
  }

  /// Two Boards may claim one `ble_id` — the same peripheral linked twice, which the app supports
  /// and a Rider produces by pairing a board they already own a second time. Telemetry from before
  /// this migration recorded only the identifier, so which of them was connected is unknowable and
  /// the pick is arbitrary. What is not arbitrary is that frames and buckets make the *same* pick:
  /// split across the two Boards, History lists the ride from its buckets, finds no frames under
  /// that Board, and renders stats over an empty route.
  func testADuplicatedIdentifierSendsFramesAndBucketsToTheSameBoard() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertBoard(id: "board-b", name: "Jeżdżąca Martwica", bleId: "ble-dup")
    try insertBoard(id: "board-a", name: "ADV2", bleId: "ble-dup")
    try insertLegacyFrame(deviceId: "ble-dup", deviceName: "ADV2", capturedAtMs: 60_000)
    try insertLegacyBucket(deviceId: "ble-dup", deviceName: "ADV2", bucketStartMs: 60_000)

    try migrate()

    let frameBoard = try boardIds()
    XCTAssertEqual(frameBoard, try boardIds(fromFrames: false), "the ride's frames and buckets split")
    XCTAssertEqual(frameBoard, ["board-a"], "the pick is arbitrary but must be stable")
    XCTAssertNotNil(try board("board-b"), "the losing claimant is still a Board the Rider owns")
  }

  /// ADR-0028 left Markers, Diagnostic Events and Metric Exclusion Ranges on `device_id` because
  /// "that is what crosses the wire for them" — circular, and it kept a second copy of the defect
  /// the Board move existed to remove. All three resolve through the same one decision, so a
  /// duplicated identifier cannot scatter a ride's Markers across the Boards claiming it.
  func testMarkersEventsAndRangesMoveOntoTheSameBoardAsTheirTelemetry() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertBoard(id: "board-b", name: "Jeżdżąca Martwica", bleId: "ble-dup")
    try insertBoard(id: "board-a", name: "ADV2", bleId: "ble-dup")
    try insertLegacyBucket(deviceId: "ble-dup", deviceName: "ADV2", bucketStartMs: 60_000)
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_markers
            (occurred_at_ms, elapsed_realtime_ms, type, device_id, device_name, message, gap_ms)
          VALUES (60000, 0, 'gap', 'ble-dup', 'ADV2', NULL, 4000)
          """
      )
      try db.execute(
        sql: """
          INSERT INTO diagnostic_events
            (occurred_at_ms, elapsed_realtime_ms, event_name, operation, phase, device_id,
             device_name, message, properties_json)
          VALUES (60000, 0, 'ble_connect', 'connect', 'start', 'ble-dup', 'ADV2', NULL, '{}')
          """
      )
      try db.execute(
        sql: """
          INSERT INTO metric_exclusion_ranges (device_id, reason, start_ms, end_ms, sample_count)
          VALUES ('ble-dup', 'free-spin', 60000, 60500, 3)
          """
      )
    }

    try migrate()

    let bucketBoard = try boardIds(fromFrames: false).first ?? nil
    for table in ["telemetry_markers", "diagnostic_events", "metric_exclusion_ranges"] {
      let owners = try queue.read { db in
        try Row.fetchAll(db, sql: "SELECT board_id FROM \(table)").map { $0["board_id"] as String? }
      }
      XCTAssertEqual(owners, [bucketBoard], "\(table) resolved the identifier its own way")
      let columns = try columnNames(table)
      XCTAssertFalse(columns.contains("device_id"), "\(table) kept device_id")
      XCTAssertFalse(columns.contains("device_name"), "\(table) kept device_name")
    }
  }

  /// A Marker can be written with no Board connected, so its column stays nullable. A Range has no
  /// meaning without a Board, so its NOT NULL column takes the sentinel a bucket takes.
  func testAMarkerWithNoIdentifierStaysUnattributedAndARangeTakesTheSentinel() throws {
    try migrate(upTo: Self.beforeBoardId)
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_markers
            (occurred_at_ms, elapsed_realtime_ms, type, device_id, device_name, message, gap_ms)
          VALUES (60000, 0, 'gap', NULL, NULL, NULL, NULL)
          """
      )
      try db.execute(
        sql: """
          INSERT INTO metric_exclusion_ranges (device_id, reason, start_ms, end_ms, sample_count)
          VALUES ('', 'free-spin', 60000, 60500, 3)
          """
      )
    }

    try migrate()

    XCTAssertEqual(
      try queue.read { db in try String.fetchOne(db, sql: "SELECT board_id FROM telemetry_markers") },
      nil
    )
    XCTAssertEqual(
      try queue.read { db in
        try String.fetchOne(db, sql: "SELECT board_id FROM metric_exclusion_ranges")
      },
      ""
    )
  }

  /// A frame that never carried an identifier stays unattributed rather than joining a random
  /// Board; the bucket column is part of the primary key, so it takes the sentinel instead.
  func testTelemetryWithNoIdentifierStaysUnattributed() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertLegacyFrame(deviceId: nil, deviceName: nil, capturedAtMs: 60_000)
    try insertLegacyBucket(deviceId: "", deviceName: nil, bucketStartMs: 60_000)

    try migrate()

    XCTAssertEqual(try boardIds(), [nil])
    XCTAssertEqual(try boardIds(fromFrames: false), [""])
    XCTAssertEqual(try queue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM boards") }, 0)
  }

  // MARK: Orphan minting

  /// The regression this exists to prevent: telemetry from a Board hard-deleted before tombstones
  /// existed resolves to nothing, and without a minted Board it loses both its identity and its
  /// label. It must end up pointing at a Board that exists, is tombstoned, and keeps the name the
  /// history itself recorded.
  func testUnresolvedIdentifierMintsATombstonedBoardCarryingTheHistoricalName() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertLegacyFrame(deviceId: "ble-gone", deviceName: "Old Board", capturedAtMs: 60_000)

    try migrate()

    let mintedId = try XCTUnwrap(try boardIds().first ?? nil)
    XCTAssertEqual(mintedId, "\(ORPHAN_BOARD_ID_PREFIX)ble-gone")

    let minted = try XCTUnwrap(try board(mintedId))
    XCTAssertEqual(minted["name"] as String, "Old Board")
    XCTAssertNotNil(minted["deleted_at"] as Int64?, "a minted Board is not tombstoned")
    XCTAssertNil(minted["ble_id"] as String?, "a minted Board carries a Board Link")
  }

  /// A minted Board is invisible to the Rider: `getBoards()` filters tombstones (ADR 0027), so the
  /// only place it surfaces is the history label it exists to provide.
  func testAMintedBoardNeverAppearsInTheRidersBoardList() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertBoard(id: "board-1", name: "ADV", bleId: "ble-a")
    try insertLegacyFrame(deviceId: "ble-gone", deviceName: "Old Board", capturedAtMs: 60_000)

    try migrate()

    let live = try queue.read { db in
      try String.fetchAll(db, sql: "SELECT id FROM boards WHERE deleted_at IS NULL ORDER BY id")
    }
    XCTAssertEqual(live, ["board-1"])
  }

  /// Minting is derived from the identifier, not random, so a database that somehow reaches the
  /// migration twice does not accumulate a second Board per ride.
  func testMintingTheSameIdentifierTwiceIsANoOp() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertLegacyFrame(deviceId: "ble-gone", deviceName: "Old Board", capturedAtMs: 60_000)
    try insertLegacyBucket(deviceId: "ble-gone", deviceName: "Old Board", bucketStartMs: 60_000)

    try migrate()

    XCTAssertEqual(try queue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM boards") }, 1)
  }

  // MARK: Bucket rebuild

  /// The primary key move is a table rebuild, and the retired columns go with it.
  func testTheBucketRebuildMovesThePrimaryKey() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertBoard(id: "board-1", name: "ADV", bleId: "ble-a")
    try insertLegacyBucket(deviceId: "ble-a", deviceName: "ADV", bucketStartMs: 60_000)

    try migrate()

    XCTAssertEqual(
      try queue.read { db in try db.primaryKey("telemetry_minute_buckets").columns },
      ["bucket_start_ms", "board_id"]
    )
    let columns = try columnNames("telemetry_minute_buckets")
    XCTAssertFalse(columns.contains("device_id"))
    XCTAssertFalse(columns.contains("device_name"))
  }

}
