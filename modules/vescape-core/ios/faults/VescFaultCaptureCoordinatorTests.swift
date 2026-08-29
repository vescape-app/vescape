import XCTest

@testable import VescapeCore

/// VESC Fault Capture window rules: a five-second pre-roll copied from the recent decoded window and
/// persisted at open, appends at the achieved response rate, a two-second post-clear tail bounded by
/// timestamps rather than sample counts, overlapping captures that intentionally duplicate samples,
/// and a session end that keeps what exists without fabricating a clear.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinatorTest.kt
final class VescFaultCaptureCoordinatorTests: XCTestCase {
  private final class FakeStore: VescFaultCaptureStoring {
    var captures: [String: VescFaultCapture] = [:]
    var samples: [String: [VescFaultCaptureSample]] = [:]
    var appendCalls = 0

    func upsertCapture(_ capture: VescFaultCapture) { captures[capture.occurrenceId] = capture }

    func appendSamples(_ occurrenceId: String, _ samples: [VescFaultCaptureSample]) {
      appendCalls += 1
      self.samples[occurrenceId, default: []].append(contentsOf: samples)
    }

    func getCapture(_ occurrenceId: String) -> VescFaultCapture? { captures[occurrenceId] }

    func getSamples(_ occurrenceId: String) -> [VescFaultCaptureSample] {
      samples[occurrenceId] ?? []
    }
  }

  private let board = "board-1"
  private let open: Int64 = 1_700_000_000_000
  private var store = FakeStore()
  private var coordinator: VescFaultCaptureCoordinator!

  override func setUp() {
    super.setUp()
    store = FakeStore()
    // `writeQueue: nil` persists inline so assertions observe the store without waiting.
    coordinator = VescFaultCaptureCoordinator(store: store, writeQueue: nil)
  }

  /// A decoded live-window row, as `LiveSeriesEmitter` shapes it.
  private func tick(_ atMs: Int64) -> [String: Any?] {
    ["lastPacketAt": atMs, "speed": 20.0, "dutyCycle": 0.5, "state": 4]
  }

  private func setWindow(_ ticks: [[String: Any?]]) {
    coordinator.recentWindow = { ticks }
  }

  @discardableResult
  private func feed(_ atMs: Int64) -> Bool {
    coordinator.observeSample(boardId: board, tick(atMs))
  }

  private func times(_ id: String) -> [Int64] {
    store.getSamples(id).map(\.capturedAtMs)
  }

  func testOpenPersistsExactlyTheFiveSecondsPrecedingDetection() {
    // 10s of live window at 100ms; only the last 5s belong to the capture.
    setWindow((0...100).map { tick(open - 10_000 + Int64($0) * 100) })

    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)

