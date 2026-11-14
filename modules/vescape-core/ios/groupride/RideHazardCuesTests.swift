import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RideHazardCuesTest.kt
final class RideHazardCuesTests: XCTestCase {
  private var cues = RideHazardCues()

  private func hazard(_ kind: RideHazardKind, startedAt: Int64 = 1_000, metresSouth: Double = 0) -> RideHazard {
    RideHazard(kind: kind, lat: 50 - metresSouth / 111_195, lng: 19, startedAt: startedAt, expiresAt: startedAt + 600_000)
  }

  /// A fix `metres` south of the hazards.
  private func at(_ metres: Double) -> String? { cues.fix(lat: 50 - metres / 111_195, lng: 19) }

  func testCuesOnceWhenClosingInWithin30mNeverOnArrival() {
    cues.roster(["ola": hazard(.terrain)])

    XCTAssertNil(at(50))
    XCTAssertNil(at(35))
    XCTAssertEqual(at(28), "groupRide.hazard.terrain")
    XCTAssertNil(at(20))
    XCTAssertNil(at(5))
  }

  func testAFirstFixInsideTheRadiusOrJitterInPlaceStaysSilent() {
    cues.roster(["ola": hazard(.water)])

    XCTAssertNil(at(10))
    XCTAssertNil(at(9))
    XCTAssertNil(at(11))
    XCTAssertEqual(at(6), "groupRide.hazard.water")
  }

  func testAReplacedHazardIsANewPinAndCuesAgain() {
    cues.roster(["ola": hazard(.terrain)])
    _ = at(40)
    XCTAssertEqual(at(25), "groupRide.hazard.terrain")

    cues.roster(["ola": hazard(.obstacle, startedAt: 9_000)])
    _ = at(40)
    XCTAssertEqual(at(25), "groupRide.hazard.obstacle")
  }

  func testTheNearestOfTwoApproachedHazardsCuesFirstTheOtherOnTheNextFix() {
    cues.roster(["ola": hazard(.terrain), "kai": hazard(.police, metresSouth: 10)])
    _ = at(45)

    XCTAssertEqual(at(27), "groupRide.hazard.police")
    XCTAssertEqual(at(24), "groupRide.hazard.terrain")
  }

  func testResetForgetsEveryHazard() {
    cues.roster(["ola": hazard(.terrain)])
    _ = at(40)
    cues.reset()

    XCTAssertNil(at(25))
  }
}
