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
  private var pinUpdates: [([SignalRider], [String: RideHazard])] = []

  private let presence = RiderPresence(lat: 52, lng: 21)

  override func setUp() {
    super.setUp()
    now = 1_000_000
    persisted = []
    timer = nil
    events = []
    sent = []
    pinUpdates = []
    ride = PublicRide(
      now: { [unowned self] in self.now },
      persist: { [unowned self] in self.persisted.append($0) },
      scheduleExpiry: { [unowned self] in self.timer = $0 },
      emit: { [unowned self] name, payload in self.events.append((name, payload)) },
      send: { [unowned self] frame in
        self.sent.append(frame)
        return true
      },
      onPins: { [unowned self] signals, hazards, _ in self.pinUpdates.append((signals, hazards)) }
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

  private var ownPins: [String: Any?] { events.last { $0.0 == "onPublicPins" }!.1["own"] as! [String: Any?] }

  private func goLive() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    ride.handle(type: "public-status", json: ["on": true])
  }

  func testAPublicRiderSendsAndClearsASignalAndAHazard() {
    goLive()
    XCTAssertTrue(ride.submitPin(.send(slot: .signal, kind: "wait", lat: 52, lng: 21)))
    XCTAssertTrue(ride.submitPin(.send(slot: .hazard, kind: "water", lat: 52, lng: 21)))
    XCTAssertEqual(types, ["public-on", "public-signal", "public-hazard"])
    XCTAssertEqual(sent[1]["kind"] as? String, "wait")
    XCTAssertEqual((ownPins["signal"] as? [String: Any?])?["kind"] as? String, "wait")
    XCTAssertTrue(ride.submitPin(.clear(.signal)))
    XCTAssertEqual(types.last, "public-signal-clear")
    XCTAssertNil(ownPins["signal"] ?? nil)
  }

  func testAPinWaitsForTheRelayToConfirmThePublicRide() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready()
    XCTAssertTrue(ride.submitPin(.send(slot: .signal, kind: "down", lat: 52, lng: 21)))
    XCTAssertTrue(ride.submitPin(.send(slot: .signal, kind: "serious", lat: 52, lng: 21)))
    XCTAssertEqual(types, ["public-on"])
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertEqual(types, ["public-on", "public-signal"])
    XCTAssertEqual(sent.last?["kind"] as? String, "serious")
  }

  func testNoPinGoesOutOffThePublicRideAndEndingItDropsTheOwnPins() {
    ride.load(.off, accountId: "acc")
    ready()
    XCTAssertFalse(ride.submitPin(.send(slot: .signal, kind: "wait", lat: 52, lng: 21)))
    goLive()
    ride.submitPin(.send(slot: .signal, kind: "wait", lat: 52, lng: 21))
    ride.setBoardConnected(false)
    XCTAssertNil(ownPins["signal"] ?? nil)
  }

  func testOtherRidersPinsFollowTheRelayAMissingSlotMeaningNone() {
    ride.load(.off, accountId: nil)
    ready()
    let pin: [String: Any] = ["kind": "serious", "lat": 52, "lng": 21, "startedAt": 5, "expiresAt": 9]
    let hazard: [String: Any] = ["kind": "police", "lat": 52, "lng": 21, "startedAt": 5, "expiresAt": 9]
    ride.handle(type: "public-pins", json: ["accountId": "f", "nick": "Ola", "signal": pin, "hazard": hazard, "now": 6])
    XCTAssertEqual(pinUpdates.last?.0.first?.signal?.kind, .serious)
    XCTAssertEqual(pinUpdates.last?.0.first?.name, "Ola")
    XCTAssertEqual(pinUpdates.last?.1["f"]?.kind, .police)
    ride.handle(type: "public-pins", json: ["accountId": "f", "nick": "Ola", "hazard": hazard, "now": 7])
    XCTAssertNil(pinUpdates.last?.0.first?.signal)
    ride.handle(type: "public-pins", json: ["accountId": "f", "nick": "Ola", "now": 8])
    XCTAssertEqual(pinUpdates.last?.0.count, 0)
    XCTAssertEqual(pinUpdates.last?.1.count, 0)
    let event = events.last { $0.0 == "onPublicPins" }!.1
    XCTAssertEqual((event["pins"] as? [Any])?.count, 0)
    XCTAssertEqual(event["now"] as? Int64, 8)
  }
}
