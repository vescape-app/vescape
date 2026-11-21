import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/location/GpsPowerModeTest.kt
final class GpsPowerModeTests: XCTestCase {
  private func resolve(
    appVisible: Bool = false,
    riding: Bool = false,
    watchNavigating: Bool = false,
    replayOwnsPosition: Bool = false,
    manualPublicRide: Bool = false
  ) -> GpsPowerMode {
    GpsDemand.resolve(
      appVisible: appVisible,
      riding: riding,
      watchNavigating: watchNavigating,
      replayOwnsPosition: replayOwnsPosition,
      manualPublicRide: manualPublicRide
    )
  }

  func testBackgroundedWithNoRideCostsNothing() {
    XCTAssertEqual(resolve(), .off)
  }

  func testWatchingTheMapGetsForegroundGradeFixes() {
    XCTAssertEqual(resolve(appVisible: true), .map)
  }

  func testRidingGetsBackgroundGradeFixesWithThePhoneAway() {
    XCTAssertEqual(resolve(appVisible: false, riding: true), .ride)
  }

  func testRidingOutranksMerelyWatching() {
    XCTAssertEqual(resolve(appVisible: true, riding: true), .ride)
  }

  func testWatchNavigationPaysForBackgroundFixes() {
    XCTAssertEqual(resolve(watchNavigating: true), .ride)
  }

  func testManualPublicRidePaysForBackgroundFixes() {
    XCTAssertEqual(resolve(manualPublicRide: true), .ride)
  }

  func testReplayOutranksEveryLiveReason() {
    XCTAssertEqual(
      resolve(
        appVisible: true, riding: true, watchNavigating: true,
        replayOwnsPosition: true, manualPublicRide: true
      ),
      .off
    )
  }

  func testLinkUpIsAlwaysWithinTheDropoutGrace() {
    XCTAssertTrue(GpsDemand.ridingThroughDropout(linkLostAtMs: nil, nowMs: 10_000_000))
  }

  func testAFreshDropoutIsStillARide() {
    XCTAssertTrue(
      GpsDemand.ridingThroughDropout(linkLostAtMs: 1_000, nowMs: 1_000 + RIDE_DROPOUT_GRACE_MS - 1)
    )
  }

  func testTheGraceIsMeasuredFromTheFirstLossNotTheLatestRetry() {
    let firstLoss: Int64 = 1_000
    let laterRetry = firstLoss + RIDE_DROPOUT_GRACE_MS / 2

    XCTAssertFalse(
      GpsDemand.ridingThroughDropout(
        linkLostAtMs: firstLoss,
        nowMs: firstLoss + RIDE_DROPOUT_GRACE_MS
      )
    )
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
