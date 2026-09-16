import XCTest

@testable import VescapeCore

/// The rule that decides what the phone's GPS costs. Every case here is a battery outcome.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/location/GpsPowerModeTest.kt
final class GpsPowerModeTests: XCTestCase {
  private func resolve(
    appVisible: Bool = false,
    riding: Bool = false,
    groupRideParticipating: Bool = false,
    replayOwnsPosition: Bool = false
  ) -> GpsPowerMode {
    GpsDemand.resolve(
      appVisible: appVisible,
      riding: riding,
      groupRideParticipating: groupRideParticipating,
      replayOwnsPosition: replayOwnsPosition
    )
  }

  /// The drain this whole rule exists to stop: app away, ride over, nothing running.
  func testBackgroundedWithNoRideCostsNothing() {
    XCTAssertEqual(resolve(), .off)
  }

  func testWatchingTheMapGetsForegroundGradeFixes() {
    XCTAssertEqual(resolve(appVisible: true), .map)
  }

  func testRidingGetsBackgroundGradeFixesWithThePhoneAway() {
    XCTAssertEqual(resolve(appVisible: false, riding: true), .ride)
  }

  /// A rider looking at the map mid-ride must not be downgraded to foreground-only delivery: the
  /// moment they pocket the phone the Ride Track would stop.
  func testRidingOutranksMerelyWatching() {
    XCTAssertEqual(resolve(appVisible: true, riding: true), .ride)
  }

  /// Group Ride is deliberate board-less use — the rider's position is being broadcast to others,
  /// so it must keep flowing from a pocket.
  func testGroupRideParticipationPaysForBackgroundFixes() {
    XCTAssertEqual(resolve(groupRideParticipating: true), .ride)
  }

  /// A replay owns position for its lifetime; a live fix slipping through jumps the marker off the
  /// recorded track.
  func testReplayOutranksEveryLiveReason() {
    XCTAssertEqual(
      resolve(appVisible: true, riding: true, groupRideParticipating: true, replayOwnsPosition: true),
      .off
    )
  }

  func testLinkUpIsAlwaysWithinTheDropoutGrace() {
    XCTAssertTrue(GpsDemand.ridingThroughDropout(linkLostAtMs: nil, nowMs: 10_000_000))
  }

  /// A mid-ride dropout must not punch a hole in the Ride Track (ADR 0038).
  func testAFreshDropoutIsStillARide() {
    XCTAssertTrue(
      GpsDemand.ridingThroughDropout(linkLostAtMs: 1_000, nowMs: 1_000 + RIDE_DROPOUT_GRACE_MS - 1)
    )
  }

  /// Powering the board off is how a ride ends; past the grace the reconnect loop is chasing a board
  /// that is not coming back.
  /// The reconnect entry point is re-entered on every failed attempt. Each re-entry reports the
  /// same loss, so the grace must still be measured from the first one — otherwise an endless retry
  /// loop pushes the cutoff out forever and GPS never stands down.
  func testTheGraceIsMeasuredFromTheFirstLossNotTheLatestRetry() {
    let firstLoss: Int64 = 1_000
    let laterRetry = firstLoss + RIDE_DROPOUT_GRACE_MS / 2

    XCTAssertFalse(
      GpsDemand.ridingThroughDropout(
        linkLostAtMs: firstLoss,
        nowMs: firstLoss + RIDE_DROPOUT_GRACE_MS
      )
    )
    // Had a retry re-stamped the timestamp, this would still read as a ride.
    XCTAssertTrue(
      GpsDemand.ridingThroughDropout(
        linkLostAtMs: laterRetry,
        nowMs: firstLoss + RIDE_DROPOUT_GRACE_MS
      )
    )
  }

  func testADropoutPastTheGraceIsAnEndedRide() {
    XCTAssertFalse(
      GpsDemand.ridingThroughDropout(linkLostAtMs: 1_000, nowMs: 1_000 + RIDE_DROPOUT_GRACE_MS)
    )
  }
}
