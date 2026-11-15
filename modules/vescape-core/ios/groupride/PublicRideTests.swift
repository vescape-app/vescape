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

  private let withMissed: Set<String> = ["public-ride", "missed-positions"]

  private func goLiveWithMissed() {
    ride.load(PublicRideSwitch(on: true, until: nil), accountId: "acc")
    ride.setBoardConnected(true)
    ready(withMissed)
    ride.handle(type: "public-status", json: ["on": true])
  }

  private var batchAts: [Int64] {
    let batch = sent.last { $0["type"] as? String == "missed-positions" }?["positions"] as? [[String: Any]] ?? []
    return batch.compactMap { $0["at"] as? Int64 }
  }

  private var batches: Int { types.filter { $0 == "missed-positions" }.count }

  func testPositionsMissedOfflineGoAsOneThinnedBatchAfterReconnectAndDropOnlyOnceStored() {
    goLiveWithMissed()
    ride.linkLost()
    for at: Int64 in [10_000, 12_000, 15_000, 21_000] { ride.position(presence, at: at) }
    ready(withMissed)
    ride.position(presence, at: 26_000)
    XCTAssertEqual(batches, 0)
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertEqual(batchAts, [10_000, 15_000, 21_000, 26_000])
    ride.position(presence, at: 30_000)
    XCTAssertEqual(batches, 1)
    ride.handleError("missed positions not stored")
    XCTAssertEqual(ride.switchState, PublicRideSwitch(on: true, until: nil))
    ride.position(presence, at: 31_000)
    XCTAssertEqual(batches, 2)
    XCTAssertEqual(batchAts, [10_000, 15_000, 21_000, 26_000])
    ride.handle(type: "missed-stored", json: ["from": 10_000, "to": 26_000, "stored": 4])
    ride.position(presence, at: 32_000)
    XCTAssertEqual(batches, 2)
  }

  func testKeptPositionsAreCappedAtThreeHoursAndSentInBatchesOf500() {
    goLiveWithMissed()
    ride.linkLost()
    let count = 3 * 60 * 60 / 5 + 10
    for i in 0..<count { ride.position(presence, at: Int64(i) * 5_000) }
    ready(withMissed)
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertEqual(batchAts.count, 500)
    XCTAssertEqual(batchAts.first, 9 * 5_000)
    ride.handle(type: "missed-stored", json: [:])
    XCTAssertEqual(batchAts.first, 500 * 5_000 + 9 * 5_000)
  }

  func testNothingIsKeptForARelayWithoutTheFeatureAndAnAccountChangeDiscardsTheKept() {
    goLive()
    ride.linkLost()
    ride.position(presence, at: 10_000)
    ready()
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertFalse(types.contains("missed-positions"))

    sent = []
    goLiveWithMissed()
    ride.linkLost()
    ride.position(presence, at: 20_000)
    ride.setAccount("other")
    _ = ride.set(PublicRideSwitch(on: true, until: nil))
    ready(withMissed)
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertFalse(types.contains("missed-positions"))
  }
}
