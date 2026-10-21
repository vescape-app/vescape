import XCTest
@testable import VescapeCore

/// The wrist map's eased zoom and course, which the route and the Group Ride marks both read.
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMapViewTest.kt
final class WatchMapViewTests: XCTestCase {
  func testVelocityContinuesAfterCorrectionAndExplicitResetIsHonored() {
    let model = GpsDisplayMotion(fromLatitude: 0, fromLongitude: 0, toLatitude: 0, toLongitude: 0,
      startsAtMs: 10_000, endsAtMs: 10_000, resetPosition: true,
      latitudePerMs: 0.01 / 110_574, velocityExpiresAtMs: 11_000)
    let anchor = WatchMapPosition(latitude: 0, longitude: 0)
    let motion = WatchMapMotion().retarget(anchor, at: Date(timeIntervalSince1970: 10.2), animate: true, displayMotion: model)
    XCTAssertEqual(motion.offset(at: Date(timeIntervalSince1970: 10.5)).northM, -5, accuracy: 0.001)
    XCTAssertEqual(motion.offset(at: Date(timeIntervalSince1970: 12)).northM, -10, accuracy: 0.001)
    XCTAssertEqual(motion.endsAt, Date(timeIntervalSince1970: 11))
  }

  func testDelayedRetargetAndExpiredSegmentKeepVisiblePositionContinuous() {
    let anchor = WatchMapPosition(latitude: 0, longitude: 0.001)
    let first = GpsDisplayMotion(fromLatitude: 0, fromLongitude: 0, toLatitude: 0,
      toLongitude: 0.001, startsAtMs: 10_000, endsAtMs: 11_000)
    let old = WatchMapMotion().retarget(anchor, at: Date(timeIntervalSince1970: 10), animate: true, displayMotion: first)
    let receipt = Date(timeIntervalSince1970: 10.7)
    let delayed = GpsDisplayMotion(fromLatitude: 0, fromLongitude: 0.0005, toLatitude: 0,
      toLongitude: 0.002, startsAtMs: 10_500, endsAtMs: 10_600)
    let next = old.retarget(anchor, at: receipt, animate: true, displayMotion: delayed)
    XCTAssertEqual(next.offset(at: receipt).eastM, old.offset(at: receipt).eastM, accuracy: 0.001)
    XCTAssertGreaterThan(next.endsAt, receipt)
  }

  func testNativeDisplaySegmentUsesOriginalClockWithoutAnotherEaseAndHoldsPrediction() {
    let segment = GpsDisplayMotion(fromLatitude: 0, fromLongitude: 0, toLatitude: 10 / 110_574,
      toLongitude: 0, startsAtMs: 10_000, endsAtMs: 11_000)
    let anchor = WatchMapPosition(latitude: 8 / 110_574, longitude: 0)
    // Received halfway through the original segment, with a 2m prediction beyond the measured fix.
    let motion = WatchMapMotion().retarget(anchor, at: Date(timeIntervalSince1970: 10.5),
      animate: true, displayMotion: segment)
    XCTAssertEqual(motion.offset(at: Date(timeIntervalSince1970: 10.5)).northM, 3, accuracy: 0.001)
    XCTAssertEqual(motion.offset(at: Date(timeIntervalSince1970: 11)).northM, -2, accuracy: 0.001)
    XCTAssertEqual(motion.offset(at: Date(timeIntervalSince1970: 99)).northM, -2, accuracy: 0.001)
    XCTAssertEqual(motion.endsAt, Date(timeIntervalSince1970: 11))
  }

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
  private func position(_ north: Double) -> WatchMapPosition {
    WatchMapPosition(latitude: north / 110_574, longitude: 0)
  }

