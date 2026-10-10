import XCTest
@testable import VescapeCore

/// The wrist's Group Ride: the course it holds, the page's rows (order, names, bearings, the one
/// status slot), the nav-focus label flag and the distance label.
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchGroupRideTest.kt
final class WatchGroupRideTests: XCTestCase {
  private func rider(
    _ id: String,
    northM: Double = 100,
    eastM: Double = 0,
    name: String? = nil,
    stale: Bool = false,
    batteryPercent: Int? = 60,
    batteryLevel: TelemetryLevel = .normal,
    heatLevel: TelemetryLevel = .normal
  ) -> GroupRideFrameRider {
    GroupRideFrameRider(
      id: id, name: name ?? id, colorArgb: 0, eastM: eastM, northM: northM, stale: stale,
      batteryPercent: batteryPercent, batteryLevel: batteryLevel, heatLevel: heatLevel
    )
  }

  private func group(_ riders: GroupRideFrameRider..., courseDeg: Double = 0) -> WatchGroupRide {
    WatchGroupRide(courseDeg: courseDeg, spanM: 600, riders: riders)
  }

  func testRowsRunNearestFirstTiesById() {
    let rows = group(
      rider("far", northM: 900),
      rider("b", northM: 50),
      rider("a", northM: 0, eastM: 50),
      rider("near", northM: 10)
    ).roster()

    XCTAssertEqual(rows.map(\.rider.id), ["near", "a", "b", "far"])
  }

  func testAloneIsAnEmptyRoster() {
    XCTAssertTrue(group().roster().isEmpty)
  }

  func testBearingIsRelativeToTheCourse() {
    // Riding east; the other Rider is due north, so on the left.
    let row = group(rider("a", northM: 100), courseDeg: 90).roster()[0]

    XCTAssertEqual(row.bearingDeg, 270, accuracy: 1e-9)
  }

  func testNamesAreCutToFiveCharactersWithoutSplittingAScalar() {
    let rows = group(
      rider("a", northM: 1, name: "Maksymilian"),
      rider("b", northM: 2, name: "🛹🛹🛹🛹🛹🛹"),
      rider("c", northM: 3, name: "Ola")
    ).roster()

    XCTAssertEqual(rows.map(\.name), ["Maksy", "🛹🛹🛹🛹🛹", "Ola"])
  }

  func testStaleReadsLostWhateverTheReadingsSay() {
    let status = groupRideStatus(rider("a", stale: true, batteryLevel: .critical, heatLevel: .critical))

    XCTAssertEqual(status, .stale)
  }

  func testHotOutranksALowBattery() {
    let status = groupRideStatus(rider("a", batteryPercent: 5, batteryLevel: .critical, heatLevel: .warning))

    XCTAssertEqual(status, .hot(.warning))
  }

  func testBatteryCarriesItsLevel() {
    let status = groupRideStatus(rider("a", batteryPercent: 25, batteryLevel: .warning))

    XCTAssertEqual(status, .battery(percent: 25, level: .warning))
  }

  func testNoBoardIsADashAndAHotRiderWithoutOneStillShowsTheThermometer() {
    XCTAssertEqual(groupRideStatus(rider("a", batteryPercent: nil)), .noBoard)
    XCTAssertEqual(groupRideStatus(rider("b", batteryPercent: nil, heatLevel: .critical)), .hot(.critical))
  }

  func testALabelFlagsHeatElseABatteryAboveNormalNeverAStaleRider() {
    XCTAssertEqual(
      groupRideLabelFlag(rider("a", batteryPercent: 5, batteryLevel: .critical, heatLevel: .warning)), .hot(.warning)
    )
    XCTAssertEqual(
      groupRideLabelFlag(rider("b", batteryPercent: 12, batteryLevel: .critical)), .battery(percent: 12, level: .critical)
    )
    XCTAssertNil(groupRideLabelFlag(rider("c", batteryPercent: 80)))
    XCTAssertNil(groupRideLabelFlag(rider("d", batteryPercent: nil)))
    XCTAssertNil(groupRideLabelFlag(rider("e", stale: true, heatLevel: .critical)))
  }

  func testTheWristKeepsTheLastCourseWhileFramesCarryNone() {
    let moving = WatchGroupRide.accepting(GroupRideFrame(courseDeg: 120, spanM: 600, riders: []), previous: nil)
    let stopped = WatchGroupRide.accepting(GroupRideFrame(courseDeg: nil, spanM: 600, riders: []), previous: moving)

    XCTAssertEqual(stopped.courseDeg, 120)
  }

  func testDistanceLabelsDropTheSpaceBeforeTheUnit() {
    XCTAssertEqual(groupRideDistanceLabel(680, unitSystem: "metric"), "680m")
    XCTAssertEqual(groupRideDistanceLabel(2_100, unitSystem: "metric"), "2.1km")
    XCTAssertEqual(groupRideDistanceLabel(2_100, unitSystem: "imperial"), "1.3mi")
  }
}
