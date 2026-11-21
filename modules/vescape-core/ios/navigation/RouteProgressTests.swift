import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/RouteProgressTest.kt
final class RouteProgressTests: XCTestCase {
  private let metersPerDegree = 111_194.9
  private var legMeters: Double { 0.002 * metersPerDegree }

  private let cornerPath: [(latitude: Double, longitude: Double)] = [
    (0.0, 0.0), (0.0, 0.002), (0.002, 0.002),
  ]

  private let straightPath: [(latitude: Double, longitude: Double)] = [(0.0, 0.0), (0.0, 0.01)]

  func testRemainingDurationShrinksWithProgressWithoutUsingRiderSpeed() throws {
    let length = GeoMath.distanceMeters(0, 0, 0, 0.01)
    func at(_ longitude: Double, speed: Double = 0) throws -> RouteProgress {
      try XCTUnwrap(RouteProgress.compute(points: straightPath, riderLatitude: 0,
        riderLongitude: longitude, speedMps: speed, routeDistanceMeters: length, routeDurationSeconds: 600))
    }
    XCTAssertEqual(try XCTUnwrap(at(0).remainingDurationSeconds), 600, accuracy: 0.01)
    XCTAssertEqual(try XCTUnwrap(at(0.005).remainingDurationSeconds), 300, accuracy: 0.01)
    XCTAssertEqual(try at(0.005, speed: 20).remainingDurationSeconds, try at(0.005).remainingDurationSeconds)
    XCTAssertEqual(try at(0.01).remainingDurationSeconds, 0)
    XCTAssertGreaterThan(try at(0.012).remainingMeters, 200)
    XCTAssertNil(try at(0.012).remainingDurationSeconds)
    XCTAssertNil(RouteProgress.compute(points: straightPath, riderLatitude: 0,
      riderLongitude: 0.005, speedMps: 0)?.remainingDurationSeconds)
  }

  func testSplitAndDeviationUseClampedNearestSegment() throws {
    let middle = try XCTUnwrap(RouteProgress.compute(points: straightPath,
      riderLatitude: 0.001, riderLongitude: 0.005, speedMps: nil))
    XCTAssertEqual(middle.segmentIndex, 0)
    XCTAssertEqual(middle.segmentFraction, 0.5, accuracy: 0.000001)
    XCTAssertEqual(middle.deviationMeters, 111.195, accuracy: 0.1)
    let end = try XCTUnwrap(RouteProgress.compute(points: straightPath,
      riderLatitude: 0, riderLongitude: 0.012, speedMps: nil))
    XCTAssertEqual(end.segmentFraction, 1)
    XCTAssertGreaterThan(end.remainingMeters, 200)
    let start = try XCTUnwrap(RouteProgress.compute(points: straightPath,
      riderLatitude: 0, riderLongitude: -0.001, speedMps: nil))
    XCTAssertEqual(start.segmentFraction, 0)
  }

  func testProjectsOntoSegmentRatherThanNearestVertex() throws {
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: straightPath, riderLatitude: 0.0, riderLongitude: 0.005, speedMps: nil
      )
    )

    XCTAssertEqual(progress.latitude, 0.0, accuracy: 1e-9)
    XCTAssertEqual(progress.longitude, 0.005, accuracy: 1e-9)
  }

  func testRemainingDistanceIsMeasuredAlongThePathFromMidSegment() throws {
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

  func testARiderWhoRodePastTheDirectionPointReadsTheStraightLineBackToIt() throws {
    let pastEnd = 0.002 + 300.0 / metersPerDegree
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath, riderLatitude: pastEnd, riderLongitude: 0.002, speedMps: 10
      )
    )

    XCTAssertEqual(progress.latitude, 0.002, accuracy: 1e-9)
    XCTAssertEqual(progress.remainingMeters, 300, accuracy: 1.0)
    XCTAssertEqual(progress.bearingDeg, 180, accuracy: 1.0)
  }

  func testAimPointFollowsThePathAroundACorner() throws {
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
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: cornerPath, riderLatitude: 0.002, riderLongitude: 0.002, speedMps: nil
      )
    )

    XCTAssertEqual(progress.bearingDeg, 0, accuracy: 1.0)

    let westward: [(latitude: Double, longitude: Double)] = [(0.0, 0.002), (0.0, 0.0)]
    let arrived = try XCTUnwrap(
      RouteProgress.compute(
        points: westward, riderLatitude: 0.0, riderLongitude: 0.0, speedMps: nil
      )
    )

    XCTAssertEqual(arrived.bearingDeg, 270, accuracy: 1.0)
  }

  func testAPathThatGoesNowhereStillYieldsABearing() throws {
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
    XCTAssertEqual(RouteProgress.aimDistanceMeters(0), RouteProgress.minAimMeters)
    XCTAssertEqual(RouteProgress.aimDistanceMeters(2), RouteProgress.minAimMeters)
    XCTAssertEqual(RouteProgress.aimDistanceMeters(.nan), RouteProgress.minAimMeters)
  }

  func testAimDistanceScalesWithSpeedUpToItsCap() {
    XCTAssertEqual(RouteProgress.aimDistanceMeters(10), 25)
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
    let progress = try XCTUnwrap(
      RouteProgress.compute(
        points: straightPath, riderLatitude: 0.045, riderLongitude: 0.005, speedMps: nil
      )
    )

    XCTAssertEqual(progress.latitude, 0.0, accuracy: 1e-9)
    XCTAssertEqual(progress.longitude, 0.005, accuracy: 1e-9)
  }
}
