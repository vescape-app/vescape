import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/PresenceScanPolicyTest.kt
final class PresenceScanPolicyTests: XCTestCase {
  private func environment(
    linkedBoardCount: Int = 1,
    selectedBoardId: String? = "board-1",
    selectedBoardBleId: String? = "AA:BB",
    bluetoothEnabled: Bool = true,
    scanPermissionGranted: Bool = true,
    scannerAvailable: Bool = true,
    sessionActive: Bool = false,
    connectIntentActive: Bool = false,
    activeScanPurpose: ScanPurpose? = nil
  ) -> PresenceScanEnvironment {
    PresenceScanEnvironment(
      linkedBoardCount: linkedBoardCount,
      selectedBoardId: selectedBoardId,
      selectedBoardBleId: selectedBoardBleId,
      bluetoothEnabled: bluetoothEnabled,
      scanPermissionGranted: scanPermissionGranted,
      scannerAvailable: scannerAvailable,
      sessionActive: sessionActive,
      connectIntentActive: connectIntentActive,
      activeScanPurpose: activeScanPurpose
    )
  }

  func testStartsWhenEverythingIsReady() {
    let decision = PresenceScanPolicy.evaluate(environment())

    XCTAssertTrue(decision.proceed)
    XCTAssertEqual(ConnectionTraceDecision.granted, decision.decision)
  }

  func testEachRefusalCarriesItsOwnReason() {
    let cases: [(PresenceScanEnvironment, String)] = [
      (environment(linkedBoardCount: 0), ConnectionTraceReason.noLinkedBoards),
      (environment(selectedBoardId: nil), ConnectionTraceReason.noSelectedBoard),
      (environment(selectedBoardBleId: nil), ConnectionTraceReason.noBoardLink),
      (environment(bluetoothEnabled: false), ConnectionTraceReason.bluetoothDisabled),
      (environment(scanPermissionGranted: false), ConnectionTraceReason.permissionMissing),
      (environment(scannerAvailable: false), ConnectionTraceReason.scannerUnavailable),
      (environment(sessionActive: true), ConnectionTraceReason.sessionAlreadyActive),
      (environment(connectIntentActive: true), ConnectionTraceReason.connectIntentActive),
      (environment(activeScanPurpose: .addBoard), ConnectionTraceReason.scannerBusy),
      (environment(activeScanPurpose: .boardProbe), ConnectionTraceReason.scannerBusy),
    ]

    for (env, reason) in cases {
      let decision = PresenceScanPolicy.evaluate(env)
      XCTAssertFalse(decision.proceed, reason)
      XCTAssertEqual(reason, decision.reason)
    }
  }

  func testMissingPermissionOutranksDisabledBluetooth() {
    let decision = PresenceScanPolicy.evaluate(
      environment(bluetoothEnabled: false, scanPermissionGranted: false)
    )

    XCTAssertEqual(ConnectionTraceReason.permissionMissing, decision.reason)
  }

  func testDeadlineStartsAtBluetoothReadiness() {
    XCTAssertEqual(5_000, presenceScanWindowMs)
    XCTAssertEqual(9_000, PresenceScanPolicy.deadlineAt(readyAtMs: 4_000))
  }

  private func promotion(
    selectedObserved: Bool = true,
    autoConnectEnabled: Bool = true,
    pausedUntilMs: Int64? = nil,
    nowMs: Int64 = 1_000,
    sessionActive: Bool = false,
    currentOwner: ConnectionOwner = .none
  ) -> PresenceScanDecision {
    PresenceScanPolicy.promotion(
      PresencePromotionInput(
        selectedObserved: selectedObserved,
        autoConnectEnabled: autoConnectEnabled,
        pausedUntilMs: pausedUntilMs,
        nowMs: nowMs,
        sessionActive: sessionActive,
        currentOwner: currentOwner
      )
    )
  }

  func testPromotesObservedSelectedBoardWhenAutoConnectAllows() {
    let decision = promotion()

    XCTAssertTrue(decision.proceed)
    XCTAssertEqual(ConnectionTraceReason.matched, decision.reason)
  }

  func testRefusesPromotionWithNamedReasons() {
    XCTAssertEqual(ConnectionTraceReason.autoConnectDisabled, promotion(autoConnectEnabled: false).reason)
    XCTAssertEqual(
      ConnectionTraceReason.connectionPaused,
      promotion(pausedUntilMs: 2_000, nowMs: 1_000).reason
    )
    XCTAssertEqual(ConnectionTraceReason.boardNotPresent, promotion(selectedObserved: false).reason)
    XCTAssertEqual(ConnectionTraceReason.sessionAlreadyActive, promotion(sessionActive: true).reason)
    XCTAssertEqual(
      ConnectionTraceReason.connectIntentActive,
      promotion(currentOwner: .connectIntent).reason
    )
    XCTAssertEqual(
      ConnectionTraceReason.higherPriorityOwner,
      promotion(currentOwner: .autoStart).reason
    )
  }

  func testExpiredPauseNoLongerBlocksPromotion() {
    XCTAssertTrue(promotion(pausedUntilMs: 500, nowMs: 1_000).proceed)
  }

  func testWeakerOwnersDoNotBlockAutoConnect() {
    XCTAssertTrue(promotion(currentOwner: .alternativeHint).proceed)
    XCTAssertTrue(promotion(currentOwner: .autoConnect).proceed)
  }
}
