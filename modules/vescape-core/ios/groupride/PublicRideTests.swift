import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/PublicRideTest.kt
final class PublicRideTests: XCTestCase {
  private var now: Int64 = 1_000_000
  private var persisted: [PublicRideSwitch] = []
  private var timer: Int64?
  private var events: [(String, [String: Any?])] = []
  private var sent: [[String: Any]] = []
  private var ride: PublicRide!

  private let presence = RiderPresence(lat: 52, lng: 21)

  override func setUp() {
    super.setUp()
    now = 1_000_000
    persisted = []
    timer = nil
    events = []
    sent = []
    ride = PublicRide(
      now: { [unowned self] in self.now },
      persist: { [unowned self] in self.persisted.append($0) },
      scheduleExpiry: { [unowned self] in self.timer = $0 },
      emit: { [unowned self] name, payload in self.events.append((name, payload)) },
      send: { [unowned self] frame in
        self.sent.append(frame)
        return true
      }
    )
  }

  private var types: [String] { sent.map { $0["type"] as? String ?? "" } }
  private var status: [String: Any?] { events.last { $0.0 == "onPublicRideStatus" }!.1 }
  private func ready(_ features: Set<String> = ["public-ride"]) { ride.linkReady(features: features) }

  func testStoredSwitchWhoseEndTimePassedLoadsOff() {
    ride.load(PublicRideSwitch(on: true, until: now - 1), accountId: "acc")
    XCTAssertEqual(ride.switchState, .off)
    XCTAssertEqual(persisted.last, .off)
    XCTAssertNil(timer)
  }

  func testStoredSwitchLoadsOffWhenSignedOut() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: nil)
    XCTAssertEqual(ride.switchState, .off)
  }

  func testGoingPublicNeedsAnAccount() {
    ride.load(.off, accountId: nil)
    XCTAssertFalse(ride.set(PublicRideSwitch(on: true, until: nil)))
    XCTAssertEqual(ride.switchState, .off)
  }

  func testAlwaysOnStartsThePublicRideWhenTheBoardConnects() {
    ride.load(.off, accountId: "acc")
    ready()
    XCTAssertTrue(ride.set(PublicRideSwitch(on: true, until: nil)))
    XCTAssertTrue(sent.isEmpty)
    ride.setBoardConnected(true)
    XCTAssertEqual(types, ["public-on"])
    XCTAssertNil(sent.last?["until"])
    ride.setBoardConnected(false)
    XCTAssertEqual(types, ["public-on", "public-off"])
    // The switch stays on for the next board connect.
    XCTAssertTrue(ride.switchState.on)
  }

  func testHoursEndTimeGoesToTheRelayAndTheTimerTurnsTheSwitchOff() {
    let until = now + 2 * 3_600_000
    ride.load(.off, accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    ride.set(PublicRideSwitch(on: true, until: until))
    XCTAssertEqual((sent.last?["until"] as? Int64), until)
    XCTAssertEqual(timer, 2 * 3_600_000)
    now = until
    ride.expire()
    XCTAssertEqual(ride.switchState, .off)
    XCTAssertEqual(persisted.last, .off)
    XCTAssertEqual(status["reason"] as? String, "end-time")
  }

  func testThePublicRideWaitsForARelayThatListsTheFeature() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready([])
    XCTAssertTrue(sent.isEmpty)
    XCTAssertEqual(status["supported"] as? Bool, false)
  }

  func testPositionsGoOutOnlyOnceTheRelayConfirms() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    ride.position(presence, at: 5)
    XCTAssertEqual(types, ["public-on"])
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertEqual(status["live"] as? Bool, true)
    ride.position(presence, at: 5)
    XCTAssertEqual(sent.last?["at"] as? Int64, 5)
    XCTAssertNil((sent.last?["presence"] as? [String: Any])?["at"])
  }

  func testReconnectingSendsPublicOnAgain() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    ride.linkLost()
    ready()
    XCTAssertEqual(types, ["public-on", "public-on"])
  }

  func testANewerPhoneOfTheAccountTurnsTheSwitchOff() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    ride.handle(type: "public-status", json: ["on": false, "reason": "replaced"])
    XCTAssertEqual(ride.switchState, .off)
    XCTAssertEqual(status["reason"] as? String, "replaced")
    XCTAssertEqual(types, ["public-on"])
  }

  func testSigningOutEndsThePublicRideAndTurnsTheSwitchOff() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    XCTAssertTrue(ride.setAccount(nil))
    XCTAssertEqual(types, ["public-on", "public-off"])
    XCTAssertEqual(ride.switchState, .off)
    XCTAssertEqual(status["reason"] as? String, "signed-out")
  }

  func testARefusedPublicOnTurnsTheSwitchOff() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    XCTAssertTrue(ride.handleError("public ride needs a nick"))
    XCTAssertEqual(ride.switchState, .off)
    XCTAssertFalse(ride.handleError("no such ride: x"))
  }

  func testNearbyRidersFollowTheRelay() {
    ride.load(.off, accountId: nil)
    ready()
    ride.watchNearby((lat: 52, lng: 21))
    XCTAssertEqual(types.last, "nearby")
    ride.handle(type: "nearby-riders", json: [
      "now": 9,
      "riders": [["accountId": "a", "nick": "Ola", "presence": ["lat": 52, "lng": 21], "stale": false, "lastSeen": 8, "away": false]],
    ])
    ride.handle(type: "public-rider-gone", json: ["accountId": "a"])
    let riders = events.last { $0.0 == "onPublicRiders" }!.1["riders"] as? [Any]
    XCTAssertEqual(riders?.count, 0)
    let first = events.first { $0.0 == "onPublicRiders" }!.1
    XCTAssertEqual(first["now"] as? Int64, 9)
    XCTAssertEqual(((first["riders"] as? [[String: Any?]])?.first?["nick"] as? String), "Ola")
  }
}
