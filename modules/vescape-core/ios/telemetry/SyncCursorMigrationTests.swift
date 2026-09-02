import XCTest
import GRDB
@testable import VescapeCore

/// Incremental-sync cursors: the `v43_sync_cursors` migration adds `updated_at` to `boards`,
/// `alerts` and `telemetry_minute_buckets`, backfills it from each table's best evidence of last
/// change, and indexes it. `v44_sync_seq` then splits the two jobs that column was doing — `sync_seq`
/// carries the Sync Cursor, `updated_at` stays the last-write-wins timestamp. Every write path has to
/// move both.
///
/// Runs the real migrator against an in-memory database, stopping at v27 to seed pre-migration rows.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/SyncCursorMigrationTest.kt
final class SyncCursorMigrationTests: XCTestCase {
  private var queue: DatabaseQueue!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  /// Migrate up to (and including) the last pre-cursor migration, so the seeded rows look exactly
  /// like an installed app's rows before it upgrades.
  private func migrateToV27() throws {
    try TelemetryDatabase.migrator.migrate(queue, upTo: "v27_alert_board_id")
  }

  private func migrateToLatest() throws {
    try TelemetryDatabase.migrator.migrate(queue)
  }

  private func columnNames(_ table: String) throws -> [String] {
    try queue.read { db in try db.columns(in: table).map(\.name) }
  }

  private func indexNames(_ table: String) throws -> [String] {
    try queue.read { db in try db.indexes(on: table).map(\.name) }
  }

  func testV27HasNoCursorColumns() throws {
    try migrateToV27()

    for table in ["boards", "alerts", "telemetry_minute_buckets"] {
      XCTAssertFalse(try columnNames(table).contains("updated_at"), "\(table) already has a cursor")
    }
  }

  func testMigrationAddsCursorColumnAndIndexToEverySyncedTable() throws {
    try migrateToLatest()

    for table in ["boards", "alerts", "telemetry_minute_buckets"] {
      XCTAssertTrue(try columnNames(table).contains("updated_at"), "\(table) is missing updated_at")
      XCTAssertTrue(
        try indexNames(table).contains("index_\(table)_updated_at"),
        "\(table) is missing its updated_at index"
      )
    }
  }

  /// The backfill is the whole point of shipping this as a migration rather than a plain column add:
  /// a row left at the `DEFAULT 0` would report epoch zero to the server and get re-synced forever.
  func testBackfillCarriesExistingRowsInsteadOfLeavingThemAtZero() throws {
    try migrateToV27()
    try queue.write { db in
      try db.execute(
        sql: "INSERT INTO boards (id, name, ble_id, transport, created_at) VALUES (?, ?, NULL, NULL, ?)",
        arguments: ["board-1", "ADV", 1_000]
      )
      try db.execute(
        sql: """
          INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source)
          VALUES (?, ?, ?, ?, NULL, 1, ?, ?, NULL)
          """,
        arguments: ["board-1", "rule-1", "duty", 70.0, "default", 2_000]
      )
      try db.execute(
        sql: """
          INSERT INTO telemetry_minute_buckets (
            bucket_start_ms, device_id, device_name, sample_count, first_sample_at_ms, last_sample_at_ms,
            sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh,
            max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma,
            max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli,
            max_duty_abs_permille, first_odometer_cm, last_odometer_cm,
            gps_point_count, precise_gps_point_count, gps_distance_cm, max_gps_speed_centi_mps
          ) VALUES (?, ?, NULL, 1, ?, ?, 0, 0, 0, 0, NULL, 0, 0, 0, 0, 0, NULL, NULL, 0, 0, 0, NULL)
          """,
        arguments: [60_000, "board-1", 60_000, 3_000]
      )
    }

    try migrateToLatest()

    try queue.read { db in
      XCTAssertEqual(try Int64.fetchOne(db, sql: "SELECT updated_at FROM boards"), 1_000)
      XCTAssertEqual(try Int64.fetchOne(db, sql: "SELECT updated_at FROM alerts"), 2_000)
      // Buckets have no `created_at`; `last_sample_at_ms` is the closest record of last change.
      XCTAssertEqual(
        try Int64.fetchOne(db, sql: "SELECT updated_at FROM telemetry_minute_buckets"),
        3_000
      )
    }
  }

