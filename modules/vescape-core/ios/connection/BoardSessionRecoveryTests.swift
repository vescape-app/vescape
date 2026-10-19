import GRDB
import XCTest
@testable import VescapeCore

/// Drives the real session callbacks and watchdogs. Only the radio is replaced; time is virtual.
final class BoardSessionRecoveryTests: XCTestCase {
  private var scheduler: TestScheduler!
  private var radio: RecoveryTestTransport!
  private var controller: BoardSessionController!
  private var config: BoardConnectConfig!
  private let boardId = "recovery-test-board"
  private let bleId = "2AA724EF-104A-479A-A36F-004910FBD290"

  override func setUpWithError() throws {
    let queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    let repository = AppDataRepository.forTesting(dbWriter: queue)
    for key in ["connectionSoundsEnabled", "boardWarningsEnabled", "autoRecording", "vescFaultCollectionEnabled"] {
      try repository.updateSetting(key, rawValue: false)
    }
    try repository.upsertBoard([
      "id": boardId, "name": "Recovery test", "createdAt": Int64(1),
      "link": ["bleId": bleId, "transport": "direct"] as [String: Any?],
    ])
    scheduler = TestScheduler()
    radio = RecoveryTestTransport()
    controller = BoardSessionController(appData: repository, scheduler: scheduler, transport: radio)
    config = try XCTUnwrap(BoardConnectConfig.resolve(boardId: boardId, appData: repository))
    controller.connect(config: config, onSuccess: {}, onError: { _, _ in })
    XCTAssertEqual(controller.phase, .connecting)
    XCTAssertEqual(radio.connections, [bleId])
  }

  override func tearDown() {
    _ = controller?.stopBoard()
    controller = nil
    radio = nil
    scheduler = nil
    super.tearDown()
  }

