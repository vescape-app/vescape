import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchUnitsTest.kt
final class WatchUnitsTests: XCTestCase {
  func testDistanceFixturesMatchPhoneAndWear() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    let data = try Data(contentsOf: root.appendingPathComponent("shared/fixtures/rider-units.json"))
    let fixtures = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    for fixture in fixtures {
      for units in ["metric", "imperial"] {
        XCTAssertEqual(WatchGauge.distance(fixture["meters"] as! Double, unitSystem: units), fixture[units] as? String)
      }
    }
    XCTAssertEqual(WatchGauge.distance(.nan, unitSystem: "imperial"), WatchGauge.dash)
    XCTAssertEqual(UnitPresentation.speedFromKmh(40.2336, "imperial"), 25, accuracy: 1e-10)
    XCTAssertEqual(WatchGauge.speedFraction(40.2336), 40.2336 / WatchGauge.speedMax)
  }
}