  // MARK: - Write paths

  private func makeRepository() throws -> AppDataRepository {
    try migrateToLatest()
    return AppDataRepository.forTesting(dbWriter: queue)
  }

  private func alertCursor() throws -> Int64? {
    try queue.read { db in try Int64.fetchOne(db, sql: "SELECT updated_at FROM alerts") }
  }

  func testUpsertsStampTheCursor() throws {
    let repo = try makeRepository()

    repo.upsertBoard(["id": "board-1", "name": "ADV", "createdAt": 1_000])
    repo.upsertAlertRule([
      "boardId": "board-1", "id": "rule-1", "controlId": "duty", "threshold": 70.0,
      "enabled": true, "createdAt": 1_000,
    ])

    let boardCursor = try queue.read { db in
      try Int64.fetchOne(db, sql: "SELECT updated_at FROM boards")
    }
    // Stamped from the device clock, not from the bridge-supplied `createdAt`.
    XCTAssertGreaterThan(boardCursor ?? 0, 1_000)
    XCTAssertGreaterThan(try alertCursor() ?? 0, 1_000)
  }

  /// The regression this whole change exists to prevent. `setAlertRuleEnabled` is a targeted UPDATE
  /// rather than a whole-row rewrite, so it is the one write path that can silently skip the cursor
  /// — toggling an alert would then never reach the server.
  func testSetAlertRuleEnabledBumpsTheCursor() throws {
    let repo = try makeRepository()
    repo.upsertAlertRule([
      "boardId": "board-1", "id": "rule-1", "controlId": "duty", "threshold": 70.0,
      "enabled": true, "createdAt": 1_000,
    ])
    let before = try XCTUnwrap(alertCursor())

    // The cursor is millisecond-resolution wall clock, so force a tick we can observe.
    Thread.sleep(forTimeInterval: 0.005)
    repo.setAlertRuleEnabled("board-1", "rule-1", false)

    let after = try XCTUnwrap(alertCursor())
    XCTAssertGreaterThan(after, before)
    XCTAssertEqual(
      try queue.read { db in try Int64.fetchOne(db, sql: "SELECT enabled FROM alerts") },
      0
    )
  }

  /// Buckets are append-and-merge targets: a later append has to move the cursor even though it
  /// leaves most aggregate columns folded into the existing row.
  func testBucketUpsertAdvancesTheCursorOnMerge() throws {
    try migrateToLatest()
    var bucket = TelemetryBucket(bucketStartMs: 60_000, boardId: "board-1")
    bucket.firstSampleAtMs = 60_000
    bucket.lastSampleAtMs = 60_500
    bucket.sampleCount = 1

    try queue.write { db in try upsertBucket(db, bucket, now: 1_000) }
    try queue.write { db in try upsertBucket(db, bucket, now: 5_000) }

    let (cursor, samples) = try queue.read { db -> (Int64?, Int64?) in
      (
        try Int64.fetchOne(db, sql: "SELECT updated_at FROM telemetry_minute_buckets"),
        try Int64.fetchOne(db, sql: "SELECT sample_count FROM telemetry_minute_buckets")
      )
    }
    XCTAssertEqual(cursor, 5_000)
    // Sanity: the second write merged into the same row rather than inserting a new one.
    XCTAssertEqual(samples, 2)
  }

  /// A device clock that steps backwards must not merely freeze the stamp: the server guards this
  /// table with `stored.updated_at < EXCLUDED.updated_at` like every other mutable table, so a
  /// frozen stamp is scanned, sent, and silently dropped. The merge ratchets strictly past it (#281).
  func testBucketCursorRatchetsPastAStampTheClockCannotBeat() throws {
    try migrateToLatest()
    var bucket = TelemetryBucket(bucketStartMs: 60_000, boardId: "board-1")
    bucket.firstSampleAtMs = 60_000
    bucket.lastSampleAtMs = 60_500

    try queue.write { db in try upsertBucket(db, bucket, now: 5_000) }
    try queue.write { db in try upsertBucket(db, bucket, now: 1_000) }

    XCTAssertEqual(
      try queue.read { db in try Int64.fetchOne(db, sql: "SELECT updated_at FROM telemetry_minute_buckets") },
      5_001
    )
  }

