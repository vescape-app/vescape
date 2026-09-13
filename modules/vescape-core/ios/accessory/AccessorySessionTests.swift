import XCTest

@testable import VescapeCore

/// The operational session contract, driven by `shared/fixtures/accessory-protocol/session.json`:
/// the exact bytes of every command this app writes, and what each accessory line must mean to a
/// live session.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/AccessorySessionTest.kt
final class AccessorySessionTests: XCTestCase {
  private func fixture() throws -> [String: Any] { try AccessoryFixtures.load("session.json") }

  func testTimingDefaultsMatchTheSharedFixture() throws {
    let timing = try XCTUnwrap(fixture()["timing"] as? [String: Any])
    XCTAssertEqual(timing["leaseMs"] as? Int, AccessorySession.leaseMs)
    XCTAssertEqual(timing["renewIntervalMs"] as? Int, AccessorySession.renewIntervalMs)
    XCTAssertEqual(timing["requestTimeoutMs"] as? Int, AccessorySession.requestTimeoutMs)
    XCTAssertEqual(timing["handshakeTimeoutMs"] as? Int, AccessoryProtocol.handshakeTimeoutMs)
  }

  func testTheFirstCommandComesAfterTheHandshakeRequestId() throws {
    // The hello owns request id 1; an operational request that reused it would look to the
    // accessory like a duplicate handshake rather than a new command.
    let helloRequestId = try XCTUnwrap(fixture()["helloRequestId"] as? Int)
    XCTAssertEqual(helloRequestId + 1, AccessorySession.firstCommandRequestId)
  }

  func testEveryCommandIsEncodedByteForByteAsTheFixturePinsIt() throws {
    let json = try fixture()
    let sessionId = try XCTUnwrap(json["sessionId"] as? String)
    let cases = try XCTUnwrap(json["encode"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty, "fixture must carry encode cases")

    for entry in cases {
      let name = (entry["name"] as? String) ?? "?"
      let spec = try XCTUnwrap(entry["command"] as? [String: Any], name)
      let capabilityId = try XCTUnwrap(spec["capabilityId"] as? String, name)
      let command: AccessoryCommand
      switch spec["kind"] as? String {
      case "configure":
        command = .configure(
          capabilityId: capabilityId,
          enabled: try XCTUnwrap(spec["enabled"] as? Bool, name),
          rateHz: try XCTUnwrap((spec["rateHz"] as? NSNumber)?.doubleValue, name))
      case "state":
        command = .state(
          capabilityId: capabilityId,
          telemetry: try XCTUnwrap(spec["telemetry"] as? String, name),
          mode: spec["mode"] as? String,
          parked: try XCTUnwrap(spec["parked"] as? String, name),
          preview: (spec["preview"] as? Bool) == true)
      default:
        return XCTFail("unknown command kind in \(name)")
      }
      XCTAssertEqual(
        command.encode(sessionId: sessionId, requestId: try XCTUnwrap(entry["requestId"] as? Int)),
        entry["line"] as? String,
        name)
    }
  }

  func testEveryResponseCaseMatchesTheSharedFixture() throws {
    let json = try fixture()
    let sessionId = try XCTUnwrap(json["sessionId"] as? String)
    let cases = try XCTUnwrap(json["decode"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty, "fixture must carry decode cases")

    for entry in cases {
      let name = (entry["name"] as? String) ?? "?"
      let parsed = AccessoryResponse.parse(
        line: try XCTUnwrap(entry["line"] as? String, name), sessionId: sessionId)

      if (entry["malformed"] as? Bool) == true {
        XCTAssertEqual(parsed, .malformed, name)
        continue
      }
      if (entry["ignored"] as? Bool) == true {
        XCTAssertEqual(parsed, .ignored, name)
        continue
      }
      if let expected = entry["error"] as? [String: Any] {
        XCTAssertEqual(
          parsed,
          .failed(
            requestId: expected["requestId"] as? Int,
            code: try XCTUnwrap(expected["code"] as? String, name)),
          name)
        continue
      }

      let expected = try XCTUnwrap(entry["ack"] as? [String: Any], name)
      guard case .ack(let requestId, let capabilityId, let leaseMs, let applied) = parsed else {
        XCTFail("\(name): expected an ack, got \(parsed)")
        continue
      }
      XCTAssertEqual(requestId, expected["requestId"] as? Int, name)
      XCTAssertEqual(capabilityId, expected["capabilityId"] as? String, name)
      XCTAssertEqual(leaseMs, expected["leaseMs"] as? Int, name)
      // The applied values are compared as text so `20` and `20.0` cannot disagree across the two
      // platforms that have to read the same line.
      if let rate = expected["appliedRateHz"] as? Int {
        XCTAssertEqual(applied["rateHz"], String(rate), name)
      }
      if let enabled = expected["appliedEnabled"] as? Bool {
        XCTAssertEqual(applied["enabled"], enabled ? "true" : "false", name)
      }
      if let telemetry = expected["appliedTelemetry"] as? String {
        XCTAssertEqual(applied["telemetry"], telemetry, name)
      }
      if let parked = expected["appliedParked"] as? String {
        XCTAssertEqual(applied["parked"], parked, name)
      }
    }
  }

  func testMeasurementRatesResolveAgainstWhatTheHardwareDeclared() throws {
    let cases = try XCTUnwrap(fixture()["rateResolution"] as? [[String: Any]])
    for entry in cases {
      let name = (entry["name"] as? String) ?? "?"
      let rates = ((entry["ratesHz"] as? [NSNumber]) ?? []).map(\.doubleValue)
      let requested = try XCTUnwrap((entry["requested"] as? NSNumber)?.doubleValue, name)
      XCTAssertEqual(
        AccessorySession.resolveRateHz(requested: requested, ratesHz: rates),
        (entry["resolved"] as? NSNumber)?.doubleValue,
        name)
    }
  }

  func testACapabilityDeclaringNoRateIsNotConfigurable() {
    // Not a clamp to some default: a rate the hardware never offered is one this app invented, and
    // a sensor asked to run at it would be right to refuse.
    XCTAssertNil(AccessorySession.resolveRateHz(requested: 20, ratesHz: []))
    XCTAssertNil(AccessorySession.resolveRateHz(requested: 20, ratesHz: [0, -5, .nan]))
  }
}
