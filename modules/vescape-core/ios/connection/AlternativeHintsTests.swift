import XCTest
@testable import VescapeCore

/// Advisory switch hints (ADR 0035, #408): dedup by saved Board id, discovery order, and expiry
/// thirty seconds after the *last* advertisement.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/AlternativeHintsTest.kt
final class AlternativeHintsTests: XCTestCase {
  private func observation(
    _ boardId: String,
    observedAtMs: Int64 = 0,
    rssi: Int? = -60,
    selected: Bool = false
  ) -> PresenceObservation {
    PresenceObservation(
      boardId: boardId,
      bleId: "ble:\(boardId)",
      name: boardId.uppercased(),
      rssi: rssi,
      observedAtMs: observedAtMs,
      selected: selected
    )
  }

  func testRepeatedAdvertisementRefreshesInPlaceInsteadOfQueueingASecondHint() {
    let first = AlternativeHints.upsert([], observation("a", observedAtMs: 1_000))
    XCTAssertTrue(first.isNew)

    let again = AlternativeHints.upsert(
      first.observations,
      observation("a", observedAtMs: 9_000, rssi: -42)
    )
    XCTAssertFalse(again.isNew)
    XCTAssertEqual(1, again.observations.count)
    XCTAssertEqual(9_000, again.observations[0].observedAtMs)
    XCTAssertEqual(-42, again.observations[0].rssi)
  }

  func testDiscoveryOrderSurvivesARefreshOfAnEarlierBoard() {
    var list = AlternativeHints.upsert([], observation("a", observedAtMs: 1_000)).observations
    list = AlternativeHints.upsert(list, observation("b", observedAtMs: 2_000)).observations
    list = AlternativeHints.upsert(list, observation("a", observedAtMs: 3_000)).observations

    XCTAssertEqual(["a", "b"], list.map { $0.boardId })
  }

  func testObservationExpiresThirtySecondsAfterItsLastAdvertisement() {
    let seen = observation("a", observedAtMs: 1_000)
    XCTAssertFalse(AlternativeHints.isExpired(seen, nowMs: 1_000 + alternativeHintTtlMs - 1))
    XCTAssertTrue(AlternativeHints.isExpired(seen, nowMs: 1_000 + alternativeHintTtlMs))

    // The refreshed copy restarts the window from the newer advertisement.
    let refreshed = AlternativeHints.upsert([seen], observation("a", observedAtMs: 20_000))
    XCTAssertFalse(
      AlternativeHints.isExpired(refreshed.observations[0], nowMs: 1_000 + alternativeHintTtlMs)
    )
  }

  func testPruningASnapshotDropsOnlyTheAgedOutObservations() {
    var state = PresenceScanState()
    state.observations = [observation("old", observedAtMs: 0), observation("fresh", observedAtMs: 25_000)]

    XCTAssertEqual(["fresh"], AlternativeHints.prune(state, nowMs: 31_000).observations.map { $0.boardId })
    XCTAssertEqual(
      ["old", "fresh"],
      AlternativeHints.prune(state, nowMs: 25_000).observations.map { $0.boardId }
    )
  }

  func testRiderStopSourcesMapToConnectIntentEnds() {
    XCTAssertEqual(ConnectIntentEnd.endRide.reason, ConnectIntentEnd.from(pauseSource: ConnectionTraceReason.endRide).reason)
    XCTAssertEqual(ConnectIntentEnd.exit.reason, ConnectIntentEnd.from(pauseSource: ConnectionTraceReason.appExit).reason)
    XCTAssertEqual(
      ConnectIntentEnd.forceQuit.reason,
      ConnectIntentEnd.from(pauseSource: ConnectionTraceReason.taskRemoved).reason
    )
    XCTAssertEqual(
      ConnectIntentEnd.disconnect.reason,
      ConnectIntentEnd.from(pauseSource: ConnectionTraceReason.manualDisconnect).reason
    )
  }
}