  func testRouteAndTrailStayAlignedThroughoutAFixAndTipStaysPinned() {
    let motion = WatchMapMotion().retarget(position(0), at: at(-1), animate: true)
      .retarget(position(10), at: start, animate: true)
    let trail = [WatchTrailPoint(eastM: 0, northM: -30), WatchTrailPoint(eastM: 0, northM: -10), WatchTrailPoint(eastM: 0, northM: 0)]
    for time in [0.0, 0.075, 0.15, 0.225, 0.3] {
      let offset = motion.offset(at: at(time))
      let rendered = movingTrail(trail, offset: offset)
      XCTAssertEqual(-20 - (10 - offset.northM), rendered.first!.northM, accuracy: 0.0001)
      XCTAssertEqual(rendered.last, WatchTrailPoint(eastM: 0, northM: 0))
      XCTAssertTrue(rendered.allSatisfy { $0.northM <= 0 })
    }
    XCTAssertEqual(motion.offset(at: at(0.15)).northM, 5, accuracy: 0.0001)
  }

  func testNewFixMidAnimationPreservesCameraAndRepeatedTicksDoNotRestart() {
    let first = WatchMapMotion().retarget(position(0), at: at(-1), animate: true)
      .retarget(position(10), at: start, animate: true)
    let next = first.retarget(position(20), at: at(0.15), animate: true)
    XCTAssertEqual(next.offset(at: at(0.15)).northM, 15, accuracy: 0.0001)
    XCTAssertEqual(next, next.retarget(position(20), at: at(0.2), animate: true))
    XCTAssertEqual(next.offset(at: at(0.45)).northM, 0, accuracy: 0.0001)
    XCTAssertEqual(next.retarget(position(20), at: at(0.2), animate: false).offset(at: at(0.2)).northM, 0)
  }

  func testMissingFixResetsMotionAndFreshFixNeverFliesFromPreviousRide() {
    let moving = WatchMapMotion().retarget(position(0), at: at(-1), animate: true)
      .retarget(position(10), at: start, animate: true)
    let cleared = moving.retarget(nil, at: at(0.1), animate: true)
    XCTAssertEqual(cleared.offset(at: at(0.1)).northM, 0)
    XCTAssertEqual(cleared.retarget(position(1000), at: at(0.2), animate: true).offset(at: at(0.2)).northM, 0)
  }

  func testPositionAloneKeepsSharedMapClockRunningWithoutNavigation() {
    var map = WatchMapView(spanM: 600, courseDeg: nil)
    map.retarget(spanM: 600, courseDeg: nil, at: at(-1), animate: true, position: position(0))
    map.retarget(spanM: 600, courseDeg: nil, at: start, animate: true, position: position(10))
    XCTAssertEqual(map.settlesAt, at(0.3))
    XCTAssertEqual(map.motion.offset(at: at(0.15)).northM, 5, accuracy: 0.0001)
  }

  func testASampledUTurnNeverErasesRetainedHistoryDuringCameraMotion() {
    let trail = [-100.0, -50, -2, 0].map { WatchTrailPoint(eastM: $0, northM: 0) }
    for east in [-1.0, -0.5, -0.01, 0] {
      let rendered = movingTrail(trail, offset: WatchTrailPoint(eastM: east, northM: 0))
      XCTAssertEqual(rendered.count, trail.count)
      guard rendered.count == trail.count else { continue }
      for i in 0..<trail.count - 1 {
        XCTAssertEqual(rendered[i].eastM, trail[i].eastM + east, accuracy: 0.0001)
      }
      XCTAssertEqual(rendered.last, WatchTrailPoint(eastM: 0, northM: 0))
    }
  }

  func testOnlyThePendingDistanceAtTheTrailTipIsTrimmed() {
    let trail = [-100.0, -10, -2, -1, 0].map { WatchTrailPoint(eastM: $0, northM: 0) }
    let rendered = movingTrail(trail, offset: WatchTrailPoint(eastM: 3, northM: 0))
    XCTAssertEqual(rendered.map(\.eastM), [-97, -7, 0])
  }

}
