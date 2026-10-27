import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideObserverTest.kt
final class GroupRideObserverTests: XCTestCase {
  private func rider(presence: [String: Any]?) -> GroupRideRosterRider? {
    GroupRideObserver.rosterRider(["id": "ola", "presence": GroupRideObserver.presenceMap(presence)])
  }

  func testAPresenceWithBothCoordinatesPlacesTheRider() {
    let position = rider(presence: ["lat": 52.0, "lng": 21.0])?.position

    XCTAssertEqual(position?.latitude, 52.0)
    XCTAssertEqual(position?.longitude, 21.0)
  }

  func testAPresenceMissingACoordinateLeavesTheRiderUnplacedNotAtZeroZero() {
    XCTAssertNil(GroupRideObserver.presenceMap(["lat": 52.0, "soc": 80.0]))
    XCTAssertNil(rider(presence: ["lat": 52.0])?.position)
    XCTAssertNil(rider(presence: ["lng": 21.0])?.position)
    XCTAssertNotNil(rider(presence: ["lng": 21.0]))
  }

  func testNoPresenceLeavesTheRiderUnplaced() {
    XCTAssertNil(rider(presence: nil)?.position)
  }

  func testRosterChangesCueOtherRidersJoiningBeforeLeavingNeverTheRider() {
    let cue = GroupRideObserver.rosterCue
    XCTAssertNil(cue([], ["me", "ola"], "me"))
    XCTAssertEqual(cue(["me"], ["me", "ola"], "me"), "groupRide.riderJoined")
    XCTAssertEqual(cue(["me", "ola"], ["me"], "me"), "groupRide.riderLeft")
    XCTAssertEqual(cue(["me", "ola"], ["me", "kai"], "me"), "groupRide.riderJoined")
    XCTAssertNil(cue(["ola"], ["me", "ola"], "me"))
    XCTAssertNil(cue(["me", "ola"], ["ola", "me"], "me"))
  }

  func testACreatedRideCuesForTheRidersOwnRideOrOneNearby() {
    let audible = GroupRideObserver.rideCreatedAudible
    XCTAssertTrue(audible("me", "me", 50.0, 20.0, nil))
    XCTAssertFalse(audible("ola", "me", 50.0, 20.0, nil))
    XCTAssertTrue(audible("ola", "me", 50.1, 20.0, (lat: 50.0, lng: 20.0)))
    XCTAssertFalse(audible("ola", "me", 51.0, 20.0, (lat: 50.0, lng: 20.0)))
    XCTAssertFalse(audible("", nil, 51.0, 20.0, nil))
  }
}
