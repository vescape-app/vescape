import XCTest

@testable import VescapeCore

final class GpsCourseDeriverTests: XCTestCase {
  func testTrustsReportedBearingWhileMoving() {
    let deriver = GpsCourseDeriver()

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: 91.0, timestamp: 1_000
    )

    XCTAssertEqual(course, GpsCourse(bearingDeg: 91.0, sourceTimestamp: 1_000))
  }

  func testNormalizesReportedBearing() {
    let deriver = GpsCourseDeriver()

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: -90.0, timestamp: 1_000
    )

    XCTAssertEqual(course?.bearingDeg, 270.0)
  }

  func testIgnoresReportedBearingWhileStopped() {
    let deriver = GpsCourseDeriver()

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.2, bearingDeg: 91.0, timestamp: 1_000
    )

    XCTAssertNil(course)
  }

  func testDerivesCourseFromTwoFixesWithoutReportedBearing() throws {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: nil, timestamp: 1_000
    )

    // ~11 m due north.
    let course = deriver.derive(
      latitude: 52.0001, longitude: 21.0, speedMps: 5.0, bearingDeg: nil, timestamp: 2_000
    )

    XCTAssertEqual(try XCTUnwrap(course).bearingDeg, 0.0, accuracy: 0.5)
    XCTAssertEqual(course?.sourceTimestamp, 2_000)
  }

  func testDoesNotDeriveCourseBelowJitterFloor() {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: nil, timestamp: 1_000
    )

    // ~1 m apart.
    let course = deriver.derive(
      latitude: 52.00001, longitude: 21.0, speedMps: 5.0, bearingDeg: nil, timestamp: 2_000
    )

    XCTAssertNil(course)
  }

  func testRetainsCourseThroughStopInsideWindow() {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: 91.0, timestamp: 1_000
    )

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: 12.0, timestamp: 10_000
    )

    XCTAssertEqual(course, GpsCourse(bearingDeg: 91.0, sourceTimestamp: 1_000))
  }

  func testDropsRetainedCoursePastWindow() {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: 91.0, timestamp: 1_000
    )
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: 12.0, timestamp: 10_000
    )

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: 12.0, timestamp: 11_001
    )

    XCTAssertNil(course)
  }

  func testRetentionMeasuredFromSourceFix() {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: 91.0, timestamp: 1_000
    )
    // Held at 8 s: still inside the window, and must not refresh the source timestamp.
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: nil, timestamp: 9_000
    )

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: nil, timestamp: 15_000
    )

    XCTAssertNil(course)
  }

  func testResetDropsRetainedCourse() {
    let deriver = GpsCourseDeriver()
    _ = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 5.0, bearingDeg: 91.0, timestamp: 1_000
    )
    deriver.reset()

    let course = deriver.derive(
      latitude: 52.0, longitude: 21.0, speedMps: 0.0, bearingDeg: 12.0, timestamp: 2_000
    )

    XCTAssertNil(course)
  }
}
