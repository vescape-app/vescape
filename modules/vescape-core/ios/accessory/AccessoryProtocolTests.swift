import XCTest

@testable import VescapeCore

/// The discovery handshake contract, driven by
/// `shared/fixtures/accessory-protocol/handshake.json`: the exact `hello` line discovery writes, and
/// every manifest the parser must either accept with a compatibility verdict or refuse outright.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/AccessoryProtocolTest.kt
final class AccessoryProtocolTests: XCTestCase {
  private func fixture() throws -> [String: Any] { try AccessoryFixtures.load("handshake.json") }

  private func hello() throws -> [String: Any] {
    try XCTUnwrap(try fixture()["hello"] as? [String: Any])
  }

  func testHelloIsEncodedByteForByteAsTheFixturePinsIt() throws {
    let hello = try hello()
    let sessionId = try XCTUnwrap(hello["sessionId"] as? String)
    XCTAssertEqual(
      AccessoryProtocol.encodeHello(sessionId: sessionId),
      try XCTUnwrap(hello["line"] as? String)
    )
    XCTAssertEqual(
      try XCTUnwrap(hello["supportedVersions"] as? [Int]),
      AccessoryProtocol.supportedVersions
    )
  }

  func testRecognizedCapabilityTypesMatchTheSharedFixture() throws {
    let types = try XCTUnwrap(try fixture()["recognizedCapabilityTypes"] as? [String])
    XCTAssertEqual(
      Set(types),
      [AccessoryProtocol.typeGroundClearance, AccessoryProtocol.typeBrakeLight]
    )
  }

  func testEveryManifestCaseMatchesTheSharedFixture() throws {
    let sessionId = try XCTUnwrap(try hello()["sessionId"] as? String)
    let cases = try XCTUnwrap(try fixture()["cases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty, "fixture must carry cases")

    for entry in cases {
      let name = try XCTUnwrap(entry["name"] as? String)
      let result = AccessoryProtocol.parseManifest(
        line: try XCTUnwrap(entry["line"] as? String),
        sessionId: sessionId
      )

      if let expectedError = entry["error"] as? String {
        guard case .failed(let error) = result else {
          return XCTFail("\(name): expected rejection, got \(result)")
        }
        XCTAssertEqual(error.rawValue, expectedError, "\(name): error")
        continue
      }

      guard case .ok(let manifest) = result else {
        return XCTFail("\(name): expected a manifest, got \(result)")
      }
      try assertManifest(name, try XCTUnwrap(entry["expected"] as? [String: Any]), manifest)
    }
  }

  private func assertManifest(
    _ name: String,
    _ expected: [String: Any],
    _ actual: AccessoryManifest
  ) throws {
    XCTAssertEqual(expected["accessoryId"] as? String, actual.accessoryId, "\(name): accessoryId")
    XCTAssertEqual(expected["name"] as? String, actual.name, "\(name): name")
    XCTAssertEqual(
      expected["firmwareVersion"] as? String, actual.firmwareVersion, "\(name): firmwareVersion")
    XCTAssertEqual(
      expected["protocolVersion"] as? Int, actual.protocolVersion, "\(name): protocolVersion")
    XCTAssertEqual(
      try XCTUnwrap(expected["supportedVersions"] as? [Int]),
      actual.supportedVersions,
      "\(name): supportedVersions"
    )
    XCTAssertEqual(
      expected["compatibility"] as? String,
      actual.compatibility.rawValue,
      "\(name): compatibility"
    )

    let caps = try XCTUnwrap(expected["capabilities"] as? [[String: Any]])
    XCTAssertEqual(caps.count, actual.capabilities.count, "\(name): capability count")
    for (index, want) in caps.enumerated() where index < actual.capabilities.count {
      let got = actual.capabilities[index]
      XCTAssertEqual(want["id"] as? String, got.id, "\(name): capability \(index) id")
      XCTAssertEqual(want["type"] as? String, got.type, "\(name): capability \(index) type")
      XCTAssertEqual(
        want["supported"] as? Bool, got.supported, "\(name): capability \(index) supported")
      XCTAssertEqual(want["unit"] as? String, got.unit, "\(name): capability \(index) unit")
      XCTAssertEqual(
        want["rangeMin"] as? Double, got.rangeMin, "\(name): capability \(index) rangeMin")
      XCTAssertEqual(
        want["rangeMax"] as? Double, got.rangeMax, "\(name): capability \(index) rangeMax")
      XCTAssertEqual(
        try XCTUnwrap(want["ratesHz"] as? [Double]),
        got.ratesHz,
        "\(name): capability \(index) rates"
      )
    }
  }

  /// Discovery must not be able to speak past `hello`. There is one encoder on this path and it
  /// produces one message type; anything operational would have to be added here first.
  func testDiscoveryEncodesNothingButHello() throws {
    let sessionId = try XCTUnwrap(try hello()["sessionId"] as? String)
    let line = AccessoryProtocol.encodeHello(sessionId: sessionId)
    let object = try XCTUnwrap(
      try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
    )
    XCTAssertEqual(object["type"] as? String, "hello")
    XCTAssertEqual(object["requestId"] as? Int, AccessoryProtocol.helloRequestId)
    XCTAssertEqual(Set(object.keys), ["type", "requestId", "sessionId", "supportedVersions"])
  }
}