  // MARK: - Sync Cursor sequence (#275)

  private func syncSeq(_ table: String) throws -> Int64? {
    try queue.read { db in try Int64.fetchOne(db, sql: "SELECT sync_seq FROM \(table)") }
  }

  private func counter(_ name: String) throws -> Int64? {
    try queue.read { db in
      try Int64.fetchOne(db, sql: "SELECT last_value FROM sync_sequences WHERE name = ?", arguments: [name])
    }
  }

  func testMigrationAddsSyncSeqColumnAndIndexToEverySyncedTable() throws {
    try migrateToLatest()

    for table in syncSeqTables {
      XCTAssertTrue(try columnNames(table).contains("sync_seq"), "\(table) is missing sync_seq")
      XCTAssertTrue(
        try indexNames(table).contains("index_\(table)_sync_seq"),
        "\(table) is missing its sync_seq index"
      )
    }
  }

  /// Pre-29 rows need distinct, increasing positions, and the counter has to resume above all of
  /// them — otherwise the first writes after upgrade reuse numbers the scan would order wrongly.
  func testMigrationBackfillsSyncSeqAndResumesTheCounterAboveIt() throws {
    try migrateToV27()
    try queue.write { db in
      for (index, id) in ["board-1", "board-2", "board-3"].enumerated() {
        try db.execute(
          sql: "INSERT INTO boards (id, name, ble_id, transport, created_at) VALUES (?, ?, NULL, NULL, ?)",
          arguments: [id, "ADV", 1_000 + index]
        )
      }
    }

    try migrateToLatest()

    let seqs = try queue.read { db in
      try Int64.fetchAll(db, sql: "SELECT sync_seq FROM boards ORDER BY sync_seq")
    }
    XCTAssertEqual(seqs.count, 3)
    XCTAssertEqual(Set(seqs).count, 3, "backfilled positions collide")
    XCTAssertEqual(try counter(syncSeqBoards), seqs.max())
  }

  func testUpsertsAdvanceTheSyncSeq() throws {
    let repo = try makeRepository()

    repo.upsertBoard(["id": "board-1", "name": "ADV", "createdAt": 1_000])
    let first = try XCTUnwrap(syncSeq(syncSeqBoards))
    repo.upsertBoard(["id": "board-1", "name": "Renamed", "createdAt": 1_000])

    XCTAssertGreaterThan(try XCTUnwrap(syncSeq(syncSeqBoards)), first)
  }

  /// The reason the counter lives in its own table instead of being derived as `MAX(sync_seq) + 1`:
  /// deleting the highest row would hand its number out again, and the reused row would land below a
  /// cursor the phone had already advanced past.
  func testSyncSeqIsNotReusedAfterTheHighestRowIsDeleted() throws {
    let repo = try makeRepository()
    repo.upsertBoard(["id": "board-1", "name": "ADV", "createdAt": 1_000])
    let deleted = try XCTUnwrap(syncSeq(syncSeqBoards))

    repo.deleteBoard("board-1")
    repo.upsertBoard(["id": "board-2", "name": "GT", "createdAt": 1_000])

    XCTAssertGreaterThan(try XCTUnwrap(syncSeq(syncSeqBoards)), deleted)
  }

  func testBucketMergeAdvancesTheSyncSeq() throws {
    try migrateToLatest()
    var bucket = TelemetryBucket(bucketStartMs: 60_000, boardId: "board-1")
    bucket.firstSampleAtMs = 60_000
    bucket.lastSampleAtMs = 60_500

    try queue.write { db in try upsertBucket(db, bucket, now: 1_000) }
    let first = try XCTUnwrap(syncSeq(syncSeqMinuteBuckets))
    // A merge rewrites a row the scan may already have passed, so it needs a fresh position too.
    try queue.write { db in try upsertBucket(db, bucket, now: 2_000) }

    XCTAssertGreaterThan(try XCTUnwrap(syncSeq(syncSeqMinuteBuckets)), first)
  }

  // MARK: - Last-write-wins ratchet (#275)

