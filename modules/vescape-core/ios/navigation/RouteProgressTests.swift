import XCTest
@testable import VescapeCore

/// Route Progress is the number the rider reads while riding, so what matters is that it follows
/// the path rather than the crow: projecting between vertices, measuring along the line, and aiming
/// far enough ahead to be a direction rather than a jitter.
///
/// Paths here run along the equator so a degree of longitude is a flat ~111.19 km and the expected
/// metres can be read straight off the coordinates.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/RouteProgressTest.kt
final class RouteProgressTests: XCTestCase {
  private let metersPerDegree = 111_194.9
  private var legMeters: Double { 0.002 * metersPerDegree }

  /// 222 m east, then 222 m north. The corner is the only vertex between the ends.
  private let cornerPath: [(latitude: Double, longitude: Double)] = [
    (0.0, 0.0), (0.0, 0.002), (0.002, 0.002),
  ]

  /// One long straight run east with nothing between its ends — the sparse-vertex case.
  private let straightPath: [(latitude: Double, longitude: Double)] = [(0.0, 0.0), (0.0, 0.01)]

  func testProjectsOntoSegmentRatherThanNearestVertex() throws {
    // Halfway along a 1.1 km run with no vertex near: the nearest *vertex* is 550 m away.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: straightPath, riderLatitude: 0.0, riderLongitude: 0.005, speedMps: nil
      )
    )

    XCTAssertEqual(progress.latitude, 0.0, accuracy: 1e-9)
    XCTAssertEqual(progress.longitude, 0.005, accuracy: 1e-9)
  }

  func testRemainingDistanceIsMeasuredAlongThePathFromMidSegment() throws {
    // Standing 55 m north of the middle of the first leg: half of it is left, plus all of the
    // second. The straight line to the target would be ~250 m — the ride is 333 m.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath, riderLatitude: 0.0005, riderLongitude: 0.001, speedMps: nil
      )
    )

    XCTAssertEqual(progress.longitude, 0.001, accuracy: 1e-9)
    XCTAssertEqual(progress.remainingMeters, legMeters / 2 + legMeters, accuracy: 1.0)
  }

  func testRemainingDistanceReachesZeroAtTheDirectionPoint() throws {
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath, riderLatitude: 0.002, riderLongitude: 0.002, speedMps: nil
      )
    )

    XCTAssertEqual(progress.remainingMeters, 0, accuracy: 0.5)
  }

  func testAimPointFollowsThePathAroundACorner() throws {
    // 15 m before the corner with a 25 m aim: the aim lands past it, so the bearing is already
    // turning north while the target still lies north-east. 15 m east then 10 m north: atan2(15, 10).
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath,
        riderLatitude: 0.0,
        riderLongitude: 0.002 - 15.0 / metersPerDegree,
        speedMps: 10.0
      )
    )

    XCTAssertEqual(progress.bearingDeg, 56.3, accuracy: 2.0)
  }

  func testAimPointClampsToTheEndOfThePath() throws {
    // 5 m from the end with 15 m of aim: there is nothing further along to aim at, so the aim sits
    // on the Direction Point itself and the bearing is the last leg's, not zero or NaN.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath,
        riderLatitude: 0.002 - 5.0 / metersPerDegree,
        riderLongitude: 0.002,
        speedMps: nil
      )
    )

    XCTAssertEqual(progress.bearingDeg, 0, accuracy: 1.0)
  }

  func testStandingOnTheDirectionPointKeepsTheLastLegsHeading() throws {
    // Nothing is left to aim at, so the bearing has no aim point to come from. It must not fall out
    // as due north — the last leg ran north, and on the corner path that is the answer.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath, riderLatitude: 0.002, riderLongitude: 0.002, speedMps: nil
      )
    )

    XCTAssertEqual(progress.bearingDeg, 0, accuracy: 1.0)

    // Same path ridden the other way round: arriving westbound must not read as north either.
    let westward: [(latitude: Double, longitude: Double)] = [(0.0, 0.002), (0.0, 0.0)]
    let arrived = try XCTUnwrap(
      RouteProgress.compute(
        points: westward, riderLatitude: 0.0, riderLongitude: 0.0, speedMps: nil
      )
    )

    XCTAssertEqual(arrived.bearingDeg, 270, accuracy: 1.0)
  }

  func testAPathThatGoesNowhereStillYieldsABearing() throws {
    // Degenerate but not crashing: every point identical leaves no leg to take a heading from.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: [(0.0, 0.0), (0.0, 0.0)], riderLatitude: 0, riderLongitude: 0, speedMps: nil
      )
    )

    XCTAssertEqual(progress.bearingDeg, 0, accuracy: 1e-9)
    XCTAssertEqual(progress.remainingMeters, 0, accuracy: 1e-9)
  }

  func testAimDistanceFallsBackToItsFloorWithoutASpeed() {
    XCTAssertEqual(RouteProgress.aimDistanceMeters(nil), RouteProgress.minAimMeters)
    // A standing or crawling rider is on the floor too — 2.5 s of 2 m/s is only 5 m.
    XCTAssertEqual(RouteProgress.aimDistanceMeters(0), RouteProgress.minAimMeters)
    XCTAssertEqual(RouteProgress.aimDistanceMeters(2), RouteProgress.minAimMeters)
    XCTAssertEqual(RouteProgress.aimDistanceMeters(.nan), RouteProgress.minAimMeters)
  }

  func testAimDistanceScalesWithSpeedUpToItsCap() {
    XCTAssertEqual(RouteProgress.aimDistanceMeters(10), 25)
    // 2.5 s of 30 m/s would be 75 m, which is past the next turn on anything but a highway.
    XCTAssertEqual(RouteProgress.aimDistanceMeters(30), RouteProgress.maxAimMeters)
  }

  func testAPathWithNothingToProjectOntoHasNoProgress() {
    XCTAssertNil(
      RouteProgress.compute(points: [], riderLatitude: 0, riderLongitude: 0, speedMps: nil)
    )
    XCTAssertNil(
      RouteProgress.compute(
        points: [(0.0, 0.0)], riderLatitude: 0, riderLongitude: 0, speedMps: nil
      )
    )
  }

  func testARiderFarOffThePathStillAttaches() throws {
    // 5 km north of the line. There is no threshold to fall outside of: the projection is taken and
    // the remaining distance is measured from it like any other fix.
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: straightPath, riderLatitude: 0.045, riderLongitude: 0.005, speedMps: nil
      )
    )

    XCTAssertEqual(progress.latitude, 0.0, accuracy: 1e-9)
    XCTAssertEqual(progress.longitude, 0.005, accuracy: 1e-9)
  }
}
