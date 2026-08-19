import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/BoardPresenceScanTest.kt
final class BoardPresenceScanTests: XCTestCase {
  /// Virtual-clock scheduler, mirroring Android's `TestScheduler`.
  private final class TestScheduler: PresenceScheduler {
    private final class Task {
      let dueAt: Int64
      let seq: Int
      let block: () -> Void
      var cancelled = false

      init(dueAt: Int64, seq: Int, block: @escaping () -> Void) {
        self.dueAt = dueAt
        self.seq = seq
        self.block = block
      }
    }

    private var tasks: [Task] = []
    private var seq = 0
    private(set) var currentTimeMs: Int64 = 0

    func post(_ block: @escaping () -> Void) {
      _ = postDelayed(0, block)
    }

    func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> () -> Void {
      seq += 1
      let task = Task(dueAt: currentTimeMs + delayMs, seq: seq, block: block)
      tasks.append(task)
      return { task.cancelled = true }
    }

    func advance(_ ms: Int64) {
      let target = currentTimeMs + ms
      while true {
        tasks.removeAll { $0.cancelled }
        let due = tasks.filter { $0.dueAt <= target }
          .sorted { ($0.dueAt, $0.seq) < ($1.dueAt, $1.seq) }
        guard let next = due.first else { break }
        tasks.removeAll { $0 === next }
        currentTimeMs = next.dueAt
        next.block()
      }
      currentTimeMs = target
    }
  }

  private final class FakePort: PresenceScanPort {
    var bluetooth = true
    var permission = true
    var available = true
    /// Delay between `startScan` and readiness, standing in for Bluetooth powering on.
    var readyDelayMs: Int64 = 0
    var startSucceeds = true
    var stopped = 0

    private let scheduler: TestScheduler
    private var observed: ((String, Int?) -> Void)?

    init(scheduler: TestScheduler) {
      self.scheduler = scheduler
    }

    func bluetoothEnabled() -> Bool { bluetooth }

    func scanPermissionGranted() -> Bool { permission }

    func scannerAvailable() -> Bool { available }

    func startScan(
      onReady: @escaping () -> Void,
      onObserved: @escaping (String, Int?) -> Void,
      onFailed: @escaping (String) -> Void
    ) -> Bool {
      guard startSucceeds else { return false }
      observed = onObserved
      _ = scheduler.postDelayed(readyDelayMs) { onReady() }
      return true
    }

    func stopScan() {
      stopped += 1
      observed = nil
    }

    func advertise(_ bleId: String, rssi: Int? = -60) {
      observed?(bleId, rssi)
    }
  }

  private final class Fixture {
    let scheduler = TestScheduler()
    let scanner = ScannerCoordinator()
    let ownership = ConnectionOwnership()
    let port: FakePort
    var promoted: [PresenceTarget] = []
    var autoConnect: Bool
    var paused: Int64?
    private(set) var scan: BoardPresenceScan!

    let targets = [
      PresenceTarget(boardId: "board-1", bleId: "AA:BB", name: "Mine", selected: true),
      PresenceTarget(boardId: "board-2", bleId: "CC:DD", name: "Other", selected: false),
    ]

    init(autoConnect: Bool = true, paused: Int64? = nil) {
      self.autoConnect = autoConnect
      self.paused = paused
      port = FakePort(scheduler: scheduler)
      scan = BoardPresenceScan(
        port: port,
        scanner: scanner,
        ownership: ownership,
        scheduler: scheduler,
        nowMs: { [unowned self] in self.scheduler.currentTimeMs },
        onPromote: { [unowned self] target in self.promoted.append(target) }
      )
    }

    func environment(
      sessionActive: Bool = false,
      activeScanPurpose: ScanPurpose? = nil
    ) -> PresenceScanEnvironment {
      PresenceScanEnvironment(
        linkedBoardCount: targets.count,
        selectedBoardId: "board-1",
        selectedBoardBleId: "AA:BB",
        bluetoothEnabled: port.bluetoothEnabled(),
        scanPermissionGranted: port.scanPermissionGranted(),
        scannerAvailable: port.scannerAvailable(),
        sessionActive: sessionActive,
        connectIntentActive: false,
        activeScanPurpose: activeScanPurpose
      )
    }

    @discardableResult
    func start(_ environment: PresenceScanEnvironment? = nil) -> PresenceScanDecision {
      scan.start(
        environment: environment ?? self.environment(),
        targets: targets,
        promotionInput: { [unowned self] in
          PresencePromotionInput(
            selectedObserved: true,
            autoConnectEnabled: self.autoConnect,
            pausedUntilMs: self.paused,
            nowMs: self.scheduler.currentTimeMs,
            sessionActive: false,
            currentOwner: self.ownership.current
          )
        }
      )
    }
  }