  func testRatchetStepsPastAStampTheClockCannotBeat() throws {
    XCTAssertEqual(ratchetUpdatedAt(nil, 1_000), 1_000)
    // Clock ahead of the stored row: truthful wall clock, no inflation.
    XCTAssertEqual(ratchetUpdatedAt(1_000, 5_000), 5_000)
    // Clock rewound below it: strictly above, so the server's `stored < incoming` guard accepts it.
    XCTAssertEqual(ratchetUpdatedAt(5_000, 1_000), 5_001)
    XCTAssertEqual(ratchetUpdatedAt(5_000, 5_000), 5_001)
  }

  /// A rewound clock must not leave the row stamped at or below the copy the server already holds —
  /// the upsert guard there keeps the stored row unless the incoming stamp is strictly newer, so a
  /// frozen stamp is a silently dropped edit.
  func testBoardUpsertNeverStampsAtOrBelowTheStoredValue() throws {
    let repo = try makeRepository()
    repo.upsertBoard(["id": "board-1", "name": "ADV", "createdAt": 1_000])
    // Stand in for a rewind by putting the stored row far beyond any clock the write can read.
    let ahead = Int64(Date().timeIntervalSince1970 * 1000) + 3_600_000
    try queue.write { db in
      try db.execute(sql: "UPDATE boards SET updated_at = ?", arguments: [ahead])
    }

    repo.upsertBoard(["id": "board-1", "name": "Renamed", "createdAt": 1_000])

    XCTAssertEqual(try queue.read { db in try Int64.fetchOne(db, sql: "SELECT updated_at FROM boards") }, ahead + 1)
  }

  func testSetAlertRuleEnabledNeverStampsAtOrBelowTheStoredValue() throws {
    let repo = try makeRepository()
    repo.upsertAlertRule([
      "boardId": "board-1", "id": "rule-1", "controlId": "duty", "threshold": 70.0,
      "enabled": true, "createdAt": 1_000,
    ])
    let ahead = Int64(Date().timeIntervalSince1970 * 1000) + 3_600_000
    try queue.write { db in
      try db.execute(sql: "UPDATE alerts SET updated_at = ?", arguments: [ahead])
    }
    let seqBefore = try XCTUnwrap(syncSeq(syncSeqAlerts))

    repo.setAlertRuleEnabled("board-1", "rule-1", false)

    XCTAssertEqual(try alertCursor(), ahead + 1)
    XCTAssertGreaterThan(try XCTUnwrap(syncSeq(syncSeqAlerts)), seqBefore)
  }

  // MARK: - The six remaining mutable tables (#281)

  private func rowSyncSeq(_ table: String, _ whereClause: String, _ args: StatementArguments) throws -> Int64? {
    try queue.read { db in
      try Int64.fetchOne(db, sql: "SELECT sync_seq FROM \(table) WHERE \(whereClause)", arguments: args)
    }
  }

  func testRemainingMutableTablesCarryACursorAndItsIndex() throws {
    try migrateToLatest()

    for table in syncSeqTablesV45 {
      XCTAssertTrue(try columnNames(table).contains("sync_seq"), "\(table) is missing sync_seq")
      XCTAssertTrue(
        try indexNames(table).contains("index_\(table)_sync_seq"),
        "\(table) is missing its sync_seq index"
      )
    }
    XCTAssertTrue(try columnNames("board_warnings").contains("updated_at"))
  }

  /// Append-only tables key on `INTEGER PRIMARY KEY AUTOINCREMENT`, which SQLite guarantees
  /// monotonic and never reused — that key already is their cursor, so a second one would be dead
  /// weight the write paths would have to keep in step.
  func testAppendOnlyTablesGainNoCursor() throws {
    try migrateToLatest()

    for table in ["telemetry_frames", "telemetry_markers", "diagnostic_events",
                  "metric_exclusion_ranges", "tune_history_entries"] {
      XCTAssertFalse(try columnNames(table).contains("sync_seq"), "\(table) should not carry sync_seq")
    }
  }

