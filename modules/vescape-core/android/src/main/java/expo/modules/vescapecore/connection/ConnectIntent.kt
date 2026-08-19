package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/**
 * An explicit rider Connect. It outranks Android Auto Start and Auto Connect, and — when Auto Close
 * is disabled — keeps searching indefinitely (ADR 0035). #409 makes linking end in one of these.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectIntent.swift
 */
data class ConnectIntent(
    val boardId: String,
    val createdAtMs: Long,
    /** Configured Auto Close window, or `null` when Auto Close is disabled — then it never expires. */
    val autoCloseMs: Long?,
) {
    val owner: ConnectionOwner get() = ConnectionOwner.ConnectIntent

    /** Absolute Auto Close deadline, or `null` when the intent may persist indefinitely. */
    val autoCloseAtMs: Long? get() = autoCloseMs?.let { createdAtMs + it }
}

/** Every way an explicit Connect Intent ends. Each maps to one terminal trace reason. */
enum class ConnectIntentEnd(val reason: String) {
    Disconnect(ConnectionTraceReason.MANUAL_DISCONNECT),
    EndRide(ConnectionTraceReason.END_RIDE),
    Exit(ConnectionTraceReason.APP_EXIT),
    ForceQuit(ConnectionTraceReason.TASK_REMOVED),
    Connected(ConnectionTraceReason.MATCHED),
    SessionTeardown(ConnectionTraceReason.MECHANICAL_TEARDOWN),
    AutoClose(ConnectionTraceReason.AUTO_CLOSE),
}

/**
 * Pure lifetime rules for [ConnectIntent]. Native holds the intent; this decides when it dies.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectIntent.swift `ConnectIntentPolicy`
 */
object ConnectIntentPolicy {
    /** Auto Close is the only clock-driven end. Disabled Auto Close ⇒ the intent never expires. */
    fun isExpired(intent: ConnectIntent, nowMs: Long): Boolean {
        val deadline = intent.autoCloseAtMs ?: return false
        return nowMs >= deadline
    }

    /** An explicit Connect Intent outranks Auto Start, Auto Connect, and alternative hints. */
    fun outranks(other: ConnectionOwner): Boolean = ConnectionOwner.ConnectIntent.outranks(other)

    /** An explicit Connect clears any Automatic Connection Pause on its Board (ADR 0035, #406). */
    fun clearsPause(): Boolean = true
}
