package expo.modules.vescapecore.diagnostics

import android.content.Context

/**
 * Connection trace contract (ADR 0035). One correlated workflow spans lifecycle, scanner,
 * connection, service, and recording code, so every layer emits child events under the same
 * `workflow_id` instead of minting its own correlation.
 *
 * Local Diagnostic Events (ADR 0007) intentionally carry full Board ids and BLE ids; they stay on
 * device and in platform logs. Authentication data, PINs, tokens, and telemetry payloads are
 * excluded by contract — see [ConnectionTrace.isSensitiveField].
 *
 * @parity /modules/vescape-core/ios/diagnostics/ConnectionTrace.swift
 * @parity /src/modules/diagnostics/connectionTrace.ts
 */
object ConnectionTraceEvent {
    const val WORKFLOW_STARTED = "connection_workflow_started"
    const val WORKFLOW_FINISHED = "connection_workflow_finished"

    const val PRESENCE_SCAN_STARTED = "presence_scan_started"
    const val PRESENCE_SCAN_READY = "presence_scan_ready"
    const val PRESENCE_SCAN_OBSERVED = "presence_scan_observed"
    const val PRESENCE_SCAN_MATCHED = "presence_scan_matched"
    const val PRESENCE_SCAN_TIMEOUT = "presence_scan_timeout"
    const val PRESENCE_SCAN_CANCELLED = "presence_scan_cancelled"
    const val PRESENCE_SCAN_SKIPPED = "presence_scan_skipped"
    const val PRESENCE_SCAN_FAILED = "presence_scan_failed"

    const val OWNER_GRANTED = "connection_owner_granted"
    const val OWNER_DENIED = "connection_owner_denied"
    const val OWNER_RELEASED = "connection_owner_released"

    const val CONNECT_INTENT_CREATED = "connect_intent_created"
    const val CONNECT_INTENT_CLEARED = "connect_intent_cleared"
    const val AUTO_CONNECT_PROMOTED = "auto_connect_promoted"
    const val AUTO_CONNECT_SKIPPED = "auto_connect_skipped"
    const val AUTO_START_ARMED = "auto_start_armed"
    const val AUTO_START_TRIGGERED = "auto_start_triggered"
    const val AUTO_START_SKIPPED = "auto_start_skipped"
    const val ALTERNATIVE_HINT_OFFERED = "alternative_hint_offered"
    const val ALTERNATIVE_HINT_ACCEPTED = "alternative_hint_accepted"
    const val ALTERNATIVE_HINT_DISMISSED = "alternative_hint_dismissed"

    const val PAUSE_STARTED = "connection_pause_started"
    const val PAUSE_CLEARED = "connection_pause_cleared"
    const val PAUSE_EXPIRED = "connection_pause_expired"
    const val PAUSE_BLOCKED = "connection_pause_blocked"

    const val SERVICE_STARTED = "connection_service_started"
    const val SERVICE_PROMOTED_FOREGROUND = "connection_service_promoted_foreground"
    const val SERVICE_DEMOTED_BACKGROUND = "connection_service_demoted_background"
    const val SERVICE_STOPPED = "connection_service_stopped"

    const val FOREGROUND_WORK_ACQUIRED = "foreground_work_acquired"
    const val FOREGROUND_WORK_RELEASED = "foreground_work_released"
    const val BACKGROUND_TASK_STARTED = "background_task_started"
    const val BACKGROUND_TASK_ENDED = "background_task_ended"
    const val BACKGROUND_TASK_EXPIRED = "background_task_expired"

    const val BOARD_SELECTED = "board_selected"
    const val BOARD_LINK_PERSISTED = "board_link_persisted"
    const val BOARD_LINK_FAILED = "board_link_failed"

    const val RIDE_SUMMARY_PREPARED = "ride_summary_prepared"
    const val RIDE_SUMMARY_NOTIFIED = "ride_summary_notified"
    const val RIDE_SUMMARY_SKIPPED = "ride_summary_skipped"
}

/** Who owns connection work, in the precedence order of ADR 0035. */
object ConnectionTraceOwner {
    const val BOARD_SESSION = "board_session"
    const val CONNECT_INTENT = "connect_intent"
    const val AUTO_START = "auto_start"
    const val AUTO_CONNECT = "auto_connect"
    const val ALTERNATIVE_HINT = "alternative_hint"
    const val ADD_BOARD_SCAN = "add_board_scan"
    const val BOARD_PROBE = "board_probe"
    const val NONE = "none"
}