  func testFiveSecondDeadlineStartsAfterBluetoothIsReady() {
    let fixture = Fixture()
    fixture.port.readyDelayMs = 3_000

    fixture.start()
    XCTAssertEqual(.waitingForBluetooth, fixture.scan.state.phase)
    XCTAssertNil(fixture.scan.state.deadlineAtMs)

    fixture.scheduler.advance(3_000)
    XCTAssertEqual(.scanning, fixture.scan.state.phase)
    XCTAssertEqual(8_000, fixture.scan.state.deadlineAtMs)

    // 4.9s after readiness — 7.9s after foreground entry — the scan is still looking.
    fixture.scheduler.advance(4_900)
    XCTAssertEqual(.scanning, fixture.scan.state.phase)

    fixture.scheduler.advance(100)
    XCTAssertEqual(.done, fixture.scan.state.phase)
    XCTAssertEqual(ConnectionTraceReason.boardNotPresent, fixture.scan.state.reason)
  }

  func testObservedSelectedBoardPromotesIntoASession() {
    let fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0)

    XCTAssertEqual(["board-1"], fixture.promoted.map { $0.boardId })
    XCTAssertEqual(ConnectionOwner.boardSession, fixture.ownership.current)
    XCTAssertEqual(1, fixture.port.stopped)
  }

  func testNonSelectedBoardIsObservedButNeverConnected() {
    let fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0)

    fixture.port.advertise("CC:DD", rssi: -71)
    fixture.scheduler.advance(0)

    XCTAssertEqual(1, fixture.scan.state.observations.count)
    let observation = fixture.scan.state.observations[0]
    XCTAssertEqual("board-2", observation.boardId)
    XCTAssertFalse(observation.selected)
    XCTAssertEqual(-71, observation.rssi)
    XCTAssertTrue(fixture.promoted.isEmpty)
    XCTAssertTrue(fixture.scan.isRunning)
  }

  func testMatchDoesNotPromoteWhileAutoConnectIsOff() {
    let fixture = Fixture(autoConnect: false)
    fixture.start()
    fixture.scheduler.advance(0)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0)

    XCTAssertTrue(fixture.promoted.isEmpty)
    XCTAssertEqual(ConnectionTraceReason.autoConnectDisabled, fixture.scan.state.reason)
    XCTAssertEqual("board-1", fixture.scan.state.observations.first?.boardId)
    XCTAssertEqual(ConnectionOwner.none, fixture.ownership.current)
  }

  func testMatchDoesNotPromoteWhileTheBoardIsPaused() {
    let fixture = Fixture(paused: 60_000)
    fixture.start()
    fixture.scheduler.advance(0)

    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0)

    XCTAssertTrue(fixture.promoted.isEmpty)
    XCTAssertEqual(ConnectionTraceReason.connectionPaused, fixture.scan.state.reason)
  }

  func testRefusesToStartWhileAnExclusiveScannerOwnerRuns() {
    let fixture = Fixture()

    let decision = fixture.start(fixture.environment(activeScanPurpose: .addBoard))

    XCTAssertFalse(decision.proceed)
    XCTAssertEqual(ConnectionTraceReason.scannerBusy, decision.reason)
    XCTAssertFalse(fixture.scan.isRunning)
  }

  func testRefusesToStartWhileASessionIsAlreadyActive() {
    let fixture = Fixture()

    let decision = fixture.start(fixture.environment(sessionActive: true))

    XCTAssertEqual(ConnectionTraceDecision.skipped, decision.decision)
    XCTAssertEqual(ConnectionTraceReason.sessionAlreadyActive, decision.reason)
  }

  func testStaleCallbacksAfterCancellationAreDropped() {
    let fixture = Fixture()
    fixture.start()
    fixture.scheduler.advance(0)

    fixture.scan.cancel(reason: ConnectionTraceReason.stopSearch)
    fixture.port.advertise("AA:BB")
    fixture.scheduler.advance(0)

    XCTAssertTrue(fixture.promoted.isEmpty)
    XCTAssertTrue(fixture.scan.state.observations.isEmpty)
    XCTAssertEqual(ConnectionTraceReason.stopSearch, fixture.scan.state.reason)
    XCTAssertEqual(ConnectionOwner.none, fixture.ownership.current)
  }

  func testAFailedScanStartIsNamedNotSilent() {
    let fixture = Fixture()
    fixture.port.startSucceeds = false

    let decision = fixture.start()

    XCTAssertFalse(decision.proceed)
    XCTAssertEqual(ConnectionTraceReason.scannerUnavailable, decision.reason)
    XCTAssertFalse(fixture.scan.isRunning)
    XCTAssertEqual(ConnectionOwner.none, fixture.ownership.current)
  }
}