  func testMigrationBackfillsRemainingTablesWithDistinctPositions() throws {
    try TelemetryDatabase.migrator.migrate(queue, upTo: "v42_telemetry_board_id")
    try queue.write { db in
      for (index, id) in ["zone-1", "zone-2", "zone-3"].enumerated() {
        try db.execute(
          sql: """
            INSERT INTO privacy_zones
              (id, preset, name, enabled, center_latitude_e7, center_longitude_e7, radius_meters, created_at, updated_at)
            VALUES (?, 'home', 'Home', 1, 0, 0, 100, ?, ?)
            """,
          arguments: [id, 1_000 + index, 1_000 + index]
        )
      }
    }

    try migrateToLatest()

    let seqs = try queue.read { db in
      try Int64.fetchAll(db, sql: "SELECT sync_seq FROM privacy_zones ORDER BY sync_seq")
    }
    XCTAssertEqual(Set(seqs).count, 3, "backfilled positions collide")
    XCTAssertFalse(seqs.contains(0), "a backfilled row sits at the seed value")
    XCTAssertEqual(try counter(syncSeqPrivacyZones), seqs.max())
  }

  /// Re-running the migrator must not renumber rows or re-seed the counter below positions already
  /// handed out.
  func testRemainingTablesMigrationIsANoOpOnReRun() throws {
    try migrateToLatest()
    let repo = try makeRepository()
    repo.upsertPrivacyZone(["id": "zone-1", "preset": "home", "name": "Home",
                            "centerLatitude": 0.0, "centerLongitude": 0.0, "radiusMeters": 100])
    let before = try counter(syncSeqPrivacyZones)

    try migrateToLatest()

    XCTAssertEqual(try counter(syncSeqPrivacyZones), before)
  }

  func testPrivacyZoneToggleMovesBothColumns() throws {
    try migrateToLatest()
    let repo = try makeRepository()
    repo.upsertPrivacyZone(["id": "zone-1", "preset": "home", "name": "Home",
                            "centerLatitude": 0.0, "centerLongitude": 0.0, "radiusMeters": 100])
    let first = try XCTUnwrap(syncSeq("privacy_zones"))
    let stamp = try queue.read { db in try Int64.fetchOne(db, sql: "SELECT updated_at FROM privacy_zones") }

    repo.setPrivacyZoneEnabled("zone-1", false)

    XCTAssertGreaterThan(try XCTUnwrap(syncSeq("privacy_zones")), first)
    XCTAssertGreaterThan(
      try XCTUnwrap(queue.read { db in try Int64.fetchOne(db, sql: "SELECT updated_at FROM privacy_zones") }),
      try XCTUnwrap(stamp)
    )
  }

  /// Rider identity and this phone's session state live in `app_settings` but name the phone, not
  /// the Rider (#277). They are excluded by never being given a cursor position: 0 sits below every
  /// Sync Cursor, so no scan sees the row.
  func testPhoneLocalSettingsKeepNoCursorPosition() throws {
    try migrateToLatest()
    let repo = try makeRepository()

    repo.updateSetting("riderName", rawValue: "Kacper")
    repo.updateSetting("liveHistoryLimit", rawValue: 10)

    XCTAssertEqual(try rowSyncSeq("app_settings", "key = ?", ["riderName"]), 0)
    XCTAssertGreaterThan(try XCTUnwrap(rowSyncSeq("app_settings", "key = ?", ["liveHistoryLimit"])), 0)
  }

  /// The backfill numbers every existing row from `rowid`, which would hand a phone-local key a
  /// position and ship it exactly once on the first upload after upgrade.
  func testMigrationStripsCursorsFromPhoneLocalSettings() throws {
    try TelemetryDatabase.migrator.migrate(queue, upTo: "v42_telemetry_board_id")
    try queue.write { db in
      for key in ["riderName", "liveHistoryLimit"] {
        try db.execute(
          sql: "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
          arguments: [key, "1", 1_000]
        )
      }
    }

    try migrateToLatest()

    XCTAssertEqual(try rowSyncSeq("app_settings", "key = ?", ["riderName"]), 0)
    XCTAssertGreaterThan(try XCTUnwrap(rowSyncSeq("app_settings", "key = ?", ["liveHistoryLimit"])), 0)
  }

  // MARK: - VESC Fault Evidence (#430)

