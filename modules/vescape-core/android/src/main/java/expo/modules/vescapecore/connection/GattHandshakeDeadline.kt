package expo.modules.vescapecore.connection

/**
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
