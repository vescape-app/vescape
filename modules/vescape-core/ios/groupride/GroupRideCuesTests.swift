import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideCuesTest.kt
final class GroupRideCuesTests: XCTestCase {
  private var cues = GroupRideCues()

  private func roster(_ ids: String..., rideId: String = "ride") -> String? {
    cues.roster(rideId: rideId, riderIds: ids, ownRiderId: "me")
  }

  private func joined(with ids: String...) {
    XCTAssertEqual(cues.joined("ride"), "groupRide.joined")
    XCTAssertNil(cues.roster(rideId: "ride", riderIds: ids, ownRiderId: "me"))
  }

  func testTheFirstRosterAfterJoiningSeedsTheRideSilently() {
    joined(with: "me", "ola", "kai")

    XCTAssertNil(roster("me", "ola", "kai"))
  }

  func testANewRiderIdCuesRiderJoinedOneSeenEarlierInTheRideDoesNot() {
    joined(with: "me", "ola")

    XCTAssertEqual(roster("me", "ola", "kai"), "groupRide.riderJoined")
    XCTAssertEqual(roster("me", "ola"), "groupRide.riderLeft")
    XCTAssertNil(roster("me", "ola", "kai"))
  }

  func testARiderRemovedFromTheRosterCuesRiderLeftOnce() {
    joined(with: "me", "ola", "kai")

    XCTAssertEqual(roster("me", "ola"), "groupRide.riderLeft")
    XCTAssertNil(roster("me", "ola"))
  }

  func testANewRiderWinsOverOneLeavingInTheSameRoster() {
    joined(with: "me", "ola")

    XCTAssertEqual(roster("me", "kai"), "groupRide.riderJoined")
  }

  func testTheRidersOwnIdNeverCues() {
    joined(with: "ola")

    XCTAssertNil(roster("me", "ola"))
    XCTAssertNil(roster("ola"))
  }

  func testRostersOfAnotherRideAreIgnored() {
    joined(with: "me", "ola")

    XCTAssertNil(roster("me", "ola", "kai", rideId: "other"))
    XCTAssertEqual(roster("me", "ola", "kai"), "groupRide.riderJoined")
  }

  func testJoiningAnotherRideStartsItsSeenRidersOver() {
    joined(with: "me", "ola")
    XCTAssertEqual(cues.joined("other"), "groupRide.joined")
    XCTAssertNil(roster("me", rideId: "other"))

    XCTAssertEqual(roster("me", "ola", rideId: "other"), "groupRide.riderJoined")
  }

  func testADuplicateJoinedForTheJoinedRidePlaysNothing() {
    joined(with: "me")

    XCTAssertNil(cues.joined("ride"))
  }

  func testOwnDropAndRejoinWithinTheGracePlaysNothing() {
    joined(with: "me", "ola")

    XCTAssertTrue(cues.linkDropped())
    XCTAssertNil(cues.joined("ride"))
    XCTAssertNil(cues.graceElapsed())
  }

  func testALongerOutagePlaysOneLostThenRestoredOnRejoin() {
    joined(with: "me", "ola")

    XCTAssertTrue(cues.linkDropped())
    XCTAssertFalse(cues.linkDropped())
    XCTAssertEqual(cues.graceElapsed(), "groupRide.lost")
    XCTAssertNil(cues.graceElapsed())
    XCTAssertEqual(cues.joined("ride"), "groupRide.restored")
  }

  func testOurOwnReconnectCatchesUpOnTheRosterWithoutPeerCues() {
    joined(with: "me", "ola", "kai")
    _ = cues.linkDropped()
    XCTAssertNil(roster("me", "ola", "zoe"))
    XCTAssertNil(cues.joined("ride"))

    XCTAssertNil(roster("me", "ola", "zoe"))
    XCTAssertEqual(roster("me", "ola"), "groupRide.riderLeft")
    XCTAssertNil(roster("me", "ola", "zoe"))
  }

  func testResetCancelsAPendingLostAndForgetsTheRide() {
    joined(with: "me", "ola")
    _ = cues.linkDropped()
    cues.reset()

    XCTAssertNil(cues.graceElapsed())
    XCTAssertFalse(cues.linkDropped())
    XCTAssertEqual(cues.joined("ride"), "groupRide.joined")
  }
}
