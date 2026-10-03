import GRDB
import XCTest
@testable import VescapeCore

final class ManualBoardStopTests: XCTestCase {
  private var defaults: UserDefaults!

  override func setUp() {
    super.setUp()
    defaults = UserDefaults(suiteName: "ManualBoardStopTests")
    defaults.removePersistentDomain(forName: "ManualBoardStopTests")
  }

  override func tearDown() {
    defaults.removePersistentDomain(forName: "ManualBoardStopTests")
    defaults = nil
    super.tearDown()
  }

  func testRoutesActiveBoardStopOnceAndSuppressesAutoStart() {
    var activeBoardId: String? = "board-1"
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { activeBoardId },
      stop: {
        stopCount += 1
        activeBoardId = nil
        return true
      }
    )

    XCTAssertTrue(command.perform())
    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 1)
    XCTAssertTrue(ManualBoardStop.isAutoStartSuppressed(boardId: "board-1", defaults: defaults))
  }

  func testIdleStopDoesNothing() {
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { nil },
      stop: {
        stopCount += 1
        return true
      }
    )

    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 0)
    XCTAssertNil(defaults.string(forKey: ManualBoardStop.suppressedBoardKey))
  }

  func testStaleBoardIdDoesNotSuppressAutoStartWhenNoSessionStops() {
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { "stale-board" },
      stop: {
        stopCount += 1
        return false
      }
    )

    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 1)
    XCTAssertFalse(
      ManualBoardStop.isAutoStartSuppressed(boardId: "stale-board", defaults: defaults)
    )
  }

  /// The clear a Board Session start performs (`BoardSessionController.beginSession`, mirroring
  /// Android's `connectSelectedBoard`): after a manual stop followed by a real reconnect, the next
  /// launch auto-connects again instead of staying gated forever.
  func testSessionStartClearLetsTheNextLaunchAutoConnect() {
    var activeBoardId: String? = "board-1"
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { activeBoardId },
      stop: {
        activeBoardId = nil
        return true
      }
    )
    XCTAssertTrue(command.perform())
    XCTAssertEqual(
      AutoConnectGate.decide(
        settings: ["autoConnect": true, "selectedBoardId": "board-1"],
        suppressedBoardId: ManualBoardStop.suppressedBoardId(defaults: defaults),
        hasLiveSession: false,
        resumePending: false
      ),
      .skip(reason: "manual_stop_tombstone")
    )

    ManualBoardStop.clearAutoStartSuppression(defaults: defaults)

    XCTAssertEqual(
      AutoConnectGate.decide(
        settings: ["autoConnect": true, "selectedBoardId": "board-1"],
        suppressedBoardId: ManualBoardStop.suppressedBoardId(defaults: defaults),
        hasLiveSession: false,
        resumePending: false
      ),
      .connect(boardId: "board-1")
    )
  }

  func testClearAllowsAutoStartAgain() {
    defaults.set("board-1", forKey: ManualBoardStop.suppressedBoardKey)

    ManualBoardStop.clearAutoStartSuppression(defaults: defaults)

    XCTAssertFalse(ManualBoardStop.isAutoStartSuppressed(boardId: "board-1", defaults: defaults))
  }

  @MainActor
  func testWidgetStopAcrossConnectionPhasesIgnoresLateCallbacks() async throws {
    let queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    let appData = AppDataRepository.forTesting(dbWriter: queue)
    let boardId = "widget-stop-board"
    try appData.upsertBoard(["id": boardId, "name": "Stop test"])
    try appData.updateSetting("connectionSoundsEnabled", rawValue: false)
    let config = BoardConnectConfig(
      appBoardId: boardId, bleId: UUID().uuidString, name: "Stop test", transport: .direct,
      linkVersion: 4, hasBms: false, vescFirmwareVersion: nil, refloatVersion: nil,
      refloatBaseVersion: nil, pollIntervalMs: 100, batteryConfig: nil, liveHistoryLimitMinutes: 5
    )
    defer {
      SessionResumeStore.shared.clear()
      ManualBoardStop.clearAutoStartSuppression()
    }
    for phase: BoardPhase in [.connecting, .discovering, .subscribing, .waitingForTelemetry, .rescanning, .reconnecting] {
      let scheduler = TestScheduler()
      let controller = BoardSessionController(appData: appData, scheduler: scheduler, makeGatt: {
        VescGattClient(listener: $0, scheduler: $1)
      })
      controller.connect(config: config, onSuccess: {}, onError: { _, _ in })
      switch phase {
      case .discovering: controller.onGattConnected()
      case .subscribing: controller.onGattSubscribing()
      case .waitingForTelemetry: controller.onGattReady()
      case .rescanning, .reconnecting:
        controller.onGattDisconnected(intentional: false, message: "Board unavailable")
        if phase == .reconnecting { scheduler.advance(Int64(ReconnectPolicy.rescanWindowMs)) }
      default: break
      }
      XCTAssertEqual(controller.phase, phase)

      let stopped = await BoardSessionCommands.stopRide(controller: controller)
      XCTAssertTrue(stopped, "Stop rejected in \(phase)")
      XCTAssertEqual(controller.phase, .idle)
      XCTAssertNil(controller.connectedBoardId)
      XCTAssertNil(SessionResumeStore.shared.pending)
      XCTAssertTrue(ManualBoardStop.isAutoStartSuppressed(boardId: boardId))
      controller.onGattConnected()
      controller.onGattReady()
      controller.onGattDisconnected(intentional: false, message: "Late callback")
      scheduler.advance(60_000)
      XCTAssertEqual(controller.phase, .idle, "Stopped \(phase) session restarted")
    }
  }

  @MainActor
  func testWidgetStopCancelsPendingRestoration() async {
    let scheduler = TestScheduler()
    let controller = BoardSessionController(scheduler: scheduler, makeGatt: {
      // The unit-test runner has no bluetooth-central background entitlement. Use the real
      // client without OS restoration registration; drive the launch/restore callbacks ourselves.
      VescGattClient(listener: $0, scheduler: $1)
    })
    let boardId = "widget-stop-restoring"
    SessionResumeStore.shared.save(
      appBoardId: boardId, bleId: UUID().uuidString, recordingActive: false, recordingId: nil
    )
    defer {
      SessionResumeStore.shared.clear()
      ManualBoardStop.clearAutoStartSuppression()
    }
    controller.prepareForLaunch()

    let stopped = await BoardSessionCommands.stopRide(controller: controller)
    XCTAssertTrue(stopped)
    XCTAssertNil(SessionResumeStore.shared.pending)
    XCTAssertTrue(ManualBoardStop.isAutoStartSuppressed(boardId: boardId))
    XCTAssertEqual(scheduler.pendingCount, 0)
    controller.onGattRestored(peripheralIds: [])
    XCTAssertEqual(controller.phase, .idle)
    let stoppedAgain = await BoardSessionCommands.stopRide(controller: controller)
    XCTAssertFalse(stoppedAgain)
  }

  @MainActor
  func testStopCancelsConnectWaitingForBluetooth() {
    let listener = StopTestGattListener()
    let client = VescGattClient(listener: listener)
    let target = UUID()
    client.connect(peripheralId: target.uuidString)
    XCTAssertEqual(client.pendingConnectId, target)
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { "board-1" },
      stop: {
        client.disconnect()
        return true
      }
    )

    XCTAssertTrue(command.perform())
    XCTAssertNil(client.pendingConnectId, "Stop must cancel the connect deferred until Bluetooth powers on")
    let nextTarget = UUID()
    client.connect(peripheralId: nextTarget.uuidString)
    XCTAssertEqual(client.pendingConnectId, nextTarget)
    client.disconnect()
    XCTAssertNil(client.pendingConnectId)
  }
}

private final class StopTestGattListener: VescGattListener {
  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {}
  func onScanFailure(_ message: String) {}
  func onGattConnected() {}
  func onGattSubscribing() {}
  func onGattReady() {}
  func onGattDisconnected(intentional: Bool, message: String) {}
  func onGattFailure(code: String, message: String) {}
  func onGattFrameChunk(_ chunk: [UInt8]) {}
  func onGattRestored(peripheralIds: [String]) {}
}
