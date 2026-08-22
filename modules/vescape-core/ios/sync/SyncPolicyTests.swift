import XCTest
@testable import VescapeCore

/// The send/wait/paused decision, with no database, clock or network behind it.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncPolicyTest.kt
final class SyncPolicyTests: XCTestCase {
  private func state(
    pendingRows: Int = 1,
    ridingSamples: Bool = false,
    enabled: Bool = true,
    online: Bool = true,
    wifiOnly: Bool = false,
    onWifi: Bool = false,
    credentialReady: Bool = true,
    onlineBlocked: Bool = false,
    pause: SyncPauseReason? = nil,
    retryAtMs: Int64 = 0
  ) -> SyncState {
    SyncState(
      nowMs: 1_000,
      pendingRows: pendingRows,
      ridingSamples: ridingSamples,
      enabled: enabled,
      online: online,
      wifiOnly: wifiOnly,
      onWifi: onWifi,
      credentialReady: credentialReady,
      onlineBlocked: onlineBlocked,
      pause: pause,
      retryAtMs: retryAtMs
    )
  }

  func testPendingRowsOnALiveConnectionSendNow() {
    XCTAssertEqual(SyncPolicy.decide(state()), .sendNow)
  }

  func testCadenceFollowsSampleProductionNotSessionPresence() {
    XCTAssertEqual(
      SyncPolicy.decide(state(pendingRows: 0, ridingSamples: true)),
      .wait(atMs: 1_000 + SyncPolicy.rideIntervalMs)
    )
    XCTAssertEqual(
      SyncPolicy.decide(state(pendingRows: 0)),
      .wait(atMs: 1_000 + SyncPolicy.idleIntervalMs)
    )
  }

  /// Offline, metered and gated are pauses in the loop, never failures that move backoff.
  func testOfflineMeteredAndClosedGateAllWait() {
    let idle = SyncDecision.wait(atMs: 1_000 + SyncPolicy.idleIntervalMs)
    XCTAssertEqual(SyncPolicy.decide(state(online: false)), idle)
    XCTAssertEqual(SyncPolicy.decide(state(wifiOnly: true, onWifi: false)), idle)
    XCTAssertEqual(SyncPolicy.decide(state(onlineBlocked: true)), idle)
    XCTAssertEqual(SyncPolicy.decide(state(wifiOnly: true, onWifi: true)), .sendNow)
  }

  func testBackoffDeadlineHoldsTheLoopUntilItPasses() {
    XCTAssertEqual(SyncPolicy.decide(state(retryAtMs: 5_000)), .wait(atMs: 5_000))
    XCTAssertEqual(SyncPolicy.decide(state(retryAtMs: 999)), .sendNow)
  }

  func testAPauseIsNotBypassedByAnOrdinaryKick() {
    XCTAssertEqual(SyncPolicy.decide(state(pause: .protocolFailure)), .paused(.protocolFailure))
    XCTAssertEqual(SyncPolicy.decide(state(credentialReady: false)), .paused(.authentication))
  }

  func testTheMasterSwitchStopsTheUploaderOutrightAndOutranksEveryOtherState() {
    XCTAssertEqual(
      SyncPolicy.decide(state(enabled: false)),
      .wait(atMs: 1_000 + SyncPolicy.idleIntervalMs)
    )
    // Not a pause: switched off is not a broken uploader waiting to be resumed.
    XCTAssertEqual(
      SyncPolicy.decide(state(enabled: false, pause: .protocolFailure)),
      .wait(atMs: 1_000 + SyncPolicy.idleIntervalMs)
    )
    XCTAssertEqual(SyncPolicy.describe(state(enabled: false)), .disabled)
    XCTAssertEqual(SyncPolicy.describe(state(enabled: false, credentialReady: false)), .disabled)
    XCTAssertEqual(SyncPolicy.describe(state(enabled: false, pause: .authentication)), .disabled)
  }

  func testAPhoneWithNoCredentialReadsAsSignedOutNotAsABrokenBackup() {
    XCTAssertEqual(SyncPolicy.describe(state(credentialReady: false)), .signedOut)
    XCTAssertEqual(
      SyncPolicy.describe(state(credentialReady: false, pause: .authentication)),
      .signedOut
    )
  }

  func testEveryWaitingReasonIsNamedSeparately() {
    XCTAssertEqual(SyncPolicy.describe(state(pendingRows: 0)), .upToDate)
    XCTAssertEqual(SyncPolicy.describe(state()), .syncing)
    XCTAssertEqual(SyncPolicy.describe(state(online: false)), .offline)
    XCTAssertEqual(SyncPolicy.describe(state(onlineBlocked: true)), .offline)
    XCTAssertEqual(SyncPolicy.describe(state(wifiOnly: true, onWifi: false)), .waitingForWifi)
    XCTAssertEqual(SyncPolicy.describe(state(wifiOnly: true, onWifi: true)), .syncing)
  }

  func testAPauseOutranksEverythingExceptBeingSignedOut() {
    XCTAssertEqual(SyncPolicy.describe(state(pendingRows: 0, pause: .protocolFailure)), .paused)
    XCTAssertEqual(SyncPolicy.describe(state(online: false, pause: .rowTooLarge)), .paused)
  }

  func testABatchWaitingOnBackoffStillReadsAsSyncing() {
    XCTAssertEqual(SyncPolicy.describe(state(retryAtMs: 60_000)), .syncing)
  }

  func testBackoffDoublesFromTheFirstStepAndStopsAtTheCap() {
    XCTAssertEqual(SyncPolicy.nextBackoffMs(0), SyncPolicy.backoffStartMs)
    XCTAssertEqual(SyncPolicy.nextBackoffMs(30_000), 60_000)
    XCTAssertEqual(SyncPolicy.nextBackoffMs(SyncPolicy.backoffMaxMs), SyncPolicy.backoffMaxMs)
  }
}
