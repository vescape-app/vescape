package expo.modules.vescapecore.connection

/**
 * Deadline, not a delay. Preserve the increased allowance across scan/connect attempts until
 * telemetry proves recovery, or a new logical Board Session starts.
 * @parity /modules/vescape-core/ios/connection/GattHandshakeDeadline.swift
 */
internal class GattHandshakeDeadline {
    var timeoutMs: Long = 2_000L
        private set

    fun timedOut() {
        timeoutMs = (timeoutMs + 2_000L).coerceAtMost(6_000L)
    }

    fun reset() {
        timeoutMs = 2_000L
    }
}
