import XCTest
@testable import VescapeCore

/// Trust session config on write (#396): a push backed by the session's `fresh` Board Config Values
/// patches the retained bytes and goes straight to `COMM_SET_CUSTOM_CONFIG`. Provisional values or
/// none at all still read the board first.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/ConfigRWFsmWriteBaseTest.kt
final class ConfigRWControllerWriteBaseTests: XCTestCase {
  func testFreshValuesWriteWithoutReadingFirst() {
    let sent = SentFrames()
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )

    XCTAssertFalse(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG })
    XCTAssertTrue(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testWriteKeepsBytesOutsideTheProfileFields() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    let values = fresh()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(values, sent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )

    // The set frame carries the retained blob with only `tuned` patched; `untouched` survives.
    let base = values.writeBase!
    guard let setFrame = sent.frames.first(where: { command($0) == COMM_SET_CUSTOM_CONFIG }) else {
      return XCTFail("no set frame sent")
    }
    let payload = Array(setFrame.suffix(base.rawConfig.count))
    XCTAssertEqual(payload.count, base.rawConfig.count)
    XCTAssertEqual(Array(setFrame[2..<6]), [0xDE, 0xAD, 0xBE, 0xEF], "signature must come from the retained bytes")
    XCTAssertEqual(Array(payload[4..<8]), Array(base.rawConfig[4..<8]), "untouched field must survive")
    XCTAssertNotEqual(Array(payload[0..<4]), Array(base.rawConfig[0..<4]), "tuned field must change")
  }

  func testProvisionalValuesReadBeforeWriting() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    let lastKnown = BoardConfigValues.lastKnown(
      boardId: "board-1",
      refloatBaseVersion: "3.0.7",
      capturedAtMs: 0,
      valuesJson: "{\"tuned\":1.0}"
    )

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(lastKnown, sent),
      onSuccess: { _ in },
      onError: { _, _ in }
    )

    XCTAssertTrue(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testNoValuesReadBeforeWriting() {
    let sent = SentFrames()
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(nil, sent),
      onSuccess: { _ in },
      onError: { _, _ in }
    )

    XCTAssertTrue(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testUntrustedLinkStillRejectsEvenWithFreshValues() {
    let sent = SentFrames()
    var errors: [String] = []
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent, linkIntegrity: .outdated),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )

    XCTAssertEqual(errors, [RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue])
    XCTAssertEqual(sent.frames.count, 0)
  }

  func testLinkDropDemotesFreshValuesSoTheyCannotBackAWrite() {
    let demoted = fresh().demotedToProvisional()

    XCTAssertEqual(demoted.freshness, .lastKnown)
    XCTAssertNil(demoted.writeBase)
    XCTAssertEqual(demoted.number("untouched"), 42.0)
  }

  // MARK: - Fixtures

  private func schema() -> RefloatConfigSchema {
    RefloatConfigSchema(
      hash: "test",
      fields: [
        RefloatConfigSchemaField(id: "tuned", type: .float32, label: "tuned", unit: nil, min: nil, max: nil, offset: 0, scale: nil),
        RefloatConfigSchemaField(id: "untouched", type: .float32, label: "untouched", unit: nil, min: nil, max: nil, offset: 4, scale: nil),
      ]
    )
  }

  private func fresh() -> BoardConfigValues {
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x42, 0x28, 0x00, 0x00]
    return BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "3.0.7",
      capturedAtMs: 1,
      freshness: .fresh,
      values: ["tuned": 1.0, "untouched": 42.0],
      writeBase: BoardConfigWriteBase(schema: schema(), rawConfig: raw, packageSignature: 0xDEAD_BEEF)
    )
  }

  private func command(_ payload: [UInt8]) -> Int? {
    guard let first = payload.first else { return nil }
    if Int(first) == COMM_FORWARD_CAN, payload.count >= 3 { return Int(payload[2]) }
    return Int(first)
  }

  private func connection(
    _ values: BoardConfigValues?,
    _ sent: SentFrames,
    linkIntegrity: LinkIntegrity = .trusted
  ) -> ConfigRWConnection {
    ConfigRWConnection(
      phase: .connected,
      appBoardId: "board-1",
      transport: .direct,
      fwVersion: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7",
      linkIntegrity: linkIntegrity,
      boardConfigValues: values,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { payload in sent.frames.append(payload); return true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in
        ["boardId": "board-1", "refloatBaseVersion": "3.0.7", "fields": ["tuned": 7.0] as [String: Any]]
      },
      onBoardConfigValues: { _, _ in }
    )
  }
}

/// Frames the controller handed to the transport, in send order.
private final class SentFrames {
  var frames: [[UInt8]] = []
}
