import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideCuesTest.kt
final class GroupRideCuesTests: XCTestCase {
  private var cues = GroupRideCues()

  private func roster(_ ids: String..., away: Set<String> = [], rideId: String = "ride") -> String? {
    cues.roster(rideId: rideId, riderIds: ids, awayIds: away, ownRiderId: "me")
  }

  private func signal(_ kind: RiderSignalKind, startedAt: Int64 = 1_000, expiresAt: Int64 = 61_000) -> RiderSignal {
    RiderSignal(kind: kind, lat: 50, lng: 19, startedAt: startedAt, expiresAt: expiresAt)
  }

  private func signals(_ ids: String..., signals: [String: RiderSignal], now: Int64? = 10_000) -> String? {
    cues.roster(rideId: "ride", riderIds: ids, awayIds: [], ownRiderId: "me", riderSignals: signals, now: now)
  }

  private func joined(with ids: String..., away: Set<String> = []) {
    XCTAssertEqual(cues.joined("ride"), "groupRide.joined")
    XCTAssertNil(cues.roster(rideId: "ride", riderIds: ids, awayIds: away, ownRiderId: "me"))
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

  func testARiderRemovedWhileAwayPlaysNothing() {
    joined(with: "me", "ola", "kai")

    XCTAssertNil(roster("me", "ola", "kai", away: ["kai"]))
    XCTAssertNil(roster("me", "ola"))
  }

  func testARiderAwayInTheFirstRosterLeavesSilently() {
    joined(with: "me", "ola", "kai", away: ["kai"])

    XCTAssertNil(roster("me", "ola"))
  }

  func testARiderBackFromAwayWhoThenLeavesCuesRiderLeft() {
    joined(with: "me", "ola")
    XCTAssertNil(roster("me", "ola", away: ["ola"]))
    XCTAssertNil(roster("me", "ola"))

    XCTAssertEqual(roster("me"), "groupRide.riderLeft")
  }

  func testSeveralRidersRemovedAtOnceCueOneRiderLeftOnlyWhenOneWasLive() {
    joined(with: "me", "ola", "kai", "zoe", "ian", away: ["kai", "zoe"])

    XCTAssertNil(roster("me", "ola", "ian", away: ["ian"]))
    XCTAssertEqual(roster("me"), "groupRide.riderLeft")
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

  func testAnotherRidersNewSignalCuesItsKindOnce() {
    joined(with: "me", "ola")
    let down = ["ola": signal(.down)]

    XCTAssertEqual(signals("me", "ola", signals: down), "groupRide.signal.down")
    XCTAssertNil(signals("me", "ola", signals: down))
  }

  func testAReplacedSignalCuesTheNewKind() {
    joined(with: "me", "ola")
    _ = signals("me", "ola", signals: ["ola": signal(.wait)])

    XCTAssertEqual(
      signals("me", "ola", signals: ["ola": signal(.battery, startedAt: 5_000)]), "groupRide.signal.battery")
  }

  func testASignalClearedBeforeItExpiresByRelayNowCuesOkExpiryIsSilent() {
    joined(with: "me", "ola", "kai")
    let help = ["ola": signal(.help), "kai": signal(.board)]
    _ = signals("me", "ola", "kai", signals: help)

    XCTAssertEqual(signals("me", "ola", "kai", signals: ["kai": signal(.board)], now: 60_999), "groupRide.signal.ok")
    XCTAssertNil(signals("me", "ola", "kai", signals: [:], now: 61_000))
  }

  func testASignalGoneASecondLateOrWithoutRelayNowStaysSilent() {
    joined(with: "me", "ola")
    _ = signals("me", "ola", signals: ["ola": signal(.board)])
    XCTAssertNil(signals("me", "ola", signals: [:], now: 62_000))

    _ = signals("me", "ola", signals: ["ola": signal(.board, startedAt: 2_000)])
    XCTAssertNil(signals("me", "ola", signals: [:], now: nil))
  }

  func testARiderLeavingWithAnActiveSignalCuesRiderLeftNotOk() {
    joined(with: "me", "ola", "kai")
    _ = signals("me", "ola", "kai", signals: ["ola": signal(.wait)])

    XCTAssertEqual(signals("me", "kai", signals: [:]), "groupRide.riderLeft")
  }

  func testTheRidersOwnSignalNeverCues() {
    joined(with: "me", "ola")

    XCTAssertNil(signals("me", "ola", signals: ["me": signal(.down)]))
    XCTAssertNil(signals("me", "ola", signals: [:]))
  }

  func testSignalsAlreadyActiveAtJoinOrReconnectStaySilent() {
    let down = ["ola": signal(.down)]
    XCTAssertEqual(cues.joined("ride"), "groupRide.joined")
    XCTAssertNil(signals("me", "ola", signals: down))
    XCTAssertNil(signals("me", "ola", signals: down))

    _ = cues.linkDropped()
    _ = cues.joined("ride")
    let wait = ["ola": signal(.wait, startedAt: 3_000)]
    XCTAssertNil(signals("me", "ola", signals: wait))
    XCTAssertNil(signals("me", "ola", signals: wait))
  }

  func testASignalWinsOverSocialCuesAndACriticalSignalOverOthers() {
    joined(with: "me", "ola")
    let both = ["ola": signal(.wait), "kai": signal(.help)]

    XCTAssertEqual(signals("me", "ola", "kai", signals: both), "groupRide.signal.help")
    XCTAssertEqual(signals("me", "kai", "zoe", signals: [:]), "groupRide.signal.ok")
  }
}
