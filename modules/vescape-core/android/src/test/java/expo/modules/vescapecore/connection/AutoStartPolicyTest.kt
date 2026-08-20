package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Arbitration of Android Auto Start (#407). Every precedence pair against [ConnectionOwner], every
 * board-selection outcome, and the detected-Board pause rule.
 */
class AutoStartPolicyTest {
    private val now = 1_000_000L

    private fun environment(
        detectedBoardId: String? = "board-a",
        selectedBoardId: String? = "board-a",
        autoStartEnabled: Boolean = true,
        sessionActive: Boolean = false,
        connectIntentActive: Boolean = false,
        currentOwner: ConnectionOwner = ConnectionOwner.None,
        activeScanPurpose: ScanPurpose? = null,
        boardProbeActive: Boolean = false,
        pausedUntilMs: Long? = null,
    ) = AutoStartEnvironment(
        detectedBoardId = detectedBoardId,
        selectedBoardId = selectedBoardId,
        autoStartEnabled = autoStartEnabled,
        sessionActive = sessionActive,
        connectIntentActive = connectIntentActive,
        currentOwner = currentOwner,
        activeScanPurpose = activeScanPurpose,
        boardProbeActive = boardProbeActive,
        pausedUntilMs = pausedUntilMs,
        nowMs = now,
    )

    // --- precedence pairs: every owner that may hold the connection, against Auto Start ---

    @Test
    fun `board session owner rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.BoardSession))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.DENIED, decision.decision)
        assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, decision.reason)
    }

    @Test
    fun `connect intent owner rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.ConnectIntent))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.DENIED, decision.decision)
        assertEquals(ConnectionTraceReason.CONNECT_INTENT_ACTIVE, decision.reason)
    }

    @Test
    fun `an auto start already owning the connection is not denied by itself`() {
        assertTrue(AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.AutoStart)).proceed)
    }

    @Test
    fun `auto connect owner yields to auto start`() {
        assertTrue(AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.AutoConnect)).proceed)
    }

    @Test
    fun `alternative hint owner yields to auto start`() {
        assertTrue(AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.AlternativeHint)).proceed)
    }

    @Test
    fun `idle connection yields to auto start`() {
        assertTrue(AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.None)).proceed)
    }

    @Test
    fun `add board scan holds the scanner exclusively against auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.AddBoardScan))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceReason.SCANNER_BUSY, decision.reason)
    }

    @Test
    fun `board probe holds the scanner exclusively against auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(currentOwner = ConnectionOwner.BoardProbe))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceReason.SCANNER_BUSY, decision.reason)
    }

    @Test
    fun `precedence order matches the approved chain`() {
        assertEquals(
            listOf(
                ConnectionOwner.BoardSession,
                ConnectionOwner.ConnectIntent,
                ConnectionOwner.AutoStart,
                ConnectionOwner.AutoConnect,
                ConnectionOwner.AlternativeHint,
            ),
            listOf(
                ConnectionOwner.AlternativeHint,
                ConnectionOwner.AutoConnect,
                ConnectionOwner.AutoStart,
                ConnectionOwner.ConnectIntent,
                ConnectionOwner.BoardSession,
            ).sortedBy { it.precedence },
        )
    }

    // --- state that rejects independently of the recorded owner ---

    @Test
    fun `an active or reconnecting board session rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(sessionActive = true))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.DENIED, decision.decision)
        assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, decision.reason)
    }

    @Test
    fun `an explicit connect intent rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(connectIntentActive = true))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.DENIED, decision.decision)
        assertEquals(ConnectionTraceReason.CONNECT_INTENT_ACTIVE, decision.reason)
    }

    @Test
    fun `an in-flight board probe rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(boardProbeActive = true))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceReason.SCANNER_BUSY, decision.reason)
    }

    @Test
    fun `an exclusive scan rejects auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(activeScanPurpose = ScanPurpose.AddBoard))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceReason.SCANNER_BUSY, decision.reason)
    }

    @Test
    fun `a session scan does not by itself reject auto start`() {
        // The Board Session that owns a reconnect scan rejects via ownership, with its own reason.
        val decision = AutoStartPolicy.evaluate(
            environment(activeScanPurpose = ScanPurpose.Reconnect, currentOwner = ConnectionOwner.BoardSession),
        )
        assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, decision.reason)
    }

    // --- passive Presence Scan yields, and is preempted ---

    @Test
    fun `passive presence scan yields and is cancelled`() {
        val decision = AutoStartPolicy.evaluate(
            environment(activeScanPurpose = ScanPurpose.Presence, currentOwner = ConnectionOwner.AutoConnect),
        )
        assertTrue(decision.proceed)
        assertTrue(decision.cancelsPresenceScan)
        assertEquals(ConnectionTraceReason.MATCHED, decision.reason)
    }

    @Test
    fun `nothing is cancelled when no presence scan runs`() {
        assertFalse(AutoStartPolicy.evaluate(environment()).cancelsPresenceScan)
    }

    // --- board selection outcomes ---

    @Test
    fun `detected board that is already selected keeps the selection`() {
        val decision = AutoStartPolicy.evaluate(environment(detectedBoardId = "board-a", selectedBoardId = "board-a"))
        assertTrue(decision.proceed)
        assertFalse(decision.switchesSelectedBoard)
    }

    @Test
    fun `detected board other than the selected one switches selection`() {
        val decision = AutoStartPolicy.evaluate(environment(detectedBoardId = "board-b", selectedBoardId = "board-a"))
        assertTrue(decision.proceed)
        assertTrue(decision.switchesSelectedBoard)
    }

    @Test
    fun `detected board with no selection at all becomes selected`() {
        val decision = AutoStartPolicy.evaluate(environment(detectedBoardId = "board-b", selectedBoardId = null))
        assertTrue(decision.proceed)
        assertTrue(decision.switchesSelectedBoard)
    }

    @Test
    fun `an address no linked board claims is ignored`() {
        val decision = AutoStartPolicy.evaluate(environment(detectedBoardId = null))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.SKIPPED, decision.decision)
        assertEquals(ConnectionTraceReason.NO_BOARD_LINK, decision.reason)
    }

    @Test
    fun `auto start disabled skips before any owner is consulted`() {
        val decision = AutoStartPolicy.evaluate(environment(autoStartEnabled = false))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceReason.AUTO_START_DISABLED, decision.reason)
    }

    // --- pause is board scoped, and scoped to the *detected* Board ---

    @Test
    fun `a paused detected board cannot auto start`() {
        val decision = AutoStartPolicy.evaluate(environment(pausedUntilMs = now + 60_000L))
        assertFalse(decision.proceed)
        assertEquals(ConnectionTraceDecision.SKIPPED, decision.decision)
        assertEquals(ConnectionTraceReason.CONNECTION_PAUSED, decision.reason)
    }

    @Test
    fun `an expired pause on the detected board does not block auto start`() {
        assertTrue(AutoStartPolicy.evaluate(environment(pausedUntilMs = now - 1L)).proceed)
    }

    @Test
    fun `a pause on another board does not block the detected board`() {
        // The caller reads the pause map for the detected Board, so another Board's pause is simply
        // absent here — the detected Board still starts, and it still switches the selection.
        val decision = AutoStartPolicy.evaluate(
            environment(detectedBoardId = "board-b", selectedBoardId = "board-a", pausedUntilMs = null),
        )
        assertTrue(decision.proceed)
        assertTrue(decision.switchesSelectedBoard)
    }

    // --- stale callbacks ---

    @Test
    fun `a stale presence callback cannot replace a newer owner`() {
        val ownership = ConnectionOwnership()
        // A newer, higher-priority owner took the connection between the OS callback and arbitration.
        assertTrue(ownership.request(ConnectionOwner.BoardSession).granted)
        val late = ownership.request(ConnectionOwner.AutoStart)
        assertFalse(late.granted)
        assertEquals(ConnectionOwner.BoardSession, late.owner)
        assertEquals(ConnectionTraceReason.SESSION_ALREADY_ACTIVE, late.reason)
    }

    @Test
    fun `a stale auto start release cannot unseat the board session it handed off to`() {
        val ownership = ConnectionOwnership()
        assertTrue(ownership.request(ConnectionOwner.AutoStart).granted)
        assertTrue(ownership.request(ConnectionOwner.BoardSession).granted)
        assertFalse(ownership.release(ConnectionOwner.AutoStart))
        assertEquals(ConnectionOwner.BoardSession, ownership.current)
    }

    @Test
    fun `an owner rejection outranks a pause on the same board`() {
        val decision = AutoStartPolicy.evaluate(
            environment(currentOwner = ConnectionOwner.ConnectIntent, pausedUntilMs = now + 60_000L),
        )
        assertEquals(ConnectionTraceReason.CONNECT_INTENT_ACTIVE, decision.reason)
    }
}
