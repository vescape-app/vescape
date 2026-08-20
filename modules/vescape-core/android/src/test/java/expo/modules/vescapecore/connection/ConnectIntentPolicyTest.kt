package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/ConnectIntentTests.swift */
class ConnectIntentPolicyTest {
  @Test
  fun persistsIndefinitelyWhenAutoCloseIsDisabled() {
    val intent = ConnectIntent(boardId = "board-1", createdAtMs = 0L, autoCloseMs = null)

    assertNull(intent.autoCloseAtMs)
    assertFalse(ConnectIntentPolicy.isExpired(intent, nowMs = Long.MAX_VALUE / 2))
  }

  @Test
  fun endsAtTheConfiguredAutoCloseDeadline() {
    val intent = ConnectIntent(boardId = "board-1", createdAtMs = 1_000L, autoCloseMs = 30_000L)

    assertEquals(31_000L, intent.autoCloseAtMs)
    assertFalse(ConnectIntentPolicy.isExpired(intent, nowMs = 30_999L))
    assertTrue(ConnectIntentPolicy.isExpired(intent, nowMs = 31_000L))
  }

  @Test
  fun outranksAutoStartAndAutoConnectButNotABoardSession() {
    assertTrue(ConnectIntentPolicy.outranks(ConnectionOwner.AutoStart))
    assertTrue(ConnectIntentPolicy.outranks(ConnectionOwner.AutoConnect))
    assertTrue(ConnectIntentPolicy.outranks(ConnectionOwner.AlternativeHint))
    assertFalse(ConnectIntentPolicy.outranks(ConnectionOwner.BoardSession))
  }

  @Test
  fun everyEndingMapsToATerminalReason() {
    assertEquals(ConnectionTraceReason.MANUAL_DISCONNECT, ConnectIntentEnd.Disconnect.reason)
    assertEquals(ConnectionTraceReason.APP_EXIT, ConnectIntentEnd.Exit.reason)
    assertEquals(ConnectionTraceReason.TASK_REMOVED, ConnectIntentEnd.ForceQuit.reason)
    assertEquals(ConnectionTraceReason.MATCHED, ConnectIntentEnd.Connected.reason)
    assertEquals(ConnectionTraceReason.MECHANICAL_TEARDOWN, ConnectIntentEnd.SessionTeardown.reason)
    assertEquals(ConnectionTraceReason.AUTO_CLOSE, ConnectIntentEnd.AutoClose.reason)
  }

  @Test
  fun exclusiveScannerOwnersNeverYield() {
    assertFalse(ConnectionOwner.BoardSession.outranks(ConnectionOwner.AddBoardScan))
    assertFalse(ConnectionOwner.ConnectIntent.outranks(ConnectionOwner.BoardProbe))
  }

  @Test
  fun ownershipRegistryFollowsPrecedence() {
    val ownership = ConnectionOwnership()

    assertTrue(ownership.request(ConnectionOwner.AutoConnect).granted)

    val denied = ownership.request(ConnectionOwner.AlternativeHint)
    assertFalse(denied.granted)
    assertEquals(ConnectionTraceReason.HIGHER_PRIORITY_OWNER, denied.reason)

    assertTrue(ownership.request(ConnectionOwner.ConnectIntent).granted)
    assertEquals(ConnectionOwner.ConnectIntent, ownership.current)

    assertFalse(ownership.release(ConnectionOwner.AutoConnect))
    assertTrue(ownership.release(ConnectionOwner.ConnectIntent))
    assertEquals(ConnectionOwner.None, ownership.current)
  }
}
