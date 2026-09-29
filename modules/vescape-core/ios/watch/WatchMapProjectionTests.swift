import CoreGraphics
import XCTest
@testable import VescapeCore

/// Heading-up placement of Group Ride dots on a 400 pt face, 600 m across (the route's own fit).
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/GroupRidePlacementTest.kt
final class WatchMapProjectionTests: XCTestCase {
  private let size = CGSize(width: 400, height: 400)
  private let margin: CGFloat = 40
  private let drop = WatchMapProjection.riderDrop
  /// Points per metre at the default span.
  private var scale: CGFloat { (400 - WatchMapProjection.edgeInset) / 600 }

  private func map(courseDeg: Double = 0, spanM: Double? = 600) -> WatchMapProjection {
    WatchMapProjection(size: size, spanM: spanM, courseDeg: courseDeg)
  }

  func testARiderAheadOnTheCourseSitsStraightAboveTheRider() {
    // Riding east; the other Rider is 100 m east.
    let placed = map(courseDeg: 90).place(eastM: 100, northM: 0, margin: margin)

    XCTAssertEqual(placed.point.x, 200, accuracy: 0.01)
    XCTAssertEqual(placed.point.y, 200 + drop - 100 * scale, accuracy: 0.01)
    XCTAssertEqual(placed.direction.dx, 0, accuracy: 1e-6)
    XCTAssertEqual(placed.direction.dy, -1, accuracy: 1e-6)
    XCTAssertTrue(placed.inRange)
  }

  func testARiderToTheNorthWhileRidingEastIsOnTheLeft() {
    let placed = map(courseDeg: 90).place(eastM: 0, northM: 100, margin: margin)

    XCTAssertEqual(placed.point.x, 200 - 100 * scale, accuracy: 0.01)
    XCTAssertEqual(placed.point.y, 200 + drop, accuracy: 0.01)
    XCTAssertTrue(placed.inRange)
  }

  func testRangeIsMeasuredFromTheFaceCentreNotFromTheDroppedRider() {
    let aheadLimitM = Double((160 + drop) / scale)
    XCTAssertTrue(map().place(eastM: 0, northM: aheadLimitM - 1, margin: margin).inRange)
    XCTAssertFalse(map().place(eastM: 0, northM: aheadLimitM + 1, margin: margin).inRange)
    let behindLimitM = Double((160 - drop) / scale)
    XCTAssertTrue(map().place(eastM: 0, northM: -(behindLimitM - 1), margin: margin).inRange)
    XCTAssertFalse(map().place(eastM: 0, northM: -(behindLimitM + 1), margin: margin).inRange)
  }

  func testSpanFollowsThePhoneMapClampedLikeTheRoute() {
    let inset = WatchMapProjection.edgeInset
    XCTAssertEqual(
      map(spanM: 1_200).place(eastM: 0, northM: 300, margin: margin).point.y,
      200 + drop - 300 * (400 - inset) / 1_200, accuracy: 0.01
    )
    XCTAssertEqual(
      map(spanM: 10).place(eastM: 0, northM: 10, margin: margin).point.y,
      200 + drop - 10 * (400 - inset) / 150, accuracy: 0.01
    )
    XCTAssertEqual(
      map(spanM: nil).place(eastM: 0, northM: 50, margin: margin),
      map(spanM: 600).place(eastM: 0, northM: 50, margin: margin)
    )
  }

  func testRelativeBearingIsClockwiseFromTheCourse() {
    XCTAssertEqual(relativeBearingDeg(eastM: 0, northM: 10, courseDeg: 0), 0, accuracy: 1e-9)
    XCTAssertEqual(relativeBearingDeg(eastM: 0, northM: 10, courseDeg: 90), 270, accuracy: 1e-9)
    XCTAssertEqual(relativeBearingDeg(eastM: -10, northM: 0, courseDeg: 90), 180, accuracy: 1e-9)
  }

  func testTheWristKeepsTheLastCourseWhileFramesCarryNone() {
    let moving = WatchGroupRide.accepting(GroupRideFrame(courseDeg: 120, spanM: 600, riders: []), previous: nil)
    let stopped = WatchGroupRide.accepting(GroupRideFrame(courseDeg: nil, spanM: 600, riders: []), previous: moving)

    XCTAssertEqual(stopped.courseDeg, 120)
  }
}
