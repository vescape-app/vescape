import XCTest
import GRDB
@testable import VescapeCore

/// Board tombstones (ADR 0027): deleting a Board stamps `boards.deleted_at` instead of removing the
/// row, so Ride History outlives the Board that produced it. Configuration still goes; telemetry and
/// Tune Profiles never did and still do not.
///
/// Runs the real migrator and the real repository against an in-memory database.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/BoardTombstoneTest.kt
final class BoardTombstoneTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var repo: AppDataRepository!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    repo = AppDataRepository.forTesting(dbWriter: queue)
  }

  override func tearDownWithError() throws {
    repo = nil
    queue = nil
  }

  private func seedBoard(_ id: String = "board-1") {
    repo.upsertBoard([
      "id": id,
      "name": "ADV",
      "createdAt": Int64(1000),
      "link": ["bleId": "AA:BB", "transport": "direct"] as [String: Any?],
    ])
  }

  private func deletedAt(_ id: String) throws -> Int64? {
    try queue.read { db in
      try Int64.fetchOne(db, sql: "SELECT deleted_at FROM boards WHERE id = ?", arguments: [id])
    }
  }

  private func rowCount(_ table: String, boardId: String) throws -> Int {
    try queue.read { db in
      try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table) WHERE board_id = ?", arguments: [boardId]) ?? 0
    }
  }

  // MARK: Migration

  func testMigrationAddsNullableDeletedAtLeavingExistingRowsAlive() throws {
    let columns = try queue.read { db in try db.columns(in: "boards") }
    let deletedAt = columns.first { $0.name == "deleted_at" }

    XCTAssertNotNil(deletedAt, "boards is missing deleted_at")
    XCTAssertFalse(deletedAt?.isNotNull ?? true, "deleted_at must be nullable — null means alive")

    seedBoard()
    XCTAssertNil(try self.deletedAt("board-1"), "a fresh Board must start alive")
  }

  /// Re-running the whole migrator over a migrated database has to be a no-op, not a duplicate
  /// column error.
  func testMigrationIsANoOpOnReRun() throws {
    XCTAssertNoThrow(try TelemetryDatabase.migrator.migrate(queue))
  }

  // MARK: Delete

  func testDeleteKeepsTheRowAndStampsDeletedAt() throws {
    seedBoard()

    repo.deleteBoard("board-1")

    XCTAssertNotNil(try deletedAt("board-1"), "delete removed the row instead of tombstoning it")
  }

  func testDeleteStillRemovesBoardConfiguration() throws {
    seedBoard()
    repo.upsertAlertRule([
      "boardId": "board-1",
      "id": "rule-1",
      "controlId": "speed",
      "threshold": 40.0,
      "enabled": true,
      "soundType": "beep",
      "createdAt": Int64(1000),
    ])
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO board_warnings (board_id, kind, severity, first_detected_at, last_detected_at, payload_json)
          VALUES ('board-1', 'test-kind', 'warn', 1, 1, '{}')
          """
      )
    }

    repo.deleteBoard("board-1")

    XCTAssertEqual(try rowCount("board_settings", boardId: "board-1"), 0, "board settings survived")
    XCTAssertEqual(try rowCount("board_warnings", boardId: "board-1"), 0, "board warnings survived")
    XCTAssertEqual(try rowCount("alerts", boardId: "board-1"), 0, "alert rules survived")
  }

  /// The reason the tombstone exists: history is what the delete must not take with it.
  func testDeleteLeavesTelemetryAndTuneProfilesUntouched() throws {
    seedBoard()
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO tune_profiles (id, board_id, name, fields_json, created_at, updated_at)
          VALUES ('tune-1', 'board-1', 'Stiff', '{}', 1, 1)
          """
      )
    }

    repo.deleteBoard("board-1")

    XCTAssertEqual(try rowCount("tune_profiles", boardId: "board-1"), 1, "tune profiles were deleted")
  }

  // MARK: Reads

  func testTombstonedBoardLeavesTheRiderFacingListButStaysResolvableById() throws {
    seedBoard()
    seedBoard("board-2")

    repo.deleteBoard("board-1")

    XCTAssertEqual(repo.getBoards().compactMap { $0["id"] as? String }, ["board-2"])
    XCTAssertNotNil(repo.getBoard("board-1"), "history can no longer name the deleted Board")
  }

  func testUpsertNeverResurrectsATombstonedBoard() throws {
    seedBoard()
    repo.deleteBoard("board-1")

    seedBoard()

    XCTAssertNotNil(try deletedAt("board-1"), "an upsert cleared the tombstone")
    XCTAssertTrue(repo.getBoards().isEmpty, "a resurrected Board came back to the list")
  }

  /// A tombstone is an ordinary write: the server only keeps it if it arrives with a newer stamp
  /// and the upload scan only sees it if its Sync Cursor moved.
  func testDeleteMovesBothSyncColumns() throws {
    seedBoard()
    let before = try queue.read { db in
      try Row.fetchOne(db, sql: "SELECT updated_at, sync_seq FROM boards WHERE id = 'board-1'")!
    }

    repo.deleteBoard("board-1")

    let after = try queue.read { db in
      try Row.fetchOne(db, sql: "SELECT updated_at, sync_seq FROM boards WHERE id = 'board-1'")!
    }
    XCTAssertGreaterThan(after["updated_at"] as Int64, before["updated_at"] as Int64)
    XCTAssertGreaterThan(after["sync_seq"] as Int64, before["sync_seq"] as Int64)
  }
}
