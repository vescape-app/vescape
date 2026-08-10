import XCTest
@testable import VescapeCore

/// The stored form has to carry why there is no path, or a restart turns a rider's "no path here,
/// retry?" into a blank map with a pin on it.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/NavigationJsonTest.kt
final class NavigationStoreTests: XCTestCase {

  func testFailedNavigationSurvivesARoundTripWithNoPoints() {
    let failed = navigation(status: .noPathFound, points: [])

    let restored = NavigationJson.encode(failed).flatMap(NavigationJson.decode)

    XCTAssertEqual(restored?.status, .noPathFound)
    XCTAssertEqual(restored?.points.count, 0)
  }

  func testReadyNavigationKeepsItsPoints() {
    let ready = navigation(status: .ready, points: [(52.2, 21.0), (52.3, 21.1)])

    let restored = NavigationJson.encode(ready).flatMap(NavigationJson.decode)

    XCTAssertEqual(restored?.status, .ready)
    XCTAssertEqual(restored?.points.count, 2)
  }

  func testRowWrittenBeforeTheStatusExistedReadsAsReady() {
    let encoded = NavigationJson.encode(
      navigation(status: .ready, points: [(52.2, 21.0), (52.3, 21.1)])
    )
    guard
      let data = encoded?.data(using: .utf8),
      var stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return XCTFail("could not re-read the encoded row") }
    stored.removeValue(forKey: "status")
    guard
      let legacyData = try? JSONSerialization.data(withJSONObject: stored),
      let legacy = String(data: legacyData, encoding: .utf8)
    else { return XCTFail("could not rewrite the row without a status") }

    XCTAssertEqual(NavigationJson.decode(legacy)?.status, .ready)
  }

  func testReadyRowWithNoPointsIsAContradictionAndIsDropped() {
    let impossible = NavigationJson.encode(navigation(status: .ready, points: []))

    XCTAssertNil(impossible.flatMap(NavigationJson.decode))
  }

  private func navigation(
    status: NavigationStatus,
    points: [(latitude: Double, longitude: Double)]
  ) -> Navigation {
    Navigation(
      targetLatitude: 52.3,
      targetLongitude: 21.1,
      profile: .walking,
      computedAtMs: 1_700_000_000_000,
      status: status,
      distanceMeters: 1_234.5,
      durationSeconds: 678.9,
      points: points
    )
  }
}
