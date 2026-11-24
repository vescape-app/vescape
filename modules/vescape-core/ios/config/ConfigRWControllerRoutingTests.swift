import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/ConfigRWControllerRoutingTest.kt
final class ConfigRWControllerRoutingTests: XCTestCase {
  private let schemaXml = Array("""
    <CustomConfiguration>
      <params>
        <param name="kp" type="float" min="0" max="100" />
      </params>
    </CustomConfiguration>
    """.utf8)

  private let configBytes: [UInt8] = [0x41, 0x48, 0x00, 0x00]
  private let patchedBytes: [UInt8] = [0x42, 0x04, 0x00, 0x00]

  private let lightsEchoPayload: [UInt8] = [
    UInt8(COMM_CUSTOM_APP_DATA),
    UInt8(REFLOAT_MAGIC),
    UInt8(REFLOAT_LIGHTS_CONTROL),
    3,
  ]

  private let telemetryPayload: [UInt8] = {
    var bytes = Array(repeating: UInt8(0), count: 34)
    bytes[0] = UInt8(COMM_CUSTOM_APP_DATA)
    bytes[1] = UInt8(REFLOAT_MAGIC)
    bytes[2] = UInt8(REFLOAT_GET_ALLDATA)
    bytes[3] = 1
    return bytes
  }()

  private let infoPayload: [UInt8] = [
    UInt8(COMM_CUSTOM_APP_DATA),
    UInt8(REFLOAT_MAGIC),
    UInt8(REFLOAT_GET_INFO),
    12,
    1,
    0,
  ]

