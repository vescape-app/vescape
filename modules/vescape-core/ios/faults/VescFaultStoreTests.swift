import GRDB
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
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

  func testReadsNewestFirst() throws {
    try store.upsert(occurrence("old", occurredAtMs: 1_000))
    try store.upsert(occurrence("new", occurredAtMs: 9_000))

    XCTAssertEqual(try store.getForBoard("board").map(\.id), ["new", "old"])
  }

  func testOpenLiveIgnoresClearedRows() throws {
    try store.upsert(occurrence("cleared", occurredAtMs: 1_000, clearedAtMs: 2_000))
    try store.upsert(occurrence("open", occurredAtMs: 4_000))

    XCTAssertEqual(try store.openLive("board")?.id, "open")
  }

  func testOpenLiveThrowsWhenThePoolIsUnavailable() {
    let unavailable = VescFaultStore { nil }

    XCTAssertThrowsError(try unavailable.openLive("board"))
  }

  func testDismissalPreservesTheOccurrence() throws {
    try store.upsert(occurrence("a"))

    XCTAssertTrue(try store.setDismissed("a", true))
    XCTAssertEqual(try store.getForBoard("board").count, 1)
    XCTAssertTrue(try store.getForBoard("board")[0].dismissed)
  }

  func testBoardRemovalDoesNotDeleteFaultEvidence() throws {
    try queue.write { db in
      try db.execute(sql: "INSERT INTO boards (id, name) VALUES ('board', 'Demo')")
    }
    try store.upsert(occurrence("a"))

    try queue.write { db in
      try db.execute(sql: "DELETE FROM boards WHERE id = 'board'")
    }

    XCTAssertEqual(try store.getForBoard("board").count, 1)
  }
}