  func testDropThenStalledDiscoveryStartsFreshConnection() {
    controller.onGattDisconnected(intentional: false, message: "out of range")
    controller.onGattConnected()
    scheduler.advance(1_999)
    XCTAssertEqual(radio.connections.count, 1)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections, [bleId, bleId])
  }

  func testDropThenStalledSubscriptionStartsFreshConnection() {
    controller.onGattDisconnected(intentional: false, message: "out of range")
    controller.onGattConnected()
    controller.onGattSubscribing()
    scheduler.advance(2_000)
    XCTAssertEqual(radio.connections, [bleId, bleId])
  }

  func testMissingFirstTelemetryResetsTheStillConnectedRadio() {
    ready()
    scheduler.advance(3_999)
    XCTAssertEqual(radio.connections.count, 1)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections, [bleId, bleId])
  }

  func testTelemetryLossResetsTheStillConnectedRadio() throws {
    ready()
    try receiveTelemetry()
    XCTAssertEqual(controller.phase, .connected)
    scheduler.advance(4_000)
    XCTAssertEqual(radio.connections, [bleId, bleId])
  }

  func testGattFailureRetriesAndCanReachTelemetryAgain() throws {
    ready()
    controller.onGattDisconnected(intentional: false, message: "out of range")
    controller.onGattConnected()
    controller.onGattFailure(code: "DISCOVERY_FAILED", message: "discovery interrupted")
    XCTAssertNotEqual(controller.phase, .error)
    XCTAssertEqual(radio.connections.count, 1)
    scheduler.advance(500)
    XCTAssertEqual(radio.connections, [bleId, bleId])
    ready()
    try receiveTelemetry()
    XCTAssertEqual(controller.phase, .connected)
  }

  func testConnectFailureRetries() {
    controller.onGattFailure(code: "CONNECT_FAILED", message: "temporary radio error")
    XCTAssertNotEqual(controller.phase, .error)
    scheduler.advance(499)
    XCTAssertEqual(radio.connections.count, 1)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections, [bleId, bleId])
  }

  func testRepeatedGattFailuresBackOffUntilTelemetryAndThenReset() throws {
    for (index, delay) in [500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500, 5_000, 5_000].enumerated() {
      controller.onGattConnected()
      controller.onGattFailure(code: "NO_CHAR", message: "missing characteristic")
      // Duplicate callbacks during the gap must not issue another connect or reset the delay.
      controller.onGattFailure(code: "DISCOVERY_FAILED", message: "duplicate callback")
      scheduler.advance(Int64(delay - 1))
      XCTAssertEqual(radio.connections.count, index + 1)
      scheduler.advance(1)
      XCTAssertEqual(radio.connections.count, index + 2)
    }
    ready()
    try receiveTelemetry()
    let attempts = radio.connections.count
    controller.onGattFailure(code: "CONNECT_FAILED", message: "new failure after recovery")
    scheduler.advance(499)
    XCTAssertEqual(radio.connections.count, attempts)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections.count, attempts + 1)
  }

  func testManualStopCancelsDelayedFailureRetry() {
    controller.onGattFailure(code: "CONNECT_FAILED", message: "temporary radio error")
    XCTAssertEqual(radio.connections.count, 1)
    XCTAssertTrue(controller.stopBoard())
    scheduler.advance(30_000)
    XCTAssertEqual(radio.connections.count, 1)
    XCTAssertEqual(controller.phase, .idle)
  }

  func testRepeatedHandshakeTimeoutsCanStillRecover() throws {
    for (index, deadlineMs) in [2_000, 4_000, 6_000, 6_000].enumerated() {
      controller.onGattConnected()
      controller.onGattSubscribing()
      scheduler.advance(Int64(deadlineMs - 1))
      XCTAssertEqual(radio.connections.count, index + 1)
      scheduler.advance(1)
      XCTAssertEqual(radio.connections.count, index + 2)
    }
    ready()
    try receiveTelemetry()
    XCTAssertEqual(controller.phase, .connected)
  }

  func testSlowerFallbackSucceedsOnRetryAndTelemetryResetsDeadline() throws {
    controller.onGattConnected()
    scheduler.advance(2_000)
    XCTAssertEqual(radio.connections.count, 2)
    controller.onGattConnected()
    scheduler.advance(1_200)
    controller.onGattSubscribing()
    scheduler.advance(1_000)
    XCTAssertEqual(radio.connections.count, 2, "The second deadline must allow the 2.2s fallback")
    controller.onGattReady()
    try receiveTelemetry()
    XCTAssertEqual(controller.phase, .connected)
    controller.onGattDisconnected(intentional: false, message: "out of range")
    controller.onGattConnected()
    scheduler.advance(1_999)
    XCTAssertEqual(radio.connections.count, 2)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections.count, 3, "A successful recovery resets the deadline to 2s")
  }

  func testNewSessionResetsLongerHandshakeDeadline() {
    controller.onGattConnected()
    scheduler.advance(2_000)
    controller.connect(config: config, onSuccess: {}, onError: { _, _ in })
    let attempts = radio.connections.count
    controller.onGattConnected()
    scheduler.advance(1_999)
    XCTAssertEqual(radio.connections.count, attempts)
    scheduler.advance(1)
    XCTAssertEqual(radio.connections.count, attempts + 1)
  }

  func testBluetoothOffSchedulesRecoverableRetry() {
    ready()
    controller.onGattFailure(code: "BLE_OFF", message: "Bluetooth is off")
    XCTAssertNotEqual(controller.phase, .error)
    scheduler.advance(500)
    XCTAssertEqual(radio.connections, [bleId, bleId])
    XCTAssertNotEqual(controller.phase, .connected, "A retry request alone cannot restore telemetry")
  }

  func testManualStopCancelsRecoveryAndLateCallbacks() {
    controller.onGattDisconnected(intentional: false, message: "out of range")
    controller.onGattConnected()
    controller.onGattSubscribing()
    XCTAssertTrue(controller.stopBoard())
    let attempts = radio.connections.count
    controller.onGattReady()
    controller.onGattFailure(code: "CONNECT_FAILED", message: "late failure")
    scheduler.advance(30_000)
    XCTAssertEqual(controller.phase, .idle)
    XCTAssertEqual(radio.connections.count, attempts)
  }

  func testInvalidIdentifierRemainsTerminal() {
    controller.onGattFailure(code: "INVALID_DEVICE", message: "invalid identifier")
    scheduler.advance(30_000)
    XCTAssertEqual(controller.phase, .error)
    XCTAssertEqual(radio.connections.count, 1)
  }

  private func ready() {
    controller.onGattConnected()
    controller.onGattSubscribing()
    controller.onGattReady()
    XCTAssertEqual(controller.phase, .waitingForTelemetry)
  }

  private func receiveTelemetry() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    let jsonl = try String(contentsOf: root.appendingPathComponent("shared/fixtures/replay-thor301.jsonl"), encoding: .utf8)
    for chunk in ReplayChunkDecoder.rxChunks(jsonl) {
      controller.onGattFrameChunk(chunk.bytes)
      if controller.phase == .connected { return }
    }
    XCTFail("Recorded board traffic must reach connected")
  }
}

private final class RecoveryTestTransport: SessionTransport {
  var supportsReconnect: Bool { true }
  var connections: [String] = []
  func connect(peripheralId: String) { connections.append(peripheralId) }
  func disconnect() {}
  func reconnect() {}
  func startReconnectScan() {}
  func stopReconnectScan() {}
  func sendPayload(_ payload: [UInt8]) -> Bool { true }
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool { true }
}