  func testTelemetryAndLightsCustomAppDataReachHandlersDuringReadAndWrite() {
    let sent = RoutingSentFrames()
    let controller = ConfigRWController()
    let conn = connection(transport: .direct, sent: sent)

    var readDone = false
    controller.consumeRead(
      connection: conn,
      onSuccess: { _ in readDone = true },
      onError: { code, message in XCTFail("read should not fail: \(code) \(message)") }
    )
    XCTAssertTrue(controller.isInFlight)
    XCTAssertFalse(controller.onPayload(telemetryPayload, connection: conn))
    XCTAssertNotNil(parseRefloatGetAllData(payload: telemetryPayload, avgLatency: nil, packetAt: 1, pullRateHz: nil))
    XCTAssertFalse(controller.onPayload(lightsEchoPayload, connection: conn))
    XCTAssertEqual(BoardLightsState(enabled: true, headlightsEnabled: true), parseLightsControlResponse(lightsEchoPayload))
    XCTAssertTrue(controller.onPayload(infoPayload, connection: conn))

    XCTAssertTrue(controller.onPayload(xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 0, chunk: schemaXml), connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: configBytes), connection: conn))
    XCTAssertTrue(readDone)

    var writeDone = false
    controller.consumeWrite(
      profileId: "profile-1",
      connection: conn,
      onSuccess: { _ in writeDone = true },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )
    XCTAssertTrue(controller.isInFlight)
    XCTAssertFalse(controller.onPayload(telemetryPayload, connection: conn))
    XCTAssertFalse(controller.onPayload(lightsEchoPayload, connection: conn))
    XCTAssertTrue(controller.onPayload(infoPayload, connection: conn))

    XCTAssertTrue(controller.onPayload(xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 0, chunk: schemaXml), connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: configBytes), connection: conn))
    controller.onRideState(BoardRideState(state: 0, switchState: 0, receivedAtMs: Int64(Date().timeIntervalSince1970 * 1000)), connection: conn)
    XCTAssertTrue(controller.onPayload([UInt8(COMM_SET_CUSTOM_CONFIG)], connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: patchedBytes), connection: conn))
    XCTAssertTrue(writeDone)
  }

  func testWrappedReplyForDifferentCanIdIsNotConsumedAndUnwrappedRepliesOnCanWork() {
    let sent = RoutingSentFrames()
    let controller = ConfigRWController()
    let conn = connection(transport: .can(7), sent: sent)

    var readDone = false
    controller.consumeRead(
      connection: conn,
      onSuccess: { _ in readDone = true },
      onError: { code, message in XCTFail("read should not fail: \(code) \(message)") }
    )
    XCTAssertFalse(controller.onPayload(xmlChunkPayload(canId: 9, totalLength: schemaXml.count, offset: 0, chunk: schemaXml), connection: conn))
    XCTAssertFalse(controller.onPayload(configPayload(canId: 9, bytes: configBytes), connection: conn))
    XCTAssertFalse(controller.onPayload([UInt8(COMM_FORWARD_CAN), 9] + infoPayload, connection: conn))
    XCTAssertTrue(controller.isInFlight)

    XCTAssertTrue(controller.onPayload(xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 0, chunk: schemaXml), connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: configBytes), connection: conn))
    XCTAssertTrue(readDone)
  }

  func testWrappedReplyOnDirectTransportIsNotConsumed() {
    let sent = RoutingSentFrames()
    let controller = ConfigRWController()
    let conn = connection(transport: .direct, sent: sent)

    controller.consumeRead(
      connection: conn,
      onSuccess: { _ in XCTFail("read should not complete from wrapped reply") },
      onError: { code, message in XCTFail("read should not fail: \(code) \(message)") }
    )
    XCTAssertFalse(controller.onPayload(xmlChunkPayload(canId: 7, totalLength: schemaXml.count, offset: 0, chunk: schemaXml), connection: conn))
    XCTAssertFalse(controller.onPayload(configPayload(canId: 7, bytes: configBytes), connection: conn))
    XCTAssertFalse(controller.onPayload([UInt8(COMM_FORWARD_CAN), 7] + infoPayload, connection: conn))
    XCTAssertTrue(controller.isInFlight)
  }

  func testWriteDetectsOutOfOrderAndDuplicateXmlChunksAndRetries() {
    let scheduler = TestScheduler()
    let sent = RoutingSentFrames()
    let controller = ConfigRWController(scheduler: scheduler)
    let conn = connection(transport: .direct, sent: sent)

    var writeDone = false
    controller.consumeWrite(
      profileId: "profile-1",
      connection: conn,
      onSuccess: { _ in writeDone = true },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )
    let firstChunk = xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 0, chunk: Array(schemaXml[0..<10]))
    let outOfOrderChunk = xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 20, chunk: Array(schemaXml[20...]))
    let secondChunk = xmlChunkPayload(canId: nil, totalLength: schemaXml.count, offset: 10, chunk: Array(schemaXml[10...]))

    XCTAssertTrue(controller.onPayload(firstChunk, connection: conn))
    let sentAfterFirst = sent.frames.count
    XCTAssertTrue(controller.onPayload(firstChunk, connection: conn))
    XCTAssertTrue(controller.onPayload(outOfOrderChunk, connection: conn))
    XCTAssertEqual(sentAfterFirst, sent.frames.count)

    scheduler.advance(10_000)
    XCTAssertEqual(sentAfterFirst + 1, sent.frames.count)
    XCTAssertTrue(controller.isInFlight)

    XCTAssertTrue(controller.onPayload(secondChunk, connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: configBytes), connection: conn))
    controller.onRideState(BoardRideState(state: 0, switchState: 0, receivedAtMs: Int64(Date().timeIntervalSince1970 * 1000)), connection: conn)
    XCTAssertTrue(controller.onPayload([UInt8(COMM_SET_CUSTOM_CONFIG)], connection: conn))
    XCTAssertTrue(controller.onPayload(configPayload(canId: nil, bytes: patchedBytes), connection: conn))
    XCTAssertTrue(writeDone)
  }

  func testWriteSchemaTimeoutRetriesOnceThenFails() {
    let scheduler = TestScheduler()
    let sent = RoutingSentFrames()
    let controller = ConfigRWController(scheduler: scheduler)
    let conn = connection(transport: .direct, sent: sent)

    var errors: [String] = []
    controller.consumeWrite(
      profileId: "profile-1",
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    scheduler.advance(10_000)
    XCTAssertTrue(errors.isEmpty)
    XCTAssertTrue(controller.isInFlight)

    scheduler.advance(10_000)
    XCTAssertEqual([RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT.rawValue], errors)
    XCTAssertFalse(controller.isInFlight)
  }

  private func connection(transport: BoardTransport, sent: RoutingSentFrames) -> ConfigRWConnection {
    ConfigRWConnection(
      phase: .connected,
      appBoardId: "board-1",
      transport: transport,
      fwVersion: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7",
      linkIntegrity: .trusted,
      boardConfigValues: nil,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { payload in sent.frames.append(payload); return true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in
        ["boardId": "board-1", "refloatBaseVersion": "3.0.7", "fields": ["kp": 33.0] as [String: Any]]
      },
      onBoardConfigValues: { _, _ in },
      demoteWriteBase: {},
      rideState: { BoardRideState(state: 0, switchState: 0, receivedAtMs: Int64(Date().timeIntervalSince1970 * 1000)) }
    )
  }

  private func xmlChunkPayload(canId: Int?, totalLength: Int, offset: Int, chunk: [UInt8]) -> [UInt8] {
    var body: [UInt8] = [UInt8(COMM_GET_CUSTOM_CONFIG_XML), 0]
    body.append(contentsOf: int32Bytes(totalLength))
    body.append(contentsOf: int32Bytes(offset))
    body.append(contentsOf: chunk)
    return canId.map { [UInt8(COMM_FORWARD_CAN), UInt8($0)] + body } ?? body
  }

  private func configPayload(canId: Int?, bytes: [UInt8]) -> [UInt8] {
    var body: [UInt8] = [UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0x12, 0x34, 0x56, 0x78]
    body.append(contentsOf: bytes)
    return canId.map { [UInt8(COMM_FORWARD_CAN), UInt8($0)] + body } ?? body
  }

  private func int32Bytes(_ value: Int) -> [UInt8] {
    [
      UInt8((value >> 24) & 0xff),
      UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff),
      UInt8(value & 0xff),
    ]
  }
}

private final class RoutingSentFrames {
  var frames: [[UInt8]] = []
}
