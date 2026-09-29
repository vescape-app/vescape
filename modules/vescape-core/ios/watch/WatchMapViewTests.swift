import XCTest
@testable import VescapeCore

/// The wrist map's eased zoom and course, which the route and the Group Ride marks both read.
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMapViewTest.kt
final class WatchMapViewTests: XCTestCase {
  private let start = Date(timeIntervalSinceReferenceDate: 1_000)

  private func at(_ seconds: TimeInterval) -> Date { start.addingTimeInterval(seconds) }

  func testACourseCrossingNorthTurnsTheShortWay() {
    var map = WatchMapView(spanM: 600, courseDeg: 350)
    map.retarget(spanM: 600, courseDeg: 10, at: start, animate: true)

    XCTAssertEqual(map.courseDeg(at: at(WatchMapView.turnEase / 2)), 360, accuracy: 0.001)
    XCTAssertEqual(map.courseDeg(at: at(WatchMapView.turnEase)), 370, accuracy: 0.001)
  }

  func testARetargetMidTurnStartsFromWhereTheMapIsDrawn() {
    var map = WatchMapView(spanM: 600, courseDeg: 0)
    map.retarget(spanM: 600, courseDeg: 90, at: start, animate: true)
    let midway = at(WatchMapView.turnEase / 2)
    map.retarget(spanM: 600, courseDeg: 0, at: midway, animate: true)

    XCTAssertEqual(map.courseDeg(at: midway), 45, accuracy: 0.001)
    XCTAssertEqual(map.courseDeg(at: midway.addingTimeInterval(WatchMapView.turnEase)), 0, accuracy: 0.001)
  }

  func testNoCourseHoldsTheLastOne() {
    var map = WatchMapView(spanM: 600, courseDeg: 120)
    map.retarget(spanM: 800, courseDeg: nil, at: start, animate: true)

    XCTAssertEqual(map.courseDeg(at: at(1)), 120)
    XCTAssertEqual(map.settlesAt, at(WatchMapView.zoomEase))
  }

  func testTheZoomEasesOnFastOutSlowInAndSettles() {
    var map = WatchMapView(spanM: 600, courseDeg: 0)
    map.retarget(spanM: 1_000, courseDeg: nil, at: start, animate: true)

    // Fast out: past three quarters of the way at half the time.
    XCTAssertEqual(map.spanM(at: at(WatchMapView.zoomEase / 2)), 910.2, accuracy: 0.5)
    XCTAssertEqual(map.spanM(at: at(WatchMapView.zoomEase)), 1_000)
    XCTAssertEqual(fastOutSlowIn(0.5), 0.7755, accuracy: 0.001)
  }

  func testWithoutAnimationTheMapLandsAtOnceAndNeverNeedsARedraw() {
    var map = WatchMapView(spanM: 600, courseDeg: 0)
    map.retarget(spanM: 300, courseDeg: 45, at: start, animate: false)

    XCTAssertEqual(map.spanM(at: start), 300)
    XCTAssertEqual(map.courseDeg(at: start), 45)
    XCTAssertLessThanOrEqual(map.settlesAt, start)
  }

  func testASnapMidEaseTowardsTheSameTargetLandsAtOnce() {
    var map = WatchMapView(spanM: 600, courseDeg: 0)
    map.retarget(spanM: 1_000, courseDeg: 90, at: start, animate: true)
    let midway = at(WatchMapView.turnEase / 2)
    map.retarget(spanM: 1_000, courseDeg: 90, at: midway, animate: false)

    XCTAssertEqual(map.spanM(at: midway), 1_000)
    XCTAssertEqual(map.courseDeg(at: midway), 90, accuracy: 0.001)
    XCTAssertLessThanOrEqual(map.settlesAt, midway)
  }

  func testShortestAngleDeltaHandlesUnwrappedCourses() {
    XCTAssertEqual(shortestAngleDelta(from: 359, to: 0), 1, accuracy: 0.001)
    XCTAssertEqual(shortestAngleDelta(from: 0, to: 359), -1, accuracy: 0.001)
    XCTAssertEqual(shortestAngleDelta(from: 719, to: 1), 2, accuracy: 0.001)
    XCTAssertEqual(shortestAngleDelta(from: -170, to: 170), -20, accuracy: 0.001)
  }
}
