package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceOwner
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/** Scanner-exclusive owners sit outside the connection precedence chain. */
private const val EXCLUSIVE_PRECEDENCE = -1

/**
 * Who owns connection work, in the precedence order of ADR 0035. Explicit ownership, not a phase
 * string inferred after the fact: Android Auto Start (#407) and the alternative-Board hint (#408)
 * arbitrate against this enum.
 *
 * [wireValue] is the trace vocabulary, so a decision logs the same word JS renders.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionOwner.swift
 * @parity /src/modules/board/store/bleStore.ts `ConnectionOwner`
 */
enum class ConnectionOwner(val wireValue: String, val precedence: Int) {
    BoardSession(ConnectionTraceOwner.BOARD_SESSION, 0),
    ConnectIntent(ConnectionTraceOwner.CONNECT_INTENT, 1),
    AutoStart(ConnectionTraceOwner.AUTO_START, 2),
    AutoConnect(ConnectionTraceOwner.AUTO_CONNECT, 3),
    AlternativeHint(ConnectionTraceOwner.ALTERNATIVE_HINT, 4),

    /** Exclusive scanner owners. Outside the connection precedence chain — they cannot be preempted. */
    AddBoardScan(ConnectionTraceOwner.ADD_BOARD_SCAN, EXCLUSIVE_PRECEDENCE),
    BoardProbe(ConnectionTraceOwner.BOARD_PROBE, EXCLUSIVE_PRECEDENCE),

    None(ConnectionTraceOwner.NONE, Int.MAX_VALUE),
    ;

    val isExclusiveScannerOwner: Boolean
        get() = this == AddBoardScan || this == BoardProbe

    /** True when this owner may take work away from [other]. Exclusive owners never yield. */
    fun outranks(other: ConnectionOwner): Boolean {
        if (other == None) return true
        if (other.isExclusiveScannerOwner) return false
        if (isExclusiveScannerOwner) return true
        return precedence < other.precedence
    }

    companion object {
        fun fromWire(value: String?): ConnectionOwner =
            entries.firstOrNull { it.wireValue == value } ?: None
    }
}

/** Outcome of asking [ConnectionOwnership] for the connection. */
data class OwnershipDecision(
    val granted: Boolean,
    val owner: ConnectionOwner,
    val previousOwner: ConnectionOwner,
    val reason: String?,
)

/**
 * Single source of truth for who currently owns connection work. Pure and synchronous so both the
 * Presence Scan and later Auto Start arbitration (#407) resolve against the same precedence rules
 * instead of guessing from phases.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionOwner.swift `ConnectionOwnership`
 */
class ConnectionOwnership {
    companion object {
        /** Process-wide owner of connection work. Later slices arbitrate against this instance. */
        val shared = ConnectionOwnership()
    }

    @Volatile
    var current: ConnectionOwner = ConnectionOwner.None
        private set

    @Synchronized
    fun request(owner: ConnectionOwner): OwnershipDecision {
        val previous = current
        if (previous == owner) {
            return OwnershipDecision(granted = true, owner = owner, previousOwner = previous, reason = null)
        }
        if (!owner.outranks(previous)) {
            return OwnershipDecision(
                granted = false,
                owner = previous,
                previousOwner = previous,
                reason = denialReason(previous),
            )
        }
        current = owner
        return OwnershipDecision(granted = true, owner = owner, previousOwner = previous, reason = null)
    }

    /** Release only if [owner] still holds it, so a stale release cannot unseat a newer owner. */
    @Synchronized
    fun release(owner: ConnectionOwner): Boolean {
        if (current != owner) return false
        current = ConnectionOwner.None
        return true
    }

    private fun denialReason(previous: ConnectionOwner): String = when (previous) {
        ConnectionOwner.BoardSession -> ConnectionTraceReason.SESSION_ALREADY_ACTIVE
        ConnectionOwner.ConnectIntent -> ConnectionTraceReason.CONNECT_INTENT_ACTIVE
        ConnectionOwner.AddBoardScan, ConnectionOwner.BoardProbe -> ConnectionTraceReason.SCANNER_BUSY
        else -> ConnectionTraceReason.HIGHER_PRIORITY_OWNER
    }
}
