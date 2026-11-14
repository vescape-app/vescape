import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RiderSignalTest.kt
final class RiderSignalTests: XCTestCase {
  private let fix = (lat: 52.0, lng: 21.0)
  private let full: [String: Any] = ["kind": "wait", "lat": 1.0, "lng": 2.0, "startedAt": 1, "expiresAt": 2]

  func testARosterSignalParsesWithItsRelayTimes() {
    let signal = RiderSignal.parse(["kind": "down", "lat": 52.0, "lng": 21.0, "startedAt": 1_000, "expiresAt": 601_000])

    XCTAssertEqual(signal, RiderSignal(kind: .down, lat: 52.0, lng: 21.0, startedAt: 1_000, expiresAt: 601_000))
    XCTAssertEqual(signal?.toMap()["kind"] as? String, "down")
  }

  func testAnUnknownKindOrAMissingFieldIsNoSignal() {
    XCTAssertNil(RiderSignal.parse(full.merging(["kind": "fire"]) { $1 }))
    XCTAssertNil(RiderSignal.parse(full.filter { $0.key != "lng" }))
    XCTAssertNil(RiderSignal.parse(full.filter { $0.key != "expiresAt" }))
    XCTAssertNil(RiderSignal.parse(nil))
  }

  func testASendCarriesTheRecentFix() {
    let intent = RiderSignals.sendIntent(RiderSignalKind.down, RiderSignalContext(fix: fix, insidePrivacyZone: false))

    XCTAssertEqual(intent, .send(slot: .signal, kind: "down", lat: 52.0, lng: 21.0))
    let frame = intent?.frame()
    XCTAssertEqual(frame?["type"] as? String, "signal")
    XCTAssertEqual(frame?["kind"] as? String, "down")
  }

  func testASendIsRejectedWithoutARecentFix() {
    XCTAssertNil(RiderSignals.sendIntent(RiderSignalKind.down, RiderSignalContext(fix: nil, insidePrivacyZone: false)))
    XCTAssertNil(RiderSignals.sendIntent(RiderSignalKind.down, RiderSignalContext(fix: nil, insidePrivacyZone: true)))
  }

  func testClearIsABareSignalClearFrame() {
    XCTAssertEqual(RiderPinIntent.clear(.signal).frame() as? [String: String], ["type": "signal-clear"])
  }

  func testAHazardParsesInItsOwnKindsAndSendsAndClearsInItsOwnSlot() {
    let hazard: [String: Any] = ["kind": "terrain", "lat": 1.0, "lng": 2.0, "startedAt": 1, "expiresAt": 2]
    XCTAssertEqual(RideHazard.parse(hazard)?.kind, .terrain)
    XCTAssertNil(RiderSignal.parse(hazard))

    let frame = RiderSignals.sendIntent(RideHazardKind.terrain, RiderSignalContext(fix: fix, insidePrivacyZone: false))?.frame()
    XCTAssertEqual(frame?["type"] as? String, "hazard")
    XCTAssertEqual(frame?["kind"] as? String, "terrain")
    XCTAssertEqual(RiderPinIntent.clear(.hazard).frame() as? [String: String], ["type": "hazard-clear"])
  }
}