  /// Seed fault evidence the way an installed app holds it just before the upgrade.
  ///
  /// The tables are rebuilt in their pre-v48 shape first: `VescFaultStore.createTables` is the
  /// current schema, so migrating from scratch produces the columns a phone installed on v40..v47
  /// does not have — and only that phone's shape exercises the backfill.
  private func seedFaultEvidenceBeforeV48() throws {
    try TelemetryDatabase.migrator.migrate(queue, upTo: "v47_sync_binding")
    try queue.write { db in
      try db.execute(sql: "DROP TABLE vesc_fault_occurrences")
      try db.execute(sql: "DROP TABLE vesc_fault_captures")
      try db.execute(sql: """
        CREATE TABLE vesc_fault_occurrences (
          id TEXT NOT NULL PRIMARY KEY,
          board_id TEXT NOT NULL,
          code INTEGER NOT NULL,
          occurred_at INTEGER NOT NULL,
          last_observed_at INTEGER NOT NULL,
          cleared_at INTEGER,
          dismissed INTEGER NOT NULL
        )
        """)
      try db.execute(sql: """
        CREATE TABLE vesc_fault_captures (
          occurrence_id TEXT NOT NULL PRIMARY KEY,
          board_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          opened_at INTEGER NOT NULL,
          sample_count INTEGER NOT NULL
        )
        """)
    }
    try queue.write { db in
      for (index, id) in ["fault-1", "fault-2"].enumerated() {
        try db.execute(
          sql: """
            INSERT INTO vesc_fault_occurrences
              (id, board_id, code, occurred_at, last_observed_at, cleared_at, dismissed)
            VALUES (?, 'board-1', 9, ?, ?, NULL, 0)
            """,
          arguments: [id, 1_000 + index, 5_000 + index]
        )
        try db.execute(
          sql: """
            INSERT INTO vesc_fault_captures
              (occurrence_id, board_id, started_at, opened_at, sample_count)
            VALUES (?, 'board-1', ?, ?, 3)
            """,
          arguments: [id, 900 + index, 1_000 + index]
        )
      }
    }
  }

  func testFaultEvidenceGainsItsCursorColumnsAndIndexes() throws {
    try migrateToLatest()

    XCTAssertTrue(try columnNames("vesc_fault_occurrences").contains("updated_at"))
    for table in syncSeqTablesV48 {
      XCTAssertTrue(try columnNames(table).contains("sync_seq"), "\(table) is missing sync_seq")
      XCTAssertTrue(
        try indexNames(table).contains("index_\(table)_sync_seq"),
        "\(table) is missing its sync_seq index"
      )
    }
    // Append-only on an `AUTOINCREMENT` key, which already is its cursor.
    XCTAssertFalse(try columnNames("vesc_fault_capture_samples").contains("sync_seq"))
  }

  /// Epoch zero is not a truthful change timestamp: the server keeps the stored row unless the
  /// incoming stamp is strictly newer, so a whole existing fault record would arrive unrestorable.
  func testOccurrenceChangeTimestampIsBackfilledFromTheLastObservation() throws {
    try seedFaultEvidenceBeforeV48()

    try migrateToLatest()

    let stamps = try queue.read { db in
      try Int64.fetchAll(db, sql: "SELECT updated_at FROM vesc_fault_occurrences ORDER BY id")
    }
    XCTAssertEqual(stamps, [5_000, 5_001])
  }

  func testFaultEvidenceBackfillsDistinctPositionsAndSeedsItsCounters() throws {
    try seedFaultEvidenceBeforeV48()

    try migrateToLatest()

    for (table, counterName) in [
      ("vesc_fault_occurrences", syncSeqVescFaultOccurrences),
      ("vesc_fault_captures", syncSeqVescFaultCaptures),
    ] {
      let seqs = try queue.read { db in
        try Int64.fetchAll(db, sql: "SELECT sync_seq FROM \(table) ORDER BY sync_seq")
      }
      XCTAssertEqual(Set(seqs).count, 2, "\(table) backfilled positions collide")
      XCTAssertFalse(seqs.contains(0), "\(table) has a row at the seed value")
      XCTAssertEqual(try counter(counterName), seqs.max())
    }
  }

  /// Re-running the migrator must not renumber rows or re-seed a counter below positions already
  /// handed out.
  func testFaultEvidenceMigrationIsANoOpOnReRun() throws {
    try seedFaultEvidenceBeforeV48()
    try migrateToLatest()
    let before = try counter(syncSeqVescFaultOccurrences)

    try migrateToLatest()

    XCTAssertEqual(try counter(syncSeqVescFaultOccurrences), before)
  }
}
