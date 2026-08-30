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

  func testOpenLiveIgnoresClearedRows() {
    store.upsert(occurrence("cleared", occurredAtMs: 1_000, clearedAtMs: 2_000))
    store.upsert(occurrence("open", occurredAtMs: 4_000))

    XCTAssertEqual(store.openLive("board")?.id, "open")
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
}
