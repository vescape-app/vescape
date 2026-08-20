package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/**
 * Everything the Auto Start arbitration needs, as data. No Android types, so the rule is unit
 * testable without a Companion Device association, a radio, or a service.
 *
 * Auto Start is *per Board*: [detectedBoardId] is the Board whose BLE address the OS just reported,
 * and every board-scoped input here — the Automatic Connection Pause above all — is read for that
 * Board, never for [selectedBoardId] (ADR 0035, #407).
 */
data class AutoStartEnvironment(
    /** Linked Board matching the reported address, or `null` when no linked Board claims it. */
    val detectedBoardId: String?,
    /** Board currently selected. Auto Start may change it; that is the point of the feature. */
    val selectedBoardId: String?,
    /** Companion Device presence master switch. */
    val autoStartEnabled: Boolean,
    /** A Board Session exists — connected, stale, or reconnecting. */
    val sessionActive: Boolean,
    val connectIntentActive: Boolean,
    /** Owner currently holding connection work, from [ConnectionOwnership]. */
    val currentOwner: ConnectionOwner,
    /** Purpose currently holding the scanner, if any. */
    val activeScanPurpose: ScanPurpose?,
    /** Board Probe handshake in flight outside the scanner (linking/setup). */
    val boardProbeActive: Boolean,
    /** Automatic Connection Pause deadline **of the detected Board**, or `null` when not paused. */
    val pausedUntilMs: Long?,
    val nowMs: Long,
)

/** A named Auto Start outcome. `proceed` is the only one that starts a durable Board Session. */
data class AutoStartDecision(
    val proceed: Boolean,
    val decision: String,
    val reason: String,
    /** Accepted Auto Start preempts a passive Presence Scan holding the radio. */
    val cancelsPresenceScan: Boolean = false,
    /** Accepted Auto Start for a Board that is not the selected one changes the selection. */
    val switchesSelectedBoard: Boolean = false,
)

/**
 * Pure arbitration for Android Auto Start (Companion Device presence), ADR 0035 / #407.
 *
 * Precedence is Board Session > explicit Connect Intent > Auto Start > Auto Connect > alternative
 * hint, resolved against [ConnectionOwner.outranks] — never re-derived here, and never inferred from
 * Board phase strings. A higher-priority owner *denies* Auto Start; missing configuration or a
 * paused Board *skips* it. Only a passive Presence Scan (the Auto Connect owner) or an idle
 * connection yields, and that yield is what keeps the aggressive Auto Start promise: the armed Board
 * cancels the scan, takes the selection, and gets a durable Board Session.
 *
 * Android-only by nature: Companion Device presence has no iOS peer, so this policy has no `@parity`
 * partner. The precedence it consumes is shared and lives in [ConnectionOwner].
 */
object AutoStartPolicy {
    /** Named reasons in the order the rider would care about them: owners, config, then pause. */
    fun evaluate(environment: AutoStartEnvironment): AutoStartDecision {
        val detected = environment.detectedBoardId
        val exclusiveScan = environment.activeScanPurpose?.takeIf { it.isExclusive }
        return when {
            detected.isNullOrBlank() -> skipped(ConnectionTraceReason.NO_BOARD_LINK)
            !environment.autoStartEnabled -> skipped(ConnectionTraceReason.AUTO_START_DISABLED)
            environment.sessionActive -> denied(ConnectionTraceReason.SESSION_ALREADY_ACTIVE)
            environment.connectIntentActive -> denied(ConnectionTraceReason.CONNECT_INTENT_ACTIVE)
            environment.boardProbeActive || exclusiveScan != null -> denied(ConnectionTraceReason.SCANNER_BUSY)
            !ConnectionOwner.AutoStart.outranks(environment.currentOwner) &&
                environment.currentOwner != ConnectionOwner.AutoStart ->
                denied(ownerReason(environment.currentOwner))
            PresenceScanPolicy.isPaused(environment.pausedUntilMs, environment.nowMs) ->
                skipped(ConnectionTraceReason.CONNECTION_PAUSED)
            else -> AutoStartDecision(
                proceed = true,
                decision = ConnectionTraceDecision.GRANTED,
                reason = ConnectionTraceReason.MATCHED,
                cancelsPresenceScan = environment.activeScanPurpose == ScanPurpose.Presence,
                switchesSelectedBoard = detected != environment.selectedBoardId,
            )
        }
    }

    private fun ownerReason(owner: ConnectionOwner): String = when (owner) {
        ConnectionOwner.BoardSession -> ConnectionTraceReason.SESSION_ALREADY_ACTIVE
        ConnectionOwner.ConnectIntent -> ConnectionTraceReason.CONNECT_INTENT_ACTIVE
        ConnectionOwner.AddBoardScan, ConnectionOwner.BoardProbe -> ConnectionTraceReason.SCANNER_BUSY
        else -> ConnectionTraceReason.HIGHER_PRIORITY_OWNER
    }

    private fun skipped(reason: String) =
        AutoStartDecision(proceed = false, decision = ConnectionTraceDecision.SKIPPED, reason = reason)

    private fun denied(reason: String) =
        AutoStartDecision(proceed = false, decision = ConnectionTraceDecision.DENIED, reason = reason)
}
