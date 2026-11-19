import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/PublicRideTest.kt
final class PublicRideTests: XCTestCase {
  private var now: Int64 = 1_000_000
  private var persisted: [PublicRideSwitch] = []
  private var timer: Int64?
  private var events: [(String, [String: Any?])] = []
  private var sent: [[String: Any]] = []
  private var retry: Int64?
  private var ridersFlush: Int64?
  private var linkDemands: [Bool] = []
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
    retry = nil
    ridersFlush = nil
    linkDemands = []
    ride = PublicRide(
      now: { [unowned self] in self.now },
      persist: { [unowned self] in self.persisted.append($0) },
      scheduleExpiry: { [unowned self] in self.timer = $0 },
      emit: { [unowned self] name, payload in self.events.append((name, payload)) },
      send: { [unowned self] frame in
        self.sent.append(frame)
        return true
      },
      scheduleMissedRetry: { [unowned self] in self.retry = $0 },
      scheduleRidersFlush: { [unowned self] in self.ridersFlush = $0 },
      onPublicRideDemandChanged: { [unowned self] in self.linkDemands.append(self.ride.needsLink) },
      onPins: { [unowned self] signals, hazards, _ in self.pinUpdates.append((signals, hazards)) }
    )
  }

  private var types: [String] { sent.map { $0["type"] as? String ?? "" } }
  private var status: [String: Any?] { events.last { $0.0 == "onPublicRideStatus" }!.1 }
  private func ready(_ features: Set<String> = ["public-ride"]) { ride.linkReady(features: features, authenticatedAccount: "acc") }

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

  func testManualSharingHandsOffToBoardWithoutResettingTimer() {
    let until = now + 3_600_000
    let selected = PublicRideSwitch(on: true, until: until)
    ride.load(selected, accountId: "acc")
    ready()
    ride.watchNearby((lat: 52, lng: 21))
    sent.removeAll()
    linkDemands.removeAll()

    ride.setManualSharing(true)
    XCTAssertTrue(ride.needsGps)
    XCTAssertEqual(status["activation"] as? String, "phone")
    XCTAssertEqual(sent.last?["until"] as? Int64, until)
    XCTAssertEqual(status["live"] as? Bool, false)
    ride.handle(type: "public-status", json: ["on": true])
    ride.position(presence, at: now)

    ride.setBoardConnected(true)
    XCTAssertEqual(status["activation"] as? String, "board")
    XCTAssertFalse(ride.needsGps)
    XCTAssertTrue(ride.riding)
    ride.setManualSharing(true) // A tap queued before the board connected.
    XCTAssertFalse(ride.needsGps)
    XCTAssertEqual(types, ["public-on", "public-position"])
    ride.setBoardConnected(false)
    XCTAssertEqual(types, ["public-on", "public-position", "public-off"])
    XCTAssertEqual(status["activation"] as? String, "waiting")
    XCTAssertFalse(ride.needsGps)
    XCTAssertEqual(linkDemands, [true, true])
    XCTAssertEqual(ride.switchState, selected)
    XCTAssertEqual(timer, 3_600_000)
    XCTAssertTrue(persisted.isEmpty)

    ride.setBoardConnected(true)
    XCTAssertEqual(types.last, "public-on")
  }

  func testManualSharingExpiresAndDoesNotRestartWithTheSwitch() {
    ride.load(.off, accountId: "acc")
    ready()
    ride.setManualSharing(true)
    XCTAssertFalse(ride.needsGps)

    let until = now + 1_000
    ride.set(PublicRideSwitch(on: true, until: until))
    ride.setManualSharing(true)
    now = until
    ride.expire()
    XCTAssertEqual(status["activation"] as? String, "off")
    XCTAssertEqual(types, ["public-on", "public-off"])
    ride.set(PublicRideSwitch(on: true, until: nil))
    XCTAssertFalse(ride.wanted)

    ride.setManualSharing(true)
    ride.setAccount("another-account")
    XCTAssertFalse(ride.needsGps)
    ride.set(PublicRideSwitch(on: true, until: nil))
    XCTAssertFalse(ride.wanted)
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

  func testOneTickOfRiderUpdatesReachesJSAsOneList() {
    ride.load(.off, accountId: nil)
    ready()
    ride.watchNearby((lat: 52, lng: 21))
    ride.handle(type: "nearby-riders", json: ["now": 1, "riders": [Any]()])
    events = []
    for id in ["a", "b", "c"] {
      ride.handle(type: "public-rider", json: [
        "now": 2,
        "rider": ["accountId": id, "nick": "R\(id)", "presence": ["lat": 52, "lng": 21], "stale": false, "lastSeen": 2, "away": false],
      ])
    }
    XCTAssertFalse(events.contains { $0.0 == "onPublicRiders" })
    XCTAssertEqual(ridersFlush, PublicRide.ridersBatchMs)

    ride.flushRiders()
    let emitted = events.filter { $0.0 == "onPublicRiders" }
    XCTAssertEqual(emitted.count, 1)
    XCTAssertEqual((emitted.first?.1["riders"] as? [Any])?.count, 3)
    XCTAssertNil(ridersFlush)
  }

  func testLookingAroundRecentresAfterAKilometreButNotWhilePublic() {
    ride.load(.off, accountId: nil)
    ready()
    ride.followNearby((lat: 52, lng: 21))
    ride.followNearby((lat: 52.005, lng: 21))
    ride.followNearby((lat: 52.011, lng: 21))
    let nearby = sent.filter { $0["type"] as? String == "nearby" }.compactMap { $0["lat"] as? Double }
    XCTAssertEqual(nearby, [52, 52.011])

    goLive()
    sent.removeAll()
    ride.followNearby((lat: 52.03, lng: 21))
    XCTAssertFalse(sent.contains { $0["type"] as? String == "nearby" })
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
    XCTAssertEqual(batches, 1)
    XCTAssertEqual(batchAts, [10_000, 15_000, 21_000])
    // Historical upload precedes even public-on; live positions still wait for status.
    XCTAssertEqual(Array(types.suffix(2)), ["missed-positions", "public-on"])
    ride.handle(type: "public-status", json: ["on": true])
    ride.position(presence, at: 30_000)
    XCTAssertEqual(batches, 1)
    ride.handleError("missed positions not stored")
    XCTAssertEqual(ride.switchState, PublicRideSwitch(on: true, until: nil))
    XCTAssertEqual(retry, PublicRide.missedRetryMs)
    ride.linkLost()
    ready(withMissed)
    XCTAssertEqual(batches, 2)
    XCTAssertEqual(batchAts, [10_000, 15_000, 21_000, 26_000])
    ride.handle(type: "missed-stored", json: ["from": 10_000, "to": 26_000, "stored": 4])
    XCTAssertNil(retry)
    ride.handle(type: "public-status", json: ["on": true])
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
    ride.linkReady(features: withMissed, authenticatedAccount: "other")
    ride.handle(type: "public-status", json: ["on": true])
    XCTAssertFalse(types.contains("missed-positions"))
  }
  func testOfflineFinishByOffDisconnectOrExpiryDrainsWithoutAPublicRideOrNewGPS() {
    for ending in ["off", "disconnect", "expiry"] {
      setUp()
      goLiveWithMissed()
      ride.set(PublicRideSwitch(on: true, until: now + 60_000))
      ride.linkLost()
      ride.position(presence, at: 10_000)
      switch ending {
      case "off": ride.set(.off)
      case "disconnect": ride.setBoardConnected(false)
      default: now += 60_000; ride.expire()
      }
      ride.position(presence, at: 20_000) // Never collect private positions.
      XCTAssertFalse(ride.wanted)
      XCTAssertTrue(ride.needsLink)
      sent = []
      ready(withMissed)
      XCTAssertEqual(types, ["missed-positions"])
      XCTAssertEqual(batchAts, [10_000])
      XCTAssertFalse(ride.riding)
      XCTAssertTrue(ride.needsLink) // Still owns the socket while waiting for ack.
      ride.handleError("missed positions not stored")
      XCTAssertEqual(retry, PublicRide.missedRetryMs)
      ride.linkLost()
      XCTAssertNil(retry)
      ready(withMissed)
      XCTAssertEqual(types, ["missed-positions", "missed-positions"])
      ride.handle(type: "missed-stored", json: [:])
      XCTAssertFalse(ride.needsLink)
      XCTAssertEqual(linkDemands.last, false)
      XCTAssertNil(retry)
    }
  }

  func testCompletedBufferWaitsForAuthenticatedCapabilityReadinessAndCannotCrossAccountsOrServers() {
    for account: String? in [nil, "other"] {
      setUp()
      goLiveWithMissed()
      ride.linkLost()
      ride.position(presence, at: 10_000)
      ride.set(.off)
      sent = []
      ride.linkReady(features: withMissed, authenticatedAccount: account)
      XCTAssertTrue(sent.isEmpty)
      XCTAssertTrue(ride.needsLink)
      ride.linkLost()
      ready(withMissed)
      XCTAssertEqual(types, ["missed-positions"])
    }
    for clear in ["sign-out", "account", "server", "unsupported"] {
      setUp()
      goLiveWithMissed()
      ride.linkLost()
      ride.position(presence, at: 10_000)
      ride.set(.off)
      ready(withMissed)
      XCTAssertNotNil(retry)
      switch clear {
      case "sign-out": ride.setAccount(nil)
      case "account": ride.setAccount("other")
      case "server": ride.discardMissed()
      default: ride.linkReady(features: ["public-ride"], authenticatedAccount: "acc")
      }
      XCTAssertFalse(ride.needsLink)
      XCTAssertNil(retry)
      sent = []
      ride.linkLost()
      ready(withMissed)
      ride.handle(type: "missed-stored", json: [:]) // Old ack cannot resurrect data.
      XCTAssertTrue(sent.isEmpty)
    }
  }

  func testThinningDuringAnUploadPreservesTheAcknowledgedPrefixAndWaitingTail() {
    goLiveWithMissed()
    ride.linkLost()
    ride.position(presence, at: 0)
    ride.position(presence, at: 5_000)
    ready(withMissed)
    // A new public ride has not been confirmed yet; its fixes still belong in the buffer.
    let late = PublicRide.missedMaxAgeMs + 10_000
    ride.position(presence, at: late)
    ride.position(presence, at: late + 1_000) // Still thinned to five seconds.
    XCTAssertEqual(batchAts, [0, 5_000])
    ride.handle(type: "missed-stored", json: [:])
    XCTAssertEqual(batchAts, [late])
    ride.set(.off)
    ride.handle(type: "missed-stored", json: [:])
    XCTAssertFalse(ride.needsLink)
  }

  func testLinkAndAccountResetsForgetPeersButOnlyIdentityDropsPendingOwnIntents() {
    for changeAccount in [false, true] {
      setUp()
      goLive()
      let peer: [String: Any] = ["accountId": "friend", "nick": "Ola", "signal": ["kind": "serious", "lat": 52, "lng": 21, "startedAt": 5, "expiresAt": 9_000_000], "now": 6]
      ride.handle(type: "public-pins", json: peer)
      ride.linkLost()
      XCTAssertTrue(pinUpdates.last!.0.isEmpty)
      XCTAssertTrue(pinUpdates.last!.1.isEmpty)
      XCTAssertTrue((events.last { $0.0 == "onPublicPins" }!.1["pins"] as! [Any]).isEmpty)
      ride.submitPin(.send(slot: .signal, kind: "wait", lat: 52, lng: 21))
      if changeAccount {
        ride.handle(type: "public-pins", json: peer)
        ride.setAccount("other")
        XCTAssertTrue(pinUpdates.last!.0.isEmpty)
        ride.set(PublicRideSwitch(on: true, until: nil))
      }
      sent = []
      ride.linkReady(features: ["public-ride"], authenticatedAccount: changeAccount ? "other" : "acc")
      ride.handle(type: "public-status", json: ["on": true])
      XCTAssertEqual(types.contains("public-signal"), !changeAccount)
      XCTAssertTrue((events.last { $0.0 == "onPublicPins" }!.1["pins"] as! [Any]).isEmpty)
    }
  }

}
