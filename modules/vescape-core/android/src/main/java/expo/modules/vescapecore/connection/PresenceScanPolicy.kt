package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/**
 * How long a Board Presence Scan may look for the selected Board (ADR 0035).
 *
 * The window is measured from scanner readiness, never from foreground entry: Bluetooth
 * initialization must not eat the rider's five seconds.
 */
const val PRESENCE_SCAN_WINDOW_MS = 5_000L

/** One linked Board the Presence Scan is watching for. */
data class PresenceTarget(
    val boardId: String,
    val bleId: String,
    val name: String?,
    val selected: Boolean,
)

/**
 * A linked Board seen advertising during a Presence Scan. Non-selected Boards are observed and
 * reported but never connected — #408 turns those into advisory switch-and-connect hints.
 */
data class PresenceObservation(
    val boardId: String,
    val bleId: String,
    val name: String?,
    val rssi: Int?,
    val observedAtMs: Long,
    val selected: Boolean,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "boardId" to boardId,
        "bleId" to bleId,
        "name" to name,
        "rssi" to rssi,
        "observedAt" to observedAtMs,
        "selected" to selected,
    )
}

/** Everything the eligibility rule needs. No Android types — the rule is unit-testable as data. */
data class PresenceScanEnvironment(
    val linkedBoardCount: Int,
    val selectedBoardId: String?,
    /** BLE id of the selected Board's Board Link. `null` means selected but never linked. */
    val selectedBoardBleId: String?,
    val bluetoothEnabled: Boolean,
    val scanPermissionGranted: Boolean,
    val scannerAvailable: Boolean,
    val sessionActive: Boolean,
    val connectIntentActive: Boolean,
    /** Purpose currently holding the scanner, if any. */
    val activeScanPurpose: ScanPurpose?,
)

/** Everything the promotion rule needs, evaluated once the selected Board has been observed. */
data class PresencePromotionInput(
    val selectedObserved: Boolean,
    val autoConnectEnabled: Boolean,
    /**
     * Board-scoped Automatic Connection Pause deadline for the selected Board, or `null` when the
     * Board is not paused. #406 replaces the permanent manual-stop gates with this map; the rule
     * only ever asks "is it still in the future".
     */
    val pausedUntilMs: Long?,
    val nowMs: Long,
    val sessionActive: Boolean,
    /** Owner already holding the connection, if any. Auto Connect is the weakest real owner. */
    val currentOwner: ConnectionOwner,
)

/** A named outcome. `proceed` is the only non-terminal one; the rest carry a rider-visible reason. */
data class PresenceScanDecision(
    val proceed: Boolean,
    val decision: String,
    val reason: String?,
)

/**
 * Pure policy behind the Board Presence Scan (ADR 0035): may it run, and may an observation of the
 * selected Board promote into a Board Session. Kept free of Android types so both platforms can
 * assert identical external behavior, and so later slices (#406 pause, #407 Auto Start, #408 hints)
 * arbitrate against one rule instead of re-deriving it.
 *
 * @parity /modules/vescape-core/ios/connection/PresenceScanPolicy.swift
 */
object PresenceScanPolicy {
    /**
     * Distinct named reasons, in the order the rider would care about them: work already owning the
     * connection first, then missing configuration, then a radio that cannot answer.
     */
    fun evaluate(environment: PresenceScanEnvironment): PresenceScanDecision {
        val exclusive = environment.activeScanPurpose?.takeIf { it.isExclusive }
        return when {
            environment.sessionActive -> skipped(ConnectionTraceReason.SESSION_ALREADY_ACTIVE)
            environment.connectIntentActive -> skipped(ConnectionTraceReason.CONNECT_INTENT_ACTIVE)
            exclusive != null -> skipped(ConnectionTraceReason.SCANNER_BUSY)
            environment.linkedBoardCount <= 0 -> skipped(ConnectionTraceReason.NO_LINKED_BOARDS)
            environment.selectedBoardId.isNullOrBlank() -> skipped(ConnectionTraceReason.NO_SELECTED_BOARD)
            environment.selectedBoardBleId.isNullOrBlank() -> skipped(ConnectionTraceReason.NO_BOARD_LINK)
            !environment.scanPermissionGranted -> skipped(ConnectionTraceReason.PERMISSION_MISSING)
            !environment.bluetoothEnabled -> skipped(ConnectionTraceReason.BLUETOOTH_DISABLED)
            !environment.scannerAvailable -> skipped(ConnectionTraceReason.SCANNER_UNAVAILABLE)
            environment.activeScanPurpose != null &&
                environment.activeScanPurpose != ScanPurpose.Presence ->
                skipped(ConnectionTraceReason.SCANNER_BUSY)
            else -> PresenceScanDecision(proceed = true, decision = ConnectionTraceDecision.GRANTED, reason = null)
        }
    }

    /** Whether an observed selected Board may become a Board Session. */
    fun promotion(input: PresencePromotionInput): PresenceScanDecision = when {
        input.sessionActive -> denied(ConnectionTraceReason.SESSION_ALREADY_ACTIVE)
        input.currentOwner != ConnectionOwner.None &&
            input.currentOwner != ConnectionOwner.AutoConnect &&
            !ConnectionOwner.AutoConnect.outranks(input.currentOwner) ->
            denied(ownerReason(input.currentOwner))
        !input.selectedObserved -> PresenceScanDecision(
            proceed = false,
            decision = ConnectionTraceDecision.TIMEOUT,
            reason = ConnectionTraceReason.BOARD_NOT_PRESENT,
        )
        isPaused(input.pausedUntilMs, input.nowMs) -> skipped(ConnectionTraceReason.CONNECTION_PAUSED)
        !input.autoConnectEnabled -> skipped(ConnectionTraceReason.AUTO_CONNECT_DISABLED)
        else -> PresenceScanDecision(
            proceed = true,
            decision = ConnectionTraceDecision.GRANTED,
            reason = ConnectionTraceReason.MATCHED,
        )
    }

    /** Deadline for a scan whose radio became usable at [readyAtMs]. */
    fun deadlineAt(readyAtMs: Long, windowMs: Long = PRESENCE_SCAN_WINDOW_MS): Long = readyAtMs + windowMs

    fun isPaused(pausedUntilMs: Long?, nowMs: Long): Boolean = pausedUntilMs != null && pausedUntilMs > nowMs

    private fun ownerReason(owner: ConnectionOwner): String = when (owner) {
        ConnectionOwner.BoardSession -> ConnectionTraceReason.SESSION_ALREADY_ACTIVE
        ConnectionOwner.ConnectIntent -> ConnectionTraceReason.CONNECT_INTENT_ACTIVE
        ConnectionOwner.AddBoardScan, ConnectionOwner.BoardProbe -> ConnectionTraceReason.SCANNER_BUSY
        else -> ConnectionTraceReason.HIGHER_PRIORITY_OWNER
    }

    private fun skipped(reason: String) =
        PresenceScanDecision(proceed = false, decision = ConnectionTraceDecision.SKIPPED, reason = reason)

    private fun denied(reason: String) =
        PresenceScanDecision(proceed = false, decision = ConnectionTraceDecision.DENIED, reason = reason)
}
