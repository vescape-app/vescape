import XCTest

@testable import VescapeCore

/// VESC Fault Occurrence transition rules: one activation is one occurrence, repetition never
/// duplicates, a clear closes, a direct code change closes and opens, session loss decides nothing,
/// a restart mid-fault rehydrates instead of duplicating, and the collection switch stops writes
/// without touching stored evidence.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultCoordinatorTest.kt
final class VescFaultCoordinatorTests: XCTestCase {
  private final class FakeStore: VescFaultStoring {
    var rows: [String: VescFaultOccurrence] = [:]
    var order: [String] = []

    var all: [VescFaultOccurrence] { order.compactMap { rows[$0] } }

    func getForBoard(_ boardId: String) -> [VescFaultOccurrence] {
      all.filter { $0.boardId == boardId }.sorted { $0.occurredAtMs > $1.occurredAtMs }
    }

    func getAll() -> [VescFaultOccurrence] { all }

    /// Set to fail the next hydration read, mirroring a transient GRDB read error.
    var openLiveFailsOnce = false

    func openLive(_ boardId: String) throws -> VescFaultOccurrence? {
      if openLiveFailsOnce {
        openLiveFailsOnce = false
        throw FakeStoreError.readFailed
      }
      return all
        .filter { $0.boardId == boardId && $0.clearedAtMs == nil }
        .max { $0.occurredAtMs < $1.occurredAtMs }
    }

    /// Set to fail every write, mirroring a dead GRDB pool.
    var writesFail = false
    /// Set to fail only the next write, so one step of a two-write transition can fail alone.
    var failNextWriteOnly = false
    var writes = 0

    @discardableResult
    func upsert(_ occurrence: VescFaultOccurrence) -> Bool {
      if failNextWriteOnly {
        failNextWriteOnly = false
        return false
      }
      guard !writesFail else { return false }
      writes += 1
      if rows[occurrence.id] == nil {
        order.append(occurrence.id)
        rows[occurrence.id] = occurrence
        return true
      }
      // Lifecycle writes never rewrite `dismissed`, matching the SQL upsert.
      var existing = rows[occurrence.id]!
      existing.lastObservedAtMs = occurrence.lastObservedAtMs
      existing.clearedAtMs = occurrence.clearedAtMs
      rows[occurrence.id] = existing
      return true
    }

    @discardableResult
    func setDismissed(_ id: String, _ dismissed: Bool) -> Bool {
      guard var row = rows[id] else { return false }
      row.dismissed = dismissed
      rows[id] = row
      return true
    }
  }

  private enum FakeStoreError: Error { case readFailed }

  private var store = FakeStore()
  private var clock: Int64 = 1_000
  private var ids = 0

  override func setUp() {
    super.setUp()
    store = FakeStore()
    clock = 1_000
    ids = 0
  }

  private func makeCoordinator() -> VescFaultCoordinator {
    VescFaultCoordinator(
      store: store,
      now: { self.clock },
      newId: {
        self.ids += 1
        return "id-\(self.ids)"
      }
    )
  }

  func testOneActivationCreatesOneOccurrenceWithObservedTime() {
    makeCoordinator().onActiveFault(boardId: "board", code: 9)

    XCTAssertEqual(store.all.count, 1)
    let fault = store.all[0]
    XCTAssertEqual(fault.code, 9)
    XCTAssertEqual(fault.occurredAtMs, 1_000)
    XCTAssertNil(fault.clearedAtMs)
    XCTAssertFalse(fault.dismissed)
  }

  func testRepeatedFramesForTheSameCodeStayOneOccurrence() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    for _ in 0..<50 {
      clock += 30
      coordinator.onActiveFault(boardId: "board", code: 9)
    }

