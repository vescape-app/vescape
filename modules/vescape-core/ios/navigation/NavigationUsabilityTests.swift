import XCTest
@testable import VescapeCore

/// The forest case: Directions answers `200 OK` with a road detour to a target nothing can reach.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/NavigationUsabilityTest.kt
final class NavigationUsabilityTests: XCTestCase {
  private let riderLatitude = 52.2
  private let riderLongitude = 21.0
  private let targetLatitude = 52.3
  private let targetLongitude = 21.1

  func testPathRoughlyAsLongAsTheStraightLineIsUsable() {
    let points = [
      (latitude: riderLatitude, longitude: riderLongitude),
      (latitude: 52.25, longitude: 21.05),
      (latitude: targetLatitude, longitude: targetLongitude),
    ]

    XCTAssertTrue(
      NavigationUsability.isUsable(
        points, targetLatitude: targetLatitude, targetLongitude: targetLongitude
      )
    )
  }

  func testPathManyTimesTheStraightLineIsRejected() {
    let points = [
      (latitude: riderLatitude, longitude: riderLongitude),
      (latitude: riderLatitude + 0.5, longitude: riderLongitude),
      (latitude: targetLatitude, longitude: targetLongitude),
    ]

    XCTAssertFalse(
      NavigationUsability.isUsable(
        points, targetLatitude: targetLatitude, targetLongitude: targetLongitude
      )
    )
  }

  func testSinglePointIsNotAPath() {
    XCTAssertFalse(
      NavigationUsability.isUsable(
        [(latitude: riderLatitude, longitude: riderLongitude)],
        targetLatitude: targetLatitude,
        targetLongitude: targetLongitude
      )
    )
    XCTAssertFalse(
      NavigationUsability.isUsable(
        [], targetLatitude: targetLatitude, targetLongitude: targetLongitude
      )
    )
  }

  func testRatioIsNotAppliedToTargetsAFewStepsAway() {
    // ~11 m apart, where rounding one building is already a 10x "detour" and means nothing.
    let nearby = riderLatitude + 0.0001
    let points = [
      (latitude: riderLatitude, longitude: riderLongitude),
      (latitude: riderLatitude, longitude: riderLongitude + 0.0008),
      (latitude: nearby, longitude: riderLongitude),
    ]

    XCTAssertTrue(
      NavigationUsability.isUsable(
        points, targetLatitude: nearby, targetLongitude: riderLongitude
      )
    )
  }
}