    XCTAssertEqual(times("occ").first, open - 5_000)
    XCTAssertEqual(times("occ").last, open)
    XCTAssertEqual(times("occ").count, 51)
    // Persisted before any append, so a process kill still leaves the run-up on disk.
    XCTAssertEqual(store.captures["occ"]?.sampleCount, 51)
    XCTAssertNil(store.captures["occ"]?.endedAtMs ?? nil)
  }

  func testCaptureOpensEmptyWhenNoLiveWindowIsWired() {
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)

    XCTAssertEqual(store.captures["occ"]?.sampleCount, 0)
    XCTAssertTrue(times("occ").isEmpty)
  }

  func testAppendsEveryReceivedSampleAtTheAchievedRate() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    // Deliberately irregular: response-paced polling, not a 30 Hz cadence.
    for offset: Int64 in [20, 25, 300, 900, 1_500] { feed(open + offset) }
    coordinator.flush()

    XCTAssertEqual(times("occ"), [20, 25, 300, 900, 1_500].map { open + $0 })
  }

  func testSamplesForAnotherBoardNeverEnterTheWindow() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    coordinator.observeSample(boardId: "other-board", tick(open + 100))
    coordinator.flush()

    XCTAssertTrue(times("occ").isEmpty)
  }

  func testTailKeepsTwoSecondsAfterClearThenRetiresTheWindow() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    feed(open + 500)
    coordinator.closeCapture(occurrenceId: "occ", clearedAtMs: open + 1_000)
    feed(open + 2_999)  // inside the tail
    feed(open + 3_000)  // exactly on the boundary, still inside
    feed(open + 3_001)  // past it: retires the window, and is not retained
    coordinator.flush()

    XCTAssertEqual(times("occ"), [500, 2_999, 3_000].map { open + $0 })
    XCTAssertEqual(store.captures["occ"]?.endedAtMs ?? nil, open + 3_000)
    XCTAssertEqual(store.captures["occ"]?.complete, true)

    // Retired: later samples cannot reopen it.
    feed(open + 4_000)
    coordinator.flush()
    XCTAssertEqual(times("occ").count, 3)
  }

  func testOverlappingCapturesDuplicateSamplesAndStayIndependent() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "a", boardId: board, openedAtMs: open)
    feed(open + 100)
    // Direct A-to-B code change: A starts its tail while B opens its own window.
    coordinator.closeCapture(occurrenceId: "a", clearedAtMs: open + 200)
    coordinator.flush()
    setWindow([tick(open + 100), tick(open + 200)])
    coordinator.openCapture(occurrenceId: "b", boardId: board, openedAtMs: open + 200)
    feed(open + 300)
    feed(open + 1_000)
    coordinator.flush()

    // The shared 300ms/1000ms samples belong to both captures.
    XCTAssertEqual(times("a"), [100, 300, 1_000].map { open + $0 })
    XCTAssertEqual(times("b"), [100, 200, 300, 1_000].map { open + $0 })
    // Still two separate windows with their own boundaries.
    XCTAssertEqual(store.captures["a"]?.startedAtMs, open - 5_000)
    XCTAssertEqual(store.captures["b"]?.startedAtMs, open - 4_800)
  }

  func testSessionEndKeepsEvidenceWithoutFabricatingAClear() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    feed(open + 400)
    coordinator.onSessionEnded(boardId: board)

    XCTAssertEqual(times("occ"), [open + 400])
    XCTAssertEqual(store.captures["occ"]?.endedAtMs ?? nil, open + 400)
    // Never complete: the controller never reported a clear, so no tail was observed.
    XCTAssertEqual(store.captures["occ"]?.complete, false)
  }

  func testSessionEndMidTailMarksTheCaptureIncomplete() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    coordinator.closeCapture(occurrenceId: "occ", clearedAtMs: open + 1_000)
    feed(open + 1_100)
    coordinator.onSessionEnded(boardId: board)

    XCTAssertEqual(store.captures["occ"]?.complete, false)
  }

  func testSessionEndOnlyFinalizesTheEndingBoard() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "mine", boardId: board, openedAtMs: open)
    coordinator.openCapture(occurrenceId: "theirs", boardId: "other-board", openedAtMs: open)
    coordinator.onSessionEnded(boardId: "other-board")
    feed(open + 100)
    coordinator.flush()

    XCTAssertEqual(times("mine"), [open + 100])
    XCTAssertNil(store.captures["mine"]?.endedAtMs ?? nil)
  }

  func testUntimestampedRowsAreNotPlacedInAWindow() {
    // A mode-69 fault frame carries no metric values and no packet time: it must not become a fake
    // all-zero sample. The occurrence timing carries the observation instead.
    setWindow([["speed": 0.0, "dutyCycle": 0.0]])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    XCTAssertFalse(coordinator.observeSample(boardId: board, ["speed": 0.0]))
    coordinator.flush()

    XCTAssertTrue(times("occ").isEmpty)
  }

  func testSamplingStaysMemoryOnlyUntilAWindowAsksForAFlush() {
    setWindow([])
    coordinator.openCapture(occurrenceId: "occ", boardId: board, openedAtMs: open)
    store.appendCalls = 0
    // Runs on the BLE hot path: buffered samples reach the database only through `flush`.
    XCTAssertFalse(feed(open + 10))
    XCTAssertEqual(store.appendCalls, 0)

    coordinator.flush()
    XCTAssertEqual(store.appendCalls, 1)
  }
}
