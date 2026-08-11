package expo.modules.vescapecore.diagnostics
import expo.modules.vescapecore.service.SessionConfig

data class DiagnosticContext(
    val phaseWire: String,
    val connectionSeq: Long,
    val connectAttempt: Int,
    val autoReconnectAttempt: Int,
    val canId: Int?,
    val directConnection: Boolean,
    val lastSentCommand: Int?,
    val lastReceivedCommandByte: Int?,
    val lastTelemetryAt: Long,
)

fun interface LocalDiagnosticSink {
    fun record(eventName: String, properties: Map<String, Any?>)
}

// @parity /modules/vescape-core/ios/diagnostics/DiagnosticsRecorder.swift
class DiagnosticsRecorder(
    private val local: LocalDiagnosticSink,
    private val context: () -> DiagnosticContext,
) {
    private var telemetryParseFailedReported = false
    private var telemetryParseFailedCount = 0

    fun telemetryParseFailedCount(): Int = telemetryParseFailedCount

    fun resetTelemetryParseFailedCounters() {
        telemetryParseFailedReported = false
        telemetryParseFailedCount = 0
    }

    fun captureDiagnostic(eventName: String, properties: Map<String, Any?>) {
        local.record(eventName, properties)
    }

    fun recordLocalDiagnostic(
        eventName: String,
        session: SessionConfig?,
        operation: String,
        properties: Map<String, Any?> = emptyMap(),
    ) {
        local.record(eventName, diagnosticProperties(session, operation) + properties)
    }

    fun captureTelemetryParseFailed(payload: ByteArray, session: SessionConfig?) {
        telemetryParseFailedCount += 1
        if (telemetryParseFailedReported) return
        telemetryParseFailedReported = true
        captureDiagnostic(
            "telemetry_parse_failed",
            diagnosticProperties(session, "telemetry") +
                DiagnosticPayloadProperties.telemetry(payload) +
                mapOf(
                    "message" to "Invalid Refloat telemetry payload",
                    "telemetry_parse_failed_count" to telemetryParseFailedCount,
                ),
        )
    }

    fun flushTelemetryDiagnostics(reason: String, session: SessionConfig?) {
        if (telemetryParseFailedCount <= 0) return
        captureDiagnostic(
            "telemetry_parse_failed",
            diagnosticProperties(session, "telemetry") + mapOf(
                "message" to "Telemetry parse failures aggregated",
                "reason" to reason,
                "telemetry_parse_failed_count" to telemetryParseFailedCount,
            ),
        )
        telemetryParseFailedReported = false
        telemetryParseFailedCount = 0
    }

    fun diagnosticProperties(session: SessionConfig?, operation: String): Map<String, Any?> {
        val ctx = context()
        return mapOf(
            "board_id" to session?.appBoardId,
            "ble_id" to session?.deviceId,
            "board_nickname" to session?.deviceName,
            "operation" to operation,
            "phase" to ctx.phaseWire,
            "previous_board_phase" to ctx.phaseWire,
            "current_board_phase" to ctx.phaseWire,
            "connection_seq" to ctx.connectionSeq,
            "connect_attempt" to ctx.connectAttempt,
            "auto_reconnect_attempt" to ctx.autoReconnectAttempt,
            "auto_reconnect_enabled" to session?.autoReconnect,
            "can_id" to ctx.canId,
            "direct_connection" to ctx.directConnection,
            "last_sent_command" to ctx.lastSentCommand,
            "last_received_command_byte" to ctx.lastReceivedCommandByte,
            "last_telemetry_timestamp" to ctx.lastTelemetryAt.takeIf { it > 0L },
        )
    }
}
