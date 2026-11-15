import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideObserverTest.kt
final class GroupRideObserverTests: XCTestCase {
  func testASignalGoesOutWithAFixInsideAPrivacyZoneWhilePresenceStaysSuppressed() throws {
    let fix = TelemetryLocationCapture(
      latitude: 52, longitude: 21, speedMps: nil, bearingDeg: nil, accuracyM: 5, altitudeM: nil,
      timestamp: 1_000, precise: true
    )
    var zones = PrivacyZoneReadState()

    // Zones still loading: presence is gated, a signal is not.
    XCTAssertNil(zones.presenceFix(fix))
    var context = zones.signalContext(fix, nowMs: 2_000)
    XCTAssertNotNil(RiderSignals.sendIntent(RiderSignalKind(rawValue: "down")!, context))

    // Loaded, and the fix is inside one.
    try zones.reload {
      [PrivacyZoneEntity(id: "home", enabled: true, centerLatitudeE7: 520_000_000, centerLongitudeE7: 210_000_000, radiusMeters: 200)]
    }
    XCTAssertNil(zones.presenceFix(fix))
    context = zones.signalContext(fix, nowMs: 2_000)
    XCTAssertTrue(context.insidePrivacyZone)
    XCTAssertNotNil(RiderSignals.sendIntent(RiderSignalKind(rawValue: "down")!, context))

    // The gate opens again outside every zone.
    let outside = TelemetryLocationCapture(
      latitude: 53, longitude: 21, speedMps: nil, bearingDeg: nil, accuracyM: 5, altitudeM: nil,
      timestamp: 1_000, precise: true
    )
    XCTAssertNotNil(zones.presenceFix(outside))
  }

  private func rider(presence: [String: Any]?) -> GroupRideRosterRider? {
    GroupRideObserver.rosterRider(["id": "ola", "presence": GroupRideObserver.presenceMap(presence)])
  }

  func testAPresenceWithBothCoordinatesPlacesTheRider() {
    let position = rider(presence: ["lat": 52.0, "lng": 21.0])?.position

    XCTAssertEqual(position?.latitude, 52.0)
    XCTAssertEqual(position?.longitude, 21.0)
  }

  func testAPresenceMissingACoordinateLeavesTheRiderUnplacedNotAtZeroZero() {
    XCTAssertNil(GroupRideObserver.presenceMap(["lat": 52.0, "soc": 80.0]))
    XCTAssertNil(rider(presence: ["lat": 52.0])?.position)
    XCTAssertNil(rider(presence: ["lng": 21.0])?.position)
    XCTAssertNotNil(rider(presence: ["lng": 21.0]))
  }

  func testNoPresenceLeavesTheRiderUnplaced() {
    XCTAssertNil(rider(presence: nil)?.position)
  }

}
