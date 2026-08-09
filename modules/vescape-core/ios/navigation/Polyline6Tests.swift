import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/Polyline6Test.kt
final class Polyline6Tests: XCTestCase {
  private let tolerance = 1e-6

  private func assertPoints(
    _ expected: [(Double, Double)],
    _ actual: [(latitude: Double, longitude: Double)],
    line: UInt = #line
  ) {
    XCTAssertEqual(expected.count, actual.count, line: line)
    for (want, got) in zip(expected, actual) {
      XCTAssertEqual(want.0, got.latitude, accuracy: tolerance, line: line)
      XCTAssertEqual(want.1, got.longitude, accuracy: tolerance, line: line)
    }
  }

  func testDecodesCanonicalTwoPointFixtureAt1e6Precision() {
    // Same coordinate pair as the classic polyline5 example, encoded at polyline6 precision.
    assertPoints(
      [(38.5, -120.2), (40.7, -120.95)],
      Polyline6.decode("_izlhA~rlgdF_{geC~ywl@")
    )
  }

  func testDecodesMultiPointPathWithMixedSignDeltas() {
    assertPoints(
      [(52.237049, 21.017532), (52.237712, 21.018904), (52.238500, 21.016011)],
      Polyline6.decode("qnhsbBwzxag@mh@wtAgp@xsD")
    )
  }

  func testDecodingAt1e6DoesNotProduceTheTenTimesLarger1e5Reading() {
    // The precision trap: a 1e5 decoder would read the first point as 385.0 / -1202.0.
    let first = Polyline6.decode("_izlhA~rlgdF_{geC~ywl@")[0]
    XCTAssertTrue((-90.0...90.0).contains(first.latitude))
    XCTAssertTrue((-180.0...180.0).contains(first.longitude))
  }

  func testEmptyInputDecodesToNoPoints() {
    XCTAssertTrue(Polyline6.decode("").isEmpty)
  }

  func testBodyTruncatedMidValueKeepsWellFormedPrefix() {
    let full = "qnhsbBwzxag@mh@wtAgp@xsD"
    // Drops the final longitude delta, leaving a dangling latitude for the third point.
    let truncated = String(full.dropLast(4))

    let expected = Polyline6.decode(full).prefix(2).map { ($0.latitude, $0.longitude) }
    assertPoints(Array(expected), Polyline6.decode(truncated))
  }
}
