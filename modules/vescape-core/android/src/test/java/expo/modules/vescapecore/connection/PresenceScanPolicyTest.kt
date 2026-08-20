package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/PresenceScanPolicyTests.swift */
class PresenceScanPolicyTest {
  private fun environment(
    linkedBoardCount: Int = 1,
    selectedBoardId: String? = "board-1",
    selectedBoardBleId: String? = "AA:BB",
    bluetoothEnabled: Boolean = true,
    scanPermissionGranted: Boolean = true,
    scannerAvailable: Boolean = true,
    sessionActive: Boolean = false,
    connectIntentActive: Boolean = false,
    activeScanPurpose: ScanPurpose? = null,
  ) = PresenceScanEnvironment(
    linkedBoardCount = linkedBoardCount,
    selectedBoardId = selectedBoardId,
    selectedBoardBleId = selectedBoardBleId,
    bluetoothEnabled = bluetoothEnabled,
    scanPermissionGranted = scanPermissionGranted,
    scannerAvailable = scannerAvailable,
    sessionActive = sessionActive,
    connectIntentActive = connectIntentActive,
    activeScanPurpose = activeScanPurpose,
  )

  @Test
  fun startsWhenEverythingIsReady() {
    val decision = PresenceScanPolicy.evaluate(environment())

    assertTrue(decision.proceed)
    assertEquals(ConnectionTraceDecision.GRANTED, decision.decision)
  }

  @Test
  fun eachRefusalCarriesItsOwnReason() {
    val cases = listOf(
      environment(linkedBoardCount = 0) to ConnectionTraceReason.NO_LINKED_BOARDS,
      environment(selectedBoardId = null) to ConnectionTraceReason.NO_SELECTED_BOARD,
      environment(selectedBoardBleId = null) to ConnectionTraceReason.NO_BOARD_LINK,
      environment(bluetoothEnabled = false) to ConnectionTraceReason.BLUETOOTH_DISABLED,
      environment(scanPermissionGranted = false) to ConnectionTraceReason.PERMISSION_MISSING,
      environment(scannerAvailable = false) to ConnectionTraceReason.SCANNER_UNAVAILABLE,
      environment(sessionActive = true) to ConnectionTraceReason.SESSION_ALREADY_ACTIVE,
      environment(connectIntentActive = true) to ConnectionTraceReason.CONNECT_INTENT_ACTIVE,
      environment(activeScanPurpose = ScanPurpose.AddBoard) to ConnectionTraceReason.SCANNER_BUSY,
      environment(activeScanPurpose = ScanPurpose.BoardProbe) to ConnectionTraceReason.SCANNER_BUSY,
    )

    for ((env, reason) in cases) {
      val decision = PresenceScanPolicy.evaluate(env)
      assertFalse(reason, decision.proceed)
      assertEquals(reason, decision.reason)
    }
  }

  @Test
  fun missingPermissionOutranksDisabledBluetooth() {
    val decision = PresenceScanPolicy.evaluate(
      environment(bluetoothEnabled = false, scanPermissionGranted = false),
    )

    assertEquals(ConnectionTraceReason.PERMISSION_MISSING, decision.reason)
  }

  @Test
  fun deadlineStartsAtBluetoothReadiness() {
    assertEquals(5_000L, PRESENCE_SCAN_WINDOW_MS)
    assertEquals(9_000L, PresenceScanPolicy.deadlineAt(readyAtMs = 4_000L))
  }

  private fun promotion(
    selectedObserved: Boolean = true,
    autoConnectEnabled: Boolean = true,
    pausedUntilMs: Long? = null,
    nowMs: Long = 1_000L,
    sessionActive: Boolean = false,
    currentOwner: ConnectionOwner = ConnectionOwner.None,
  ) = PresenceScanPolicy.promotion(
    PresencePromotionInput(
      selectedObserved = selectedObserved,
      autoConnectEnabled = autoConnectEnabled,
      pausedUntilMs = pausedUntilMs,
      nowMs = nowMs,
      sessionActive = sessionActive,
      currentOwner = currentOwner,
    ),
  )

  @Test
  fun promotesObservedSelectedBoardWhenAutoConnectAllows() {
    val decision = promotion()

    assertTrue(decision.proceed)
    assertEquals(ConnectionTraceReason.MATCHED, decision.reason)
  }

  @Test
  fun refusesPromotionWithNamedReasons() {
    assertEquals(ConnectionTraceReason.AUTO_CONNECT_DISABLED, promotion(autoConnectEnabled = false).reason)
    assertEquals(
      ConnectionTraceReason.CONNECTION_PAUSED,
      promotion(pausedUntilMs = 2_000L, nowMs = 1_000L).reason,
    )
    assertEquals(ConnectionTraceReason.BOARD_NOT_PRESENT, promotion(selectedObserved = false).reason)
    assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, promotion(sessionActive = true).reason)
    assertEquals(
      ConnectionTraceReason.CONNECT_INTENT_ACTIVE,
      promotion(currentOwner = ConnectionOwner.ConnectIntent).reason,
    )
    assertEquals(
      ConnectionTraceReason.HIGHER_PRIORITY_OWNER,
      promotion(currentOwner = ConnectionOwner.AutoStart).reason,
    )
  }

  @Test
  fun expiredPauseNoLongerBlocksPromotion() {
    assertTrue(promotion(pausedUntilMs = 500L, nowMs = 1_000L).proceed)
  }

  @Test
  fun weakerOwnersDoNotBlockAutoConnect() {
    assertTrue(promotion(currentOwner = ConnectionOwner.AlternativeHint).proceed)
    assertTrue(promotion(currentOwner = ConnectionOwner.AutoConnect).proceed)
  }
}
