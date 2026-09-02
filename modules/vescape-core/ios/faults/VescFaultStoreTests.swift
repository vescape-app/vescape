import GRDB
import XCTest

@testable import VescapeCore

/// Durable VESC Fault Occurrence storage: reads come back newest-first per Board, lifecycle updates
/// preserve dismissal, and removing a Board leaves its fault evidence behind.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
final class VescFaultStoreTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var store: VescFaultStore!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try queue.write { db in
      try db.execute(sql: "CREATE TABLE boards (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL)")
      try VescFaultStore.createTables(db)
    }
    store = VescFaultStore(dbWriter: queue)
  }

  private func occurrence(
    _ id: String,
    code: Int = 9,
    occurredAtMs: Int64 = 1_000,
    clearedAtMs: Int64? = nil
  ) -> VescFaultOccurrence {
    VescFaultOccurrence(
      id: id, boardId: "board", code: code, occurredAtMs: occurredAtMs,
      lastObservedAtMs: occurredAtMs, clearedAtMs: clearedAtMs, dismissed: false
    )
  }

  func testReadsNewestFirst() {
    store.upsert(occurrence("old", occurredAtMs: 1_000))
    store.upsert(occurrence("new", occurredAtMs: 9_000))

    XCTAssertEqual(store.getForBoard("board").map(\.id), ["new", "old"])
  }

  func testOpenLiveIgnoresClearedRows() throws {
    store.upsert(occurrence("cleared", occurredAtMs: 1_000, clearedAtMs: 2_000))
    store.upsert(occurrence("open", occurredAtMs: 4_000))

    XCTAssertEqual(try store.openLive("board")?.id, "open")
  }

  /// An unreadable database must not look like "no open fault": the coordinator would hydrate to
  /// empty and open a duplicate activation for a fault that is already durably open.
  func testOpenLiveThrowsWhenThePoolIsUnavailable() {
    let unavailable = VescFaultStore { nil }

    XCTAssertThrowsError(try unavailable.openLive("board"))
  }

  func testDismissalPreservesTheOccurrence() {
    store.upsert(occurrence("a"))

    XCTAssertTrue(store.setDismissed("a", true))
    XCTAssertEqual(store.getForBoard("board").count, 1)
    XCTAssertTrue(store.getForBoard("board")[0].dismissed)
  }

  func testBoardRemovalDoesNotDeleteFaultEvidence() throws {
    try queue.write { db in
      try db.execute(sql: "INSERT INTO boards (id, name) VALUES ('board', 'Demo')")
    }
    store.upsert(occurrence("a"))

    try queue.write { db in
      try db.execute(sql: "DELETE FROM boards WHERE id = 'board'")
    }

    // No foreign key, no cascade: the evidence outlives the Board record on purpose.
    XCTAssertEqual(store.getForBoard("board").count, 1)
  }

  // MARK: - Sync columns (#430)

  private func syncColumns(_ id: String) throws -> (updatedAt: Int64, syncSeq: Int64) {
    try queue.read { db in
      let row = try XCTUnwrap(
        try Row.fetchOne(
          db,
          sql: "SELECT updated_at, sync_seq FROM vesc_fault_occurrences WHERE id = ?",
          arguments: [id]
        )
      )
      return (row["updated_at"] as Int64, row["sync_seq"] as Int64)
    }
  }

  /// The whole reason the Occurrence carries its own Change Timestamp: acknowledging a fault edits
  /// the row without the fault being observed again, so nothing else would carry it to the server.
  func testDismissalMovesBothSyncColumns() throws {
    store.upsert(occurrence("a"))
    let before = try syncColumns("a")

    XCTAssertTrue(store.setDismissed("a", true))

    let after = try syncColumns("a")
    XCTAssertGreaterThan(after.updatedAt, before.updatedAt)
    XCTAssertGreaterThan(after.syncSeq, before.syncSeq)
  }

  /// A rewound clock must not leave the row stamped at or below the copy the server already holds:
  /// its upsert guard keeps the stored row unless the incoming stamp is strictly newer, so a frozen
  /// stamp satisfies the scan and still loses the dismissal.
  func testDismissalNeverStampsAtOrBelowTheStoredValue() throws {
    store.upsert(occurrence("a"))
    let ahead = Int64(Date().timeIntervalSince1970 * 1000) + 3_600_000
    try queue.write { db in
      try db.execute(sql: "UPDATE vesc_fault_occurrences SET updated_at = ?", arguments: [ahead])
    }

    XCTAssertTrue(store.setDismissed("a", true))

    XCTAssertEqual(try syncColumns("a").updatedAt, ahead + 1)
  }

  /// A lifecycle write is a change the server has to see too — a heartbeat that only moves
  /// `last_observed_at` still has to leave the row above the Sync Cursor.
  func testLifecycleUpsertMovesTheCursorPosition() throws {
    store.upsert(occurrence("a"))
    let before = try syncColumns("a")

    store.upsert(occurrence("a", clearedAtMs: 9_000))

    XCTAssertGreaterThan(try syncColumns("a").syncSeq, before.syncSeq)
  }
}