/** Why the workflow exists. Set once at [ConnectionTrace.start]. */
object ConnectionTraceOrigin {
    const val FOREGROUND_ENTRY = "foreground_entry"
    const val EXPLICIT_CONNECT = "explicit_connect"
    const val AUTO_START_WAKE = "auto_start_wake"
    const val ALTERNATIVE_HINT_SWITCH = "alternative_hint_switch"
    const val BOARD_LINKED = "board_linked"
    const val ADD_BOARD_SCAN = "add_board_scan"
    const val BOARD_PROBE = "board_probe"
    const val RECONNECT = "reconnect"
    const val MANUAL_DISCONNECT = "manual_disconnect"
    const val END_RIDE = "end_ride"
    const val APP_EXIT = "app_exit"
    const val TASK_REMOVED = "task_removed"
    const val RIDE_FINALIZED = "ride_finalized"
}

/** Field names. Later slices reuse these instead of inventing new keys. */
object ConnectionTraceField {
    const val WORKFLOW_ID = "workflow_id"
    const val WORKFLOW_ORIGIN = "workflow_origin"
    const val WORKFLOW_OWNER = "workflow_owner"
    const val WORKFLOW_STARTED_AT = "workflow_started_at"
    const val ELAPSED_MS = "elapsed_ms"

    const val BOARD_ID = "board_id"
    const val BLE_ID = "ble_id"
    const val BOARD_NICKNAME = "board_nickname"

    const val DECISION = "decision"
    const val REASON = "reason"
    const val OWNER_PREVIOUS = "owner_previous"
    const val OWNER_REQUESTED = "owner_requested"

    const val DEADLINE_MS = "deadline_ms"
    const val DEADLINE_AT = "deadline_at"
    const val ATTEMPT = "attempt"

    const val SCAN_PURPOSE = "scan_purpose"
    const val OBSERVATION_COUNT = "observation_count"
    const val RSSI = "rssi"

    const val PAUSE_SOURCE = "pause_source"
    const val PAUSED_UNTIL = "paused_until"

    const val AUTO_CONNECT_ENABLED = "auto_connect_enabled"
    const val AUTO_START_ENABLED = "auto_start_enabled"
    const val BLUETOOTH_ENABLED = "bluetooth_enabled"
    const val PERMISSION_GRANTED = "permission_granted"
    const val APP_FOREGROUND = "app_foreground"
    const val SERVICE_STATE = "service_state"
    const val FOREGROUND_WORK = "foreground_work"

    const val RIDE_ID = "ride_id"
    const val PLATFORM_ERROR_CODE = "platform_error_code"
    const val PLATFORM_ERROR_DOMAIN = "platform_error_domain"
}

/** Value of [ConnectionTraceField.DECISION]. */
object ConnectionTraceDecision {
    const val GRANTED = "granted"
    const val DENIED = "denied"
    const val DEFERRED = "deferred"
    const val SKIPPED = "skipped"
    const val COMPLETED = "completed"
    const val TIMEOUT = "timeout"
    const val CANCELLED = "cancelled"
    const val FAILED = "failed"
}

/** Terminal reason names. Value of [ConnectionTraceField.REASON]. */
object ConnectionTraceReason {
    const val MATCHED = "matched"
    const val NO_LINKED_BOARDS = "no_linked_boards"
    const val NO_BOARD_LINK = "no_board_link"
    const val NO_SELECTED_BOARD = "no_selected_board"
    const val BOARD_NOT_PRESENT = "board_not_present"
    const val BLUETOOTH_DISABLED = "bluetooth_disabled"
    const val PERMISSION_MISSING = "permission_missing"
    const val SCANNER_UNAVAILABLE = "scanner_unavailable"
    const val SCANNER_BUSY = "scanner_busy"
    const val AUTO_CONNECT_DISABLED = "auto_connect_disabled"
    const val AUTO_START_DISABLED = "auto_start_disabled"
    const val CONNECTION_PAUSED = "connection_paused"
    const val HIGHER_PRIORITY_OWNER = "higher_priority_owner"
    const val SESSION_ALREADY_ACTIVE = "session_already_active"
    const val CONNECT_INTENT_ACTIVE = "connect_intent_active"
    const val USER_CANCELLED = "user_cancelled"
    const val STOP_SEARCH = "stop_search"
    const val DEADLINE_EXPIRED = "deadline_expired"
    const val MANUAL_DISCONNECT = "manual_disconnect"
    const val END_RIDE = "end_ride"
    const val APP_EXIT = "app_exit"
    const val TASK_REMOVED = "task_removed"
    const val AUTO_CLOSE = "auto_close"
    const val MECHANICAL_TEARDOWN = "mechanical_teardown"
    const val PROBE_CANCELLED = "probe_cancelled"
    const val PLATFORM_ERROR = "platform_error"
    const val RIDE_SUMMARY_DISABLED = "ride_summary_disabled"
    const val RIDE_NOT_ELIGIBLE = "ride_not_eligible"
    const val ALREADY_NOTIFIED = "already_notified"
}

