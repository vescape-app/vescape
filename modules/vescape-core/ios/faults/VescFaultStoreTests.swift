import GRDB
import XCTest

@testable import VescapeCore

/// Durable VESC Fault Occurrence storage: the row shape survives a round trip (including the null
/// occurrence time register-sourced evidence needs), reads come back newest-first per Board, and
/// removing a Board leaves its fault evidence behind.
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
    source: VescFaultSource = .live,
    occurredAtMs: Int64? = 1_000,
    discoveredAtMs: Int64 = 1_000,
    clearedAtMs: Int64? = nil,
    registerPosition: Int? = nil
  ) -> VescFaultOccurrence {
    VescFaultOccurrence(
      id: id, boardId: "board", code: code, source: source, occurredAtMs: occurredAtMs,
      discoveredAtMs: discoveredAtMs, lastObservedAtMs: discoveredAtMs, clearedAtMs: clearedAtMs,
      registerPosition: registerPosition, dismissed: false
    )
  }

  func testRoundTripsAnUntimedRegisterOccurrence() {
    store.upsert(
      occurrence("a", source: .register, occurredAtMs: nil, discoveredAtMs: 5_000, registerPosition: 3)
    )

    let stored = store.getForBoard("board")[0]
    XCTAssertEqual(stored.source, .register)
    XCTAssertNil(stored.occurredAtMs)
    XCTAssertEqual(stored.discoveredAtMs, 5_000)
    XCTAssertEqual(stored.registerPosition, 3)
  }

  func testReadsNewestFirst() {
    store.upsert(occurrence("old", discoveredAtMs: 1_000))
    store.upsert(occurrence("new", discoveredAtMs: 9_000))

    XCTAssertEqual(store.getForBoard("board").map(\.id), ["new", "old"])
  }

  func testOpenLiveIgnoresClearedAndRegisterRows() {
    store.upsert(occurrence("cleared", discoveredAtMs: 1_000, clearedAtMs: 2_000))
    store.upsert(occurrence("register", source: .register, discoveredAtMs: 3_000))
    store.upsert(occurrence("open", discoveredAtMs: 4_000))

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