    XCTAssertEqual(store.all.count, 1)
    let fault = store.all[0]
    // Throttled writes still track the fault: last-observed advanced past the opening time.
    XCTAssertGreaterThan(fault.lastObservedAtMs, fault.occurredAtMs)
    XCTAssertNil(fault.clearedAtMs)
  }

  func testNormalFrameClosesTheOpenOccurrence() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    clock = 5_000
    coordinator.onFaultCleared(boardId: "board")

    XCTAssertEqual(store.all[0].clearedAtMs, 5_000)
  }

  func testDirectCodeChangeClosesOldAndOpensNew() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    clock = 4_000
    coordinator.onActiveFault(boardId: "board", code: 6)

    XCTAssertEqual(store.all.count, 2)
    XCTAssertNotEqual(store.all[0].id, store.all[1].id)
    XCTAssertEqual(store.all[0].clearedAtMs, 4_000)
    XCTAssertEqual(store.all[1].code, 6)
    XCTAssertNil(store.all[1].clearedAtMs)
  }

  func testGapInObservationsNeitherClearsNorReactivates() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    clock = 9_000
    // Same code observed again after the session came back: still one unresolved activation.
    coordinator.onActiveFault(boardId: "board", code: 9)

    XCTAssertEqual(store.all.count, 1)
    XCTAssertNil(store.all[0].clearedAtMs)
    XCTAssertEqual(store.all[0].occurredAtMs, 1_000)
  }

  func testRestartMidFaultAdoptsTheOpenOccurrence() {
    makeCoordinator().onActiveFault(boardId: "board", code: 9)

    clock = 8_000
    makeCoordinator().onActiveFault(boardId: "board", code: 9)

    XCTAssertEqual(store.all.count, 1)
  }

  func testCollectionOffStopsNewOccurrencesButKeepsEvidenceDismissible() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    let existing = store.all[0].id

    coordinator.collectionEnabled = false
    clock = 6_000
    coordinator.onActiveFault(boardId: "board", code: 6)
    coordinator.onFaultCleared(boardId: "board")

    XCTAssertEqual(store.all.count, 1)
    XCTAssertNil(store.all[0].clearedAtMs)

    coordinator.setDismissed(id: existing, dismissed: true)
    XCTAssertTrue(store.all[0].dismissed)
  }

  func testAFailedClearWriteLeavesTheOccurrenceOpenSoItCanRetry() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)

    store.writesFail = true
    clock = 5_000
    coordinator.onFaultCleared(boardId: "board")
    XCTAssertNil(store.all[0].clearedAtMs)

    store.writesFail = false
    clock = 6_000
    coordinator.onFaultCleared(boardId: "board")
    XCTAssertEqual(store.all[0].clearedAtMs, 6_000)

    // Normal-frame heartbeats keep retrying failed clears, but never rewrite a successful clear.
    let writesAfterClear = store.writes
    for _ in 0..<5 {
      clock += 1_000
      coordinator.onFaultCleared(boardId: "board")
    }
    XCTAssertEqual(store.writes, writesAfterClear)
    XCTAssertEqual(store.all[0].clearedAtMs, 6_000)
  }

  func testAFailedCloseOnACodeChangeDoesNotOpenTheReplacement() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)

    // Only the close of the old occurrence fails; without the guard the replacement would be
    // inserted anyway and the still-open old row would become unrepairable.
    store.failNextWriteOnly = true
    clock = 5_000
    coordinator.onActiveFault(boardId: "board", code: 6)

    XCTAssertEqual(store.all.count, 1)
    XCTAssertEqual(store.all[0].code, 9)
    XCTAssertNil(store.all[0].clearedAtMs)

    // The retry closes the old occurrence and opens the new one.
    clock = 6_000
    coordinator.onActiveFault(boardId: "board", code: 6)
    XCTAssertEqual(store.all.count, 2)
    XCTAssertEqual(store.all[0].clearedAtMs, 6_000)
    XCTAssertEqual(store.all[1].code, 6)
    XCTAssertNil(store.all[1].clearedAtMs)
  }

  func testAFailedHydrationReadRetriesInsteadOfDuplicatingTheOpenOccurrence() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)

    // Restart with an existing durable open fault, but the first hydration read fails.
    let restarted = makeCoordinator()
    store.openLiveFailsOnce = true
    clock = 8_000
    restarted.onActiveFault(boardId: "board", code: 9)
    XCTAssertEqual(store.all.count, 1)

    // The next observation retries hydration and adopts the open occurrence instead of duplicating.
    clock = 9_000
    restarted.onActiveFault(boardId: "board", code: 9)
    XCTAssertEqual(store.all.count, 1)
    XCTAssertEqual(store.all[0].id, "id-1")
    XCTAssertEqual(store.all[0].lastObservedAtMs, 9_000)
  }

  func testLaterActivationOfADismissedCodeIsANewUndismissedOccurrence() {
    let coordinator = makeCoordinator()
    coordinator.onActiveFault(boardId: "board", code: 9)
    let first = store.all[0].id
    coordinator.setDismissed(id: first, dismissed: true)
    clock = 3_000
    coordinator.onFaultCleared(boardId: "board")
    clock = 7_000
    coordinator.onActiveFault(boardId: "board", code: 9)

    XCTAssertEqual(store.all.count, 2)
    XCTAssertTrue(store.all.first { $0.id == first }!.dismissed)
    XCTAssertFalse(store.all.first { $0.id != first }!.dismissed)
  }
}
