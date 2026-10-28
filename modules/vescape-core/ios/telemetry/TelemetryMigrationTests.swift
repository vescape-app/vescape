import GRDB
import XCTest
@testable import VescapeCore

/// Runs the real `VescapeDatabase` migrator against an in-memory database. This is the guard every
/// future migration inherits: add a case here rather than shipping a schema change no Swift test has
/// executed.
///
/// `v27_alert_board_id` is the current last migration and the only one with data consequences —
/// Alert Rules become board-owned, pre-release global rules are dropped rather than reassigned, and
/// three former global settings keys are deleted from `app_settings`.
final class TelemetryMigrationTests: XCTestCase {
  private var queue: DatabaseQueue!

  func testSharedFixtureManifestCoversBothProductionMigrationRegistries() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("../shared/migration-fixture-manifest.json"))
    let manifest = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let room = manifest["room"] as! [String: Any]
    let roomStarts = Set(room["supportedStarts"] as! [Int])
    XCTAssertEqual(roomStarts, supportedAndroidDatabaseVersions)
    let archiveStarts = Set(room["archiveSupportedStarts"] as! [Int])
    XCTAssertEqual(archiveStarts, exportedAndroidDatabaseVersions)
    let grdb = manifest["grdb"] as! [String: Any]
    XCTAssertEqual(Set(grdb["migrationIdentifiers"] as! [String]), Set(VescapeDatabase.migrator.migrations))
  }

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  private func migrate(upTo version: String? = nil) throws {
    if let version {
      try VescapeDatabase.migrator.migrate(queue, upTo: version)
    } else {
      try VescapeDatabase.migrator.migrate(queue)
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

    let applied = try queue.read { db in try VescapeDatabase.migrator.appliedIdentifiers(db) }
    XCTAssertEqual(applied, Set(VescapeDatabase.migrator.migrations))
  }

  func testPublishedBackupGenerationsMatchRealMigrationHistory() {
    XCTAssertTrue([1, 23, 31, 33, 40, 42].allSatisfy(exportedIOSDatabaseVersions.contains))
    XCTAssertTrue((14...36).allSatisfy(exportedAndroidDatabaseVersions.contains))
    XCTAssertTrue((40...42).allSatisfy(exportedAndroidDatabaseVersions.contains))
    XCTAssertFalse(exportedAndroidDatabaseVersions.contains(13))
    XCTAssertFalse(exportedAndroidDatabaseVersions.contains(37))
    XCTAssertFalse(exportedAndroidDatabaseVersions.contains(39))
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

  /// The beep count moves into the sound string and its column goes (#578); speech, geiger, and
  /// rule identity survive the table rebuild.
  func testAlertSoundCountMigrationFoldsBeepCountIntoTheSoundString() throws {
    try migrate(upTo: "v49_bucket_route_preview")
    try queue.write { db in
      for (id, threshold, max, sound, count) in [
        ("speech", 20.0, nil, "tts:Slow down", 3), ("beep", 25.0, nil, "preset:beep", 2),
        ("urgent", 30.0, nil, "preset:urgent", 9), ("notify", 35.0, nil, "notify", 1),
        ("tick", 80.0, 90.0 as Double?, "preset:tick", 3),
      ] {
        try db.execute(
          sql: """
            INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, beep_count)
            VALUES ('board-1', ?, 'speed', ?, ?, 1, ?, 1000, ?)
            """,
          arguments: [id, threshold, max, sound, count]
        )
      }
    }

    try migrate()

    XCTAssertFalse(try columnNames("alerts").contains("beep_count"))
    let sounds = try queue.read { db in
      try Dictionary(uniqueKeysWithValues: Row.fetchAll(db, sql: "SELECT id, spec FROM alerts").map {
        ($0["id"] as String, $0["spec"] as String)
      })
    }
    XCTAssertEqual(sounds, [
      "speech": "tts:Slow down", "beep": "alert(2):warning", "urgent": "alert(5):critical",
      "notify": "alert(1):info", "tick": "preset:tick",
    ])
    let primaryKey = try queue.read { db in try db.primaryKey("alerts").columns }
    XCTAssertEqual(primaryKey, ["board_id", "id"])
  }

  /// Each Board's Alert Presets become one `preset:<metric>` row (#591): the old level (missing or
  /// custom is Off), geiger choice, and match setting; copied preset rows and the settings go.
  func testPresetRowsMigrationFoldsSettingsIntoOneRowPerMetric() throws {
    try migrate(upTo: "v50_alert_sound_count")
    try queue.write { db in
      try db.execute(sql: "INSERT INTO boards (id, name, ble_id, created_at) VALUES ('board-1', 'Board', NULL, 1000)")
      for (key, json) in [
        ("alertPreset", #"{"speed":"safe","duty":"custom","motor-temp":"normal"}"#),
        ("alertPresetSound", #"{"speed":{"geiger":"geiger:mid"}}"#),
        ("matchBoardConfig", #"{"motor-temp":true}"#),
      ] {
        try db.execute(sql: "INSERT INTO board_settings VALUES ('board-1', ?, ?, 1000)", arguments: [key, json])
      }
      for (id, control, max, sound, source) in [
        ("preset:duty:0", "duty", 90.0 as Double?, "geiger:soft", "preset" as String?),
        ("preset:battery:0", "battery", nil, "tts:Battery {percent}%", "preset"),
        ("custom", "battery", nil, "tts:Battery {percent}%", nil),
      ] {
        try db.execute(
          sql: """
            INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source)
            VALUES ('board-1', ?, ?, 20, ?, 1, ?, 1000, ?)
            """,
          arguments: [id, control, max, sound, source]
        )
      }
    }

    try migrate()

    let specs = try queue.read { db in
      try Dictionary(uniqueKeysWithValues: Row.fetchAll(db, sql: "SELECT id, spec FROM alerts").map {
        ($0["id"] as String, $0["spec"] as String)
      })
    }
    XCTAssertEqual(specs, [
      "preset:speed": "preset(safe):geiger=mid", "preset:duty": "preset(off):geiger=soft",
      "preset:motor-temp": "preset(normal):match=on", "preset:controller-temp": "preset(off)",
      "preset:battery": "preset(off)", "custom": "tts:Battery {percent}%",
    ])
    XCTAssertFalse(try columnNames("alerts").contains("source"))
    let keys = try queue.read { db in try String.fetchSet(db, sql: "SELECT key FROM board_settings") }
    XCTAssertTrue(keys.isDisjoint(with: ["alertPreset", "alertPresetSound", "matchBoardConfig"]))
  }

  /// v51 folds each live Board's own settings and old preset rows: nothing leaks between Boards, a
  /// tombstone gets no preset rows, geiger falls back to the old rows, and a metric whose old preset
  /// points were all disabled becomes Off while a partly disabled ladder keeps its level.
  /// A plain Normal level is the app default and writes no row; an unset level stays an explicit Off.
  /// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/TelemetryMigrationMatrixHostTest.kt `presetRowsMigrationKeepsBoardsApartAndHonoursDisabledPoints`
  func testPresetRowsMigrationKeepsBoardsApartAndHonoursDisabledPoints() throws {
    try migrate(upTo: "v50_alert_sound_count")
    try queue.write { db in
      try db.execute(sql: """
        INSERT INTO boards (id, name, ble_id, created_at, deleted_at)
        VALUES ('board-1', 'One', NULL, 1, NULL), ('board-2', 'Two', NULL, 2, NULL), ('board-3', 'Three', NULL, 3, 4)
        """)
      for (board, key, json) in [
        ("board-1", "alertPreset", #"{"speed":"minimal","battery":"safe"}"#),
        ("board-1", "alertPresetSound", #"{"speed":{"geiger":"geiger:hard"}}"#),
        ("board-2", "alertPreset", #"{"speed":"normal","duty":"normal"}"#),
        ("board-2", "matchBoardConfig", #"{"duty":true}"#),
        ("board-3", "alertPreset", #"{"speed":"safe"}"#),
      ] {
        try db.execute(sql: "INSERT INTO board_settings VALUES (?, ?, ?, 1)", arguments: [board, key, json])
      }
      for (board, id, control, enabled, sound, source) in [
        ("board-1", "preset:speed:0", "speed", false, "geiger:soft", "preset" as String?),
        ("board-1", "preset:speed:1", "speed", true, "geiger:soft", "preset"),
        ("board-1", "preset:battery:0", "battery", false, "tts:Battery {percent}%", "preset"),
        ("board-1", "preset:battery:1", "battery", false, "tts:Battery {percent}%", "preset"),
        ("board-2", "preset:duty:0", "duty", false, "geiger:mid", "preset"),
        ("board-2", "preset:duty:1", "duty", false, "geiger:mid", "preset"),
        ("board-3", "preset:speed:0", "speed", true, "geiger:soft", "preset"),
        ("board-3", "rider-3", "speed", true, "alert(1):warning", nil),
      ] {
        try db.execute(
          sql: """
            INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source)
            VALUES (?, ?, ?, 20, NULL, ?, ?, 1, ?)
            """,
          arguments: [board, id, control, enabled, sound, source]
        )
      }
    }

    try migrate()

    func specs(_ board: String) throws -> [String: String] {
      try queue.read { db in
        try Dictionary(uniqueKeysWithValues: Row.fetchAll(db, sql: "SELECT id, spec FROM alerts WHERE board_id = ?", arguments: [board]).map {
          ($0["id"] as String, $0["spec"] as String)
        })
      }
    }
    XCTAssertEqual(try specs("board-1"), [
      "preset:speed": "preset(minimal):geiger=hard", "preset:duty": "preset(off)",
      "preset:motor-temp": "preset(off)", "preset:controller-temp": "preset(off)", "preset:battery": "preset(off)",
    ])
    XCTAssertEqual(try specs("board-2"), [
      // Normal with no options is the app default: no row.
      "preset:duty": "preset(off):geiger=mid,match=on",
      "preset:motor-temp": "preset(off)", "preset:controller-temp": "preset(off)", "preset:battery": "preset(off)",
    ])
    XCTAssertEqual(try specs("board-3"), ["rider-3": "alert(1):warning"])
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
    for key in ["alertPreset", "riderTopSpeedKmh", "alertPresetsOnboarded", "distanceUnit"] {
      try insertSetting(key)
    }

    try migrate()

    let keys = try queue.read { db in try String.fetchSet(db, sql: "SELECT key FROM app_settings") }
    XCTAssertEqual(keys, ["distanceUnit"])
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
      try VescapeDatabase.stampAppliedMigrations(db, schemaVersion: schemaVersion)
    }
  }

  private func applied() throws -> Set<String> {
    try queue.read { db in try VescapeDatabase.migrator.appliedIdentifiers(db) }
  }

  /// Restoring an Android backup used to fail outright: no ledger meant `v1` replayed, and
  /// `CREATE TABLE boards` on a database that already has `boards` rolled the whole restore back.
  func testCurrentBackupIsStampedRatherThanReplayed() throws {
    try migrate()
    try dropMigrationLedger()

    try stamp(schemaVersion: VESCAPE_DATABASE_VERSION)
    try migrate()

    XCTAssertEqual(try applied(), Set(VescapeDatabase.migrator.migrations))
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
    XCTAssertEqual(try applied(), Set(VescapeDatabase.migrator.migrations))
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
      try VescapeDatabase.stampAppliedMigrations(db, schemaVersion: VESCAPE_DATABASE_VERSION)
      try VescapeDatabase.reconcileForeignSchema(db)
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
          VALUES ('board-1', 'rule-1', 'speed', 30.0, NULL, 1, 'beep', 1000, 'manual')
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
      // v43 added `recording_id` to the key and v52 took it out again (ADR 0041).
      ["bucket_start_ms", "board_id"]
    )
    let columns = try columnNames("telemetry_minute_buckets")
    XCTAssertFalse(columns.contains("device_id"))
    XCTAssertFalse(columns.contains("device_name"))
  }

  // MARK: Ride Track (#448, ADR 0038)

  private static let beforeRideTrack = "v42_telemetry_board_id"

  /// A frame the way it looked while position was still seven columns on the telemetry row.
  private func insertFrameWithGps(
    boardId: String?,
    capturedAtMs: Int64,
    latitudeE7: Int64?,
    longitudeE7: Int64?,
    accuracyCm: Int? = 500,
    locationTimestampMs: Int64? = nil
  ) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_frames (
            captured_at_ms, elapsed_realtime_ms, board_id, flags, changed_mask_1, changed_mask_2,
            speed_centi_kmh, latitude_e7, longitude_e7, accuracy_cm, gps_speed_centi_mps,
            bearing_centi_deg, altitude_cm, location_timestamp_ms
          ) VALUES (?, 0, ?, 1, 0, 1, 1234, ?, ?, ?, 250, 9000, 12000, ?)
          """,
        arguments: [
          capturedAtMs, boardId, latitudeE7, longitudeE7, accuracyCm, locationTimestampMs,
        ]
      )
    }
  }

  private func trackRows() throws -> [Row] {
    try queue.read { db in
      try Row.fetchAll(db, sql: "SELECT * FROM ride_track_points ORDER BY fix_at_ms ASC")
    }
  }

  /// A ride with sparse positions keeps exactly the fixes it had — no more, and none invented.
  func testSparsePositionsMoveIntoTheRideTrackOnTheGpsClock() throws {
    try migrate(upTo: Self.beforeRideTrack)
    try insertFrameWithGps(boardId: "board-1", capturedAtMs: 60_000, latitudeE7: nil, longitudeE7: nil)
    try insertFrameWithGps(
      boardId: "board-1",
      capturedAtMs: 61_000,
      latitudeE7: 520_000_000,
      longitudeE7: 210_000_000,
      locationTimestampMs: 60_800
    )
    try insertFrameWithGps(boardId: "board-1", capturedAtMs: 62_000, latitudeE7: nil, longitudeE7: nil)

    try migrate()

    let rows = try trackRows()
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows[0]["latitude_e7"] as Int64, 520_000_000)
    // The GPS clock wins over the frame clock the fix was merely stamped onto.
    XCTAssertEqual(rows[0]["fix_at_ms"] as Int64, 60_800)
    XCTAssertEqual(rows[0]["board_id"] as String?, "board-1")
    XCTAssertEqual(rows[0]["accuracy_cm"] as Int?, 500)
    XCTAssertEqual(rows[0]["gps_speed_centi_mps"] as Int?, 250)
    XCTAssertEqual(rows[0]["altitude_cm"] as Int?, 12_000)
  }

  /// A ride recorded without GPS migrates to an empty track, and keeps its telemetry.
  func testARideWithNoPositionsMigratesToAnEmptyTrack() throws {
    try migrate(upTo: Self.beforeRideTrack)
    try insertFrameWithGps(boardId: "board-1", capturedAtMs: 60_000, latitudeE7: nil, longitudeE7: nil)

    try migrate()

    XCTAssertEqual(try trackRows().count, 0)
    let speed = try queue.read { db in
      try Int.fetchOne(db, sql: "SELECT speed_centi_kmh FROM telemetry_frames")
    }
    XCTAssertEqual(speed, 1234)
  }

  /// A fix with no timestamp of its own falls back to the frame's, and a poor fix is kept: the
  /// precision rule moved to read time, so the migration must not filter on accuracy.
  func testFixesWithoutTimestampsOrGoodAccuracyAreStillMigrated() throws {
    try migrate(upTo: Self.beforeRideTrack)
    try insertFrameWithGps(
      boardId: "board-1",
      capturedAtMs: 60_000,
      latitudeE7: 520_000_000,
      longitudeE7: 210_000_000,
      accuracyCm: 15_000,
      locationTimestampMs: nil
    )

    try migrate()

    let rows = try trackRows()
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows[0]["fix_at_ms"] as Int64, 60_000)
    XCTAssertEqual(rows[0]["accuracy_cm"] as Int?, 15_000)
  }

  /// Board attribution comes from the column the board-id migration already resolved, so a fix on a
  /// re-linked or deleted Board keeps whatever that migration decided, through both upgrade paths.
  func testBoardAttributionSurvivesTheOlderUpgradePath() throws {
    try migrate(upTo: Self.beforeBoardId)
    try insertLegacyFrame(deviceId: "ble-gone", deviceName: "Old Board", capturedAtMs: 60_000)
    try queue.write { db in
      try db.execute(
        sql: """
          UPDATE telemetry_frames
          SET latitude_e7 = 520000000, longitude_e7 = 210000000, accuracy_cm = 400
          """
      )
    }

    try migrate()

    let rows = try trackRows()
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows[0]["board_id"] as String?, "orphan-ble-gone")
  }

  /// The seven raw GPS columns go, and the telemetry that shared the row stays.
  func testFramesLoseTheirGpsColumnsAndKeepTheirTelemetry() throws {
    try migrate(upTo: Self.beforeRideTrack)
    try insertFrameWithGps(
      boardId: "board-1",
      capturedAtMs: 60_000,
      latitudeE7: 520_000_000,
      longitudeE7: 210_000_000
    )

    try migrate()

    let columns = try columnNames("telemetry_frames")
    for retired in [
      "latitude_e7", "longitude_e7", "gps_speed_centi_mps", "bearing_centi_deg", "accuracy_cm",
      "altitude_cm", "location_timestamp_ms",
    ] {
      XCTAssertFalse(columns.contains(retired), "telemetry_frames kept \(retired)")
    }
    XCTAssertFalse(columns.contains("recording_id"))
    XCTAssertTrue(columns.contains("speed_centi_kmh"))
    XCTAssertEqual(
      try queue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames") },
      1
    )
  }

  /// v52 drops durable recording identity (ADR 0041): two recordings of one Board in one minute
  /// fold into one bucket, and legacy fixes without accuracy keep reading as precise.
  /// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/TelemetryMigrationMatrixHostTest.kt `dropRideRecordingsFoldsSharedMinutes`
  func testDropRideRecordingsFoldsSharedMinutes() throws {
    try migrate(upTo: "v51_preset_rows")
    try queue.write { db in
      try db.execute(sql: "INSERT INTO ride_recordings VALUES ('ride-a','board-1',60000,61000,'stopped'),('ride-b','board-1',61500,NULL,NULL)")
      try db.execute(sql: "INSERT INTO ride_track_points (recording_id,board_id,fix_at_ms,latitude_e7,longitude_e7,accuracy_cm) VALUES (NULL,'board-1',500,1,1,NULL),('ride-a','board-1',60600,2,2,NULL)")
      let columns = "bucket_start_ms,board_id,recording_id,sample_count,first_sample_at_ms,last_sample_at_ms,sum_abs_speed_centi_kmh,moving_speed_sample_count,sum_moving_abs_speed_centi_kmh,max_abs_speed_centi_kmh,min_battery_voltage_mv,max_motor_current_abs_ma,max_battery_current_abs_ma,battery_used_wh_milli,battery_regen_wh_milli,max_duty_abs_permille,first_odometer_cm,last_odometer_cm,gps_point_count,precise_gps_point_count,gps_distance_cm,max_gps_speed_centi_mps,first_latitude_e7,first_longitude_e7,route_preview"
      try db.execute(sql: "INSERT INTO telemetry_minute_buckets (\(columns)) VALUES (60000,'board-1','ride-a',2,60500,61000,1800,2,1800,900,50000,100,200,10,1,300,1000,1100,1,1,50,300,NULL,NULL,'[]')")
      try db.execute(sql: "INSERT INTO telemetry_minute_buckets (\(columns)) VALUES (60000,'board-1','ride-b',3,61800,62000,3300,3,3300,1100,49000,300,100,20,2,400,1100,1300,1,1,70,500,520000000,170000000,'[]')")
    }

    try migrate()

    try queue.read { db in
      XCTAssertFalse(try db.tableExists("ride_recordings"))
      for table in ["telemetry_frames", "ride_track_points", "telemetry_minute_buckets"] {
        XCTAssertFalse(try db.columns(in: table).map(\.name).contains("recording_id"), table)
      }
      XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT accuracy_cm FROM ride_track_points WHERE fix_at_ms = 500"), 2000)
      XCTAssertNil(try Int.fetchOne(db, sql: "SELECT accuracy_cm FROM ride_track_points WHERE fix_at_ms = 60600"))
      let rows = try Row.fetchAll(db, sql: "SELECT * FROM telemetry_minute_buckets")
      XCTAssertEqual(rows.count, 1)
      XCTAssertEqual(rows[0]["sample_count"] as Int, 5)
      XCTAssertEqual(rows[0]["first_sample_at_ms"] as Int64, 60_500)
      XCTAssertEqual(rows[0]["last_sample_at_ms"] as Int64, 62_000)
      XCTAssertEqual(rows[0]["sum_abs_speed_centi_kmh"] as Int64, 5_100)
      XCTAssertEqual(rows[0]["min_battery_voltage_mv"] as Int, 49_000)
      XCTAssertEqual(rows[0]["first_odometer_cm"] as Int64, 1_000)
      XCTAssertEqual(rows[0]["last_odometer_cm"] as Int64, 1_300)
      XCTAssertEqual(rows[0]["first_latitude_e7"] as Int64, 520_000_000)
      XCTAssertNil(rows[0]["route_preview"] as String?)
    }
  }
}
