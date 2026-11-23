package expo.modules.vescapecore.config

import expo.modules.vescapecore.service.TELEMETRY_STALE_MS
import expo.modules.vescapecore.telemetry.isRefloatEngaged

internal data class BoardRideState(
    val state: Int,
    val switchState: Int,
    val receivedAtMs: Long,
)

// @parity /modules/vescape-core/ios/config/BoardIdleGate.swift
internal object BoardIdleGate {
    private const val HANDTEST_SWITCH_BIT = 0x08

    fun freshSinceMs(referenceMs: Long): Long = referenceMs - TELEMETRY_STALE_MS

    fun blockReason(rideState: BoardRideState?, freshSinceMs: Long): String? = when {
        rideState == null || rideState.receivedAtMs < freshSinceMs -> "No fresh telemetry shows the board idle"
        isRefloatEngaged(rideState.state) -> "Board is engaged (state ${rideState.state})"
        rideState.switchState and HANDTEST_SWITCH_BIT != 0 -> "Board is in handtest"
        else -> null
    }
}