/**
 * One correlated connection workflow. Pass the handle across layers — lifecycle → scanner →
 * connection → service → recording — so the correlation id survives handoff.
 */
class ConnectionWorkflow internal constructor(
    private val reporter: DiagnosticReporter,
    val workflowId: String,
    val origin: String,
    private val startedAtMs: Long,
    owner: String,
) {
    @Volatile
    var owner: String = owner
        private set

    /** Record a new owner for subsequent child events. Returns the same handle for chaining. */
    fun handoff(owner: String): ConnectionWorkflow {
        this.owner = owner
        return this
    }

    fun event(eventName: String, fields: Map<String, Any?> = emptyMap()) {
        reporter.capture(eventName, baseFields() + ConnectionTrace.sanitize(fields))
    }

    fun finish(decision: String, reason: String, fields: Map<String, Any?> = emptyMap()) {
        event(
            ConnectionTraceEvent.WORKFLOW_FINISHED,
            mapOf(
                ConnectionTraceField.DECISION to decision,
                ConnectionTraceField.REASON to reason,
            ) + fields,
        )
    }

    private fun baseFields(): Map<String, Any?> = mapOf(
        ConnectionTraceField.WORKFLOW_ID to workflowId,
        ConnectionTraceField.WORKFLOW_ORIGIN to origin,
        ConnectionTraceField.WORKFLOW_OWNER to owner,
        ConnectionTraceField.WORKFLOW_STARTED_AT to startedAtMs,
        ConnectionTraceField.ELAPSED_MS to ConnectionTrace.now() - startedAtMs,
    )
}

object ConnectionTrace {
    private val SENSITIVE_MARKERS = listOf(
        "auth",
        "credential",
        "jwt",
        "password",
        "payload",
        "pin",
        "secret",
        "session_token",
        "telemetry",
        "token",
    )

    /** Start a correlated workflow and emit `connection_workflow_started`. */
    fun start(
        context: Context,
        origin: String,
        owner: String = ConnectionTraceOwner.NONE,
        fields: Map<String, Any?> = emptyMap(),
    ): ConnectionWorkflow {
        val workflow = ConnectionWorkflow(
            reporter = DiagnosticReporter.get(context),
            workflowId = newOperationId(),
            origin = origin,
            startedAtMs = now(),
            owner = owner,
        )
        workflow.event(ConnectionTraceEvent.WORKFLOW_STARTED, fields)
        return workflow
    }

    /**
     * Rebuild a handle for a workflow that already started, so a layer that only received the
     * correlation id (service restart, notification action, JS intent) keeps emitting under it.
     */
    fun resume(
        context: Context,
        workflowId: String,
        origin: String,
        startedAtMs: Long,
        owner: String = ConnectionTraceOwner.NONE,
    ): ConnectionWorkflow = ConnectionWorkflow(
        reporter = DiagnosticReporter.get(context),
        workflowId = workflowId,
        origin = origin,
        startedAtMs = startedAtMs,
        owner = owner,
    )

    /** Contract-level exclusion of auth data, PINs, tokens, and telemetry payloads. */
    fun isSensitiveField(key: String): Boolean =
        SENSITIVE_MARKERS.any { key.contains(it, ignoreCase = true) }

    internal fun sanitize(fields: Map<String, Any?>): Map<String, Any?> =
        fields.filterKeys { !isSensitiveField(it) }

    internal fun now(): Long = System.currentTimeMillis()
}
