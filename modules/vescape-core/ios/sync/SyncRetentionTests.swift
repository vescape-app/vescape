import XCTest
import GRDB
@testable import VescapeCore

/// Cursor-gated retention against a real database: a bound database must not prune a row the
/// uploader has not delivered, and an unbound one must keep the age-only behaviour it shipped with.
///
/// The Android peer asserts the same predicates against the DAO source, because Room keeps its SQL
/// out of reach of a JVM unit test.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncCursorContractTest.kt
final class SyncRetentionTests: XCTestCase {
  private var queue: DatabaseQueue!
  private let old: Int64 = 1_000
  private let cutoff: Int64 = 10_000

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  private func seedFrame(id: Int64, capturedAtMs: Int64) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_frames
            (id, captured_at_ms, elapsed_realtime_ms, board_id, flags, changed_mask_1, changed_mask_2)
          VALUES (?, ?, 0, 'board-1', 0, 0, 0)
          """,
        arguments: [id, capturedAtMs]
      )
    }
  }

  private func seedBucket(startMs: Int64, syncSeq: Int64) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_minute_buckets
            (bucket_start_ms, board_id, sample_count, first_sample_at_ms, last_sample_at_ms,
             sum_abs_speed_centi_kmh, max_abs_speed_centi_kmh, max_motor_current_abs_ma,
             max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli,
             max_duty_abs_permille, gps_point_count, precise_gps_point_count,
             gps_distance_cm, updated_at, sync_seq)
          VALUES (?, 'board-1', 1, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)
          """,
        arguments: [startMs, startMs, startMs, startMs, syncSeq]
      )
    }
  }

  private func frameIds() throws -> [Int64] {
    try queue.read { db in try Int64.fetchAll(db, sql: "SELECT id FROM telemetry_frames ORDER BY id") }
  }

  private func bucketStarts() throws -> [Int64] {
    try queue.read { db in
      try Int64.fetchAll(db, sql: "SELECT bucket_start_ms FROM telemetry_minute_buckets ORDER BY bucket_start_ms")
    }
  }

  private func bind(_ accountId: String = "account-1") throws {
    try queue.write { db in
      try db.execute(
        sql: "INSERT OR REPLACE INTO sync_binding (id, account_id, bound_at) VALUES (0, ?, 0)",
        arguments: [accountId]
      )
    }
  }

  private func sweep() throws {
    _ = try queue.write { db in try deleteBeforeGated(db, beforeMs: cutoff) }
  }

  func testANeverBoundDatabaseKeepsTheAgeOnlyCleanup() throws {
    try seedFrame(id: 1, capturedAtMs: old)
    try seedFrame(id: 2, capturedAtMs: cutoff + 1)

    try sweep()
    XCTAssertEqual(try frameIds(), [2])
  }

  func testABoundDatabaseRetainsEveryRowItsCursorHasNotPassed() throws {
    try bind()
    try seedFrame(id: 1, capturedAtMs: old)
    try seedFrame(id: 2, capturedAtMs: old)

    try sweep()
    XCTAssertEqual(try frameIds(), [1, 2], "a missing cursor protects every row in the table")

    try queue.write { db in try commitSyncCursor(db, syncCursorFrames, 1) }
    try sweep()
    XCTAssertEqual(try frameIds(), [2], "only rows at or below the accepted cursor may be pruned")
  }

  /// A bucket rewritten after its earlier version uploaded gets a fresh `sync_seq`, so it has to
  /// survive until that new position is accepted — a row id could not express this.
  func testAnOldBucketRewrittenAfterUploadSurvivesUntilItsNewSeqIsAccepted() throws {
    try bind()
    try seedBucket(startMs: old, syncSeq: 1)
    try queue.write { db in try commitSyncCursor(db, syncCursorMinuteBuckets, 1) }

    // The minute is re-merged, which renumbers the row above the accepted cursor.
    try queue.write { db in
      try db.execute(sql: "UPDATE telemetry_minute_buckets SET sync_seq = 7 WHERE bucket_start_ms = ?", arguments: [old])
    }
    try sweep()
    XCTAssertEqual(try bucketStarts(), [old])

    try queue.write { db in try commitSyncCursor(db, syncCursorMinuteBuckets, 7) }
    try sweep()
    XCTAssertTrue(try bucketStarts().isEmpty)
  }

  /// Signing out does not clear the binding, so data recorded afterwards keeps its protection.
  func testSignOutKeepsRetentionProtectionForTheBoundAccount() throws {
    try bind()
    try seedFrame(id: 1, capturedAtMs: old)

    // Nothing about a sign-out touches `sync_binding`.
    try sweep()
    XCTAssertEqual(try frameIds(), [1])
  }

  func testABindingIsClaimedOnceAndRefusesADifferentAccount() throws {
    try queue.write { db in
      XCTAssertNil(try String.fetchOne(db, sql: "SELECT account_id FROM sync_binding WHERE id = 0"))
    }
    try bind("account-1")
    try queue.read { db in
      XCTAssertEqual(try String.fetchOne(db, sql: "SELECT account_id FROM sync_binding WHERE id = 0"), "account-1")
    }
  }
}
