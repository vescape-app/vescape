package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import java.util.concurrent.atomic.AtomicLong

/**
 * Why the BLE scanner is running. One vocabulary for every scan in the app, so a callback can say
 * which operation it belongs to instead of the code guessing from surrounding state.
 *
 * @parity /modules/vescape-core/ios/connection/ScannerCoordinator.swift `ScanPurpose`
 * @parity /modules/vescape-core/src/index.ts `ScanPurpose`
 */
enum class ScanPurpose(val wireValue: String, val owner: ConnectionOwner) {
    /** Foreground-entry Board Presence Scan (ADR 0035). Yields to every exclusive owner. */
    Presence("presence", ConnectionOwner.AutoConnect),

    /** Rider-driven Add Board discovery. Exclusive: never preempted. */
    AddBoard("add_board", ConnectionOwner.AddBoardScan),

    /** Board Probe handshake during linking/setup. Exclusive: never preempted. */
    BoardProbe("board_probe", ConnectionOwner.BoardProbe),

    /** Search backing an explicit Connect Intent. */
    ConnectIntent("connect_intent", ConnectionOwner.ConnectIntent),

    /** Mid-ride rediscovery of the Board Session's own peripheral. */
    Reconnect("reconnect", ConnectionOwner.BoardSession),
    ;

    val isExclusive: Boolean get() = owner.isExclusiveScannerOwner

    companion object {
        fun fromWire(value: String?): ScanPurpose? = entries.firstOrNull { it.wireValue == value }
    }
}

/** A granted scan, identified by its operation token. */
data class ScanOperation(val token: Long, val purpose: ScanPurpose)

/** Result of asking [ScannerCoordinator] for the radio. */
sealed interface ScanAcquisition {
    data class Granted(val operation: ScanOperation) : ScanAcquisition

    data class Denied(val reason: String, val heldBy: ScanPurpose?) : ScanAcquisition
}

/**
 * The one arbiter of BLE scanner ownership. Every scan takes a token; BLE scan callbacks outlive
 * their operation, so a callback that cannot prove it is [isCurrent] is dropped rather than allowed
 * to mutate state belonging to a newer scan.
 *
 * Add Board scan and Board Probe hold the scanner exclusively and cannot be preempted — a Presence
 * Scan asking while either runs is denied with `scanner_busy`.
 *
 * @parity /modules/vescape-core/ios/connection/ScannerCoordinator.swift
 */
class ScannerCoordinator {
    companion object {
        /** Process-wide arbiter. Add Board scan, Board Probe, reconnect, and Presence Scan share it. */
        val shared = ScannerCoordinator()
    }

    private val tokens = AtomicLong(0)

    @Volatile
    var active: ScanOperation? = null
        private set

    val activePurpose: ScanPurpose? get() = active?.purpose

    @Synchronized
    fun acquire(purpose: ScanPurpose): ScanAcquisition {
        val holder = active
        if (holder != null && holder.purpose != purpose && !purpose.owner.outranks(holder.purpose.owner)) {
            return ScanAcquisition.Denied(ConnectionTraceReason.SCANNER_BUSY, holder.purpose)
        }
        val operation = ScanOperation(token = tokens.incrementAndGet(), purpose = purpose)
        active = operation
        return ScanAcquisition.Granted(operation)
    }

    /** True only for the operation that still owns the scanner. Stale callbacks fail here. */
    fun isCurrent(operation: ScanOperation?): Boolean =
        operation != null && active?.token == operation.token

    /** Release only if [operation] still owns the scanner, so a late stop cannot kill a newer scan. */
    @Synchronized
    fun release(operation: ScanOperation?): Boolean {
        if (!isCurrent(operation)) return false
        active = null
        return true
    }
}
