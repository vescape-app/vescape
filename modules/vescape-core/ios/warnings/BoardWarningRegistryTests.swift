import XCTest
import GRDB
@testable import VescapeCore

/// Lifecycle tests for the Board Warning registry (automotive fault-code model): upsert preserves
/// `firstDetectedAt`, clean-evaluation-with-data clears, no-data evaluations leave rows untouched,
/// manual clear deletes and re-detection re-fires, and one Diagnostic Event fires per kind per Board
/// Session. Runs against an in-memory GRDB database seeded with the app-data schema.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/warnings/BoardWarningRegistryTest.kt
final class BoardWarningRegistryTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var store: BoardWarningStore!
  private var breadcrumbs: [(String, [String: Any?])]!
  private var emits: [(String, [BoardWarning])]!
  private var clock: Int64!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try queue.write { db in try BoardWarningStore.createTables(db) }
    store = BoardWarningStore(dbWriter: queue)
    breadcrumbs = []
    emits = []
    clock = 1_000
  }

  override func tearDownWithError() throws {
    store = nil
    queue = nil
    breadcrumbs = nil
    emits = nil
  }

  private func makeRegistry() -> BoardWarningRegistry {
    let registry = BoardWarningRegistry(
      store: store,
      recordDiagnostic: { name, props in self.breadcrumbs.append((name, props)) },
      now: { self.clock }
    )
    registry.onChange = { boardId, warnings in self.emits.append((boardId, warnings)) }
    return registry
  }

  func testUpsertPreservesFirstDetectedAtAndUpdatesRest() throws {
    let registry = makeRegistry()
    clock = 1_000
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{\"peak\":0.1}")
    clock = 5_000
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .critical, payloadJson: "{\"peak\":0.3}")

    let warnings = try registry.warningsForBoard("board-a")
    XCTAssertEqual(warnings.count, 1)
    let warning = warnings[0]
    XCTAssertEqual(warning.firstDetectedAtMs, 1_000)
    XCTAssertEqual(warning.lastDetectedAtMs, 5_000)
    XCTAssertEqual(warning.severity, "critical")
    XCTAssertEqual(warning.payloadJson, "{\"peak\":0.3}")
  }

  func testCleanEvaluationWithDataClearsWarning() throws {
    let registry = makeRegistry()
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{}")
    registry.reportCleanEvaluation(boardId: "board-a", kind: "cell-spread")

    XCTAssertTrue(try registry.warningsForBoard("board-a").isEmpty)
  }

  func testCleanEvaluationWithoutRowLeavesStoreUntouchedAndDoesNotEmit() throws {
    let registry = makeRegistry()
    emits.removeAll()
    registry.reportCleanEvaluation(boardId: "board-a", kind: "cell-spread")

    XCTAssertTrue(try registry.warningsForBoard("board-a").isEmpty)
    XCTAssertTrue(emits.isEmpty)
  }

  func testManualClearDeletesAndReDetectionReFires() throws {
    let registry = makeRegistry()
    registry.reportFinding(boardId: "board-a", kind: "footpad-disabled", severity: .critical, payloadJson: "{}")
    try registry.clearWarning(boardId: "board-a", kind: "footpad-disabled")
    XCTAssertTrue(try registry.warningsForBoard("board-a").isEmpty)

    registry.reportFinding(boardId: "board-a", kind: "footpad-disabled", severity: .critical, payloadJson: "{}")
    XCTAssertEqual(try registry.warningsForBoard("board-a").count, 1)
  }

  func testManualClearInvokesOnManualClearEvenWithoutRow() throws {
    let registry = makeRegistry()
    var clears: [(String, String?)] = []
    registry.onManualClear = { boardId, kind in clears.append((boardId, kind)) }

    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{}")
    try registry.clearWarning(boardId: "board-a", kind: "cell-spread")
    // No row (e.g. lost to a swallowed write) still re-arms the detector.
    try registry.clearWarning(boardId: "board-a", kind: "battery-config-mismatch")
    try registry.clearAllWarnings(boardId: "board-a")

    XCTAssertEqual(clears.map(\.0), ["board-a", "board-a", "board-a"])
    XCTAssertEqual(clears.map(\.1), ["cell-spread", "battery-config-mismatch", nil])
  }

  func testClearAllRemovesEveryWarningForBoardOnly() throws {
    let registry = makeRegistry()
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{}")
    registry.reportFinding(boardId: "board-a", kind: "footpad-disabled", severity: .critical, payloadJson: "{}")
    registry.reportFinding(boardId: "board-b", kind: "cell-spread", severity: .warn, payloadJson: "{}")

    try registry.clearAllWarnings(boardId: "board-a")

    XCTAssertTrue(try registry.warningsForBoard("board-a").isEmpty)
    XCTAssertEqual(try registry.warningsForBoard("board-b").count, 1)
  }

  func testOneBreadcrumbPerKindPerSession() throws {
    let registry = makeRegistry()
    registry.beginSession("board-a")
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{}")
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .critical, payloadJson: "{}")

    XCTAssertEqual(breadcrumbs.count, 1)
    XCTAssertEqual(breadcrumbs[0].0, "board_warning_detected")
    XCTAssertEqual(breadcrumbs[0].1["kind"] as? String, "cell-spread")

    // A new session re-arms the breadcrumb for the same still-true kind.
    registry.beginSession("board-a")
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .critical, payloadJson: "{}")
    XCTAssertEqual(breadcrumbs.count, 2)
  }

  func testEmitSnapshotEmitsEveryBoardWithWarnings() throws {
    let registry = makeRegistry()
    registry.reportFinding(boardId: "board-a", kind: "cell-spread", severity: .warn, payloadJson: "{}")
    registry.reportFinding(boardId: "board-b", kind: "footpad-disabled", severity: .critical, payloadJson: "{}")
    emits.removeAll()

    registry.emitSnapshot()

    XCTAssertEqual(Set(emits.map { $0.0 }), ["board-a", "board-b"])
  }
}
