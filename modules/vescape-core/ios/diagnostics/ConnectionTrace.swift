import Foundation

/// Connection trace contract (ADR 0035). One correlated workflow spans lifecycle, scanner,
/// connection, service, and recording code, so every layer emits child events under the same
/// `workflow_id` instead of minting its own correlation.
///
/// Local Diagnostic Events (ADR 0007) intentionally carry full Board ids and BLE ids; they stay on
/// device and in platform logs. Authentication data, PINs, tokens, and telemetry payloads are
/// excluded by contract — see `ConnectionTrace.isSensitiveField`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/ConnectionTrace.kt
/// @parity /src/modules/diagnostics/connectionTrace.ts
internal enum ConnectionTraceEvent {
  static let workflowStarted = "connection_workflow_started"
  static let workflowFinished = "connection_workflow_finished"

  static let presenceScanStarted = "presence_scan_started"
  static let presenceScanReady = "presence_scan_ready"
  static let presenceScanObserved = "presence_scan_observed"
  static let presenceScanMatched = "presence_scan_matched"
  static let presenceScanTimeout = "presence_scan_timeout"
  static let presenceScanCancelled = "presence_scan_cancelled"
  static let presenceScanSkipped = "presence_scan_skipped"
  static let presenceScanFailed = "presence_scan_failed"

  static let ownerGranted = "connection_owner_granted"
  static let ownerDenied = "connection_owner_denied"
  static let ownerReleased = "connection_owner_released"

  static let connectIntentCreated = "connect_intent_created"
  static let connectIntentCleared = "connect_intent_cleared"
  static let autoConnectPromoted = "auto_connect_promoted"
  static let autoConnectSkipped = "auto_connect_skipped"
  static let autoStartArmed = "auto_start_armed"
  static let autoStartTriggered = "auto_start_triggered"
  static let autoStartSkipped = "auto_start_skipped"
  static let alternativeHintOffered = "alternative_hint_offered"
  static let alternativeHintAccepted = "alternative_hint_accepted"
  static let alternativeHintDismissed = "alternative_hint_dismissed"

  static let pauseStarted = "connection_pause_started"
  static let pauseCleared = "connection_pause_cleared"
  static let pauseExpired = "connection_pause_expired"
  static let pauseBlocked = "connection_pause_blocked"

  static let serviceStarted = "connection_service_started"
  static let servicePromotedForeground = "connection_service_promoted_foreground"
  static let serviceDemotedBackground = "connection_service_demoted_background"
  static let serviceStopped = "connection_service_stopped"

  static let boardSelected = "board_selected"
  static let boardLinkPersisted = "board_link_persisted"
  static let boardLinkFailed = "board_link_failed"

  static let rideSummaryPrepared = "ride_summary_prepared"
  static let rideSummaryNotified = "ride_summary_notified"
  static let rideSummarySkipped = "ride_summary_skipped"
}

/// Who owns connection work, in the precedence order of ADR 0035.
internal enum ConnectionTraceOwner {
  static let boardSession = "board_session"
  static let connectIntent = "connect_intent"
  static let autoStart = "auto_start"
  static let autoConnect = "auto_connect"
  static let alternativeHint = "alternative_hint"
  static let addBoardScan = "add_board_scan"
  static let boardProbe = "board_probe"
  static let none = "none"
}

/// Why the workflow exists. Set once at `ConnectionTrace.start`.
internal enum ConnectionTraceOrigin {
  static let foregroundEntry = "foreground_entry"
  static let explicitConnect = "explicit_connect"
  static let autoStartWake = "auto_start_wake"
  static let alternativeHintSwitch = "alternative_hint_switch"
  static let addBoardScan = "add_board_scan"
  static let boardProbe = "board_probe"
  static let reconnect = "reconnect"
  static let manualDisconnect = "manual_disconnect"
  static let endRide = "end_ride"
  static let appExit = "app_exit"
  static let taskRemoved = "task_removed"
  static let rideFinalized = "ride_finalized"
}

/// Field names. Later slices reuse these instead of inventing new keys.
internal enum ConnectionTraceField {
  static let workflowId = "workflow_id"
  static let workflowOrigin = "workflow_origin"
  static let workflowOwner = "workflow_owner"
  static let workflowStartedAt = "workflow_started_at"
  static let elapsedMs = "elapsed_ms"

  static let boardId = "board_id"
  static let bleId = "ble_id"
  static let boardNickname = "board_nickname"

  static let decision = "decision"
  static let reason = "reason"
  static let ownerPrevious = "owner_previous"
  static let ownerRequested = "owner_requested"

  static let deadlineMs = "deadline_ms"
  static let deadlineAt = "deadline_at"
  static let attempt = "attempt"

  static let scanPurpose = "scan_purpose"
  static let observationCount = "observation_count"
  static let rssi = "rssi"

  static let pauseSource = "pause_source"
  static let pausedUntil = "paused_until"

  static let autoConnectEnabled = "auto_connect_enabled"
  static let autoStartEnabled = "auto_start_enabled"
  static let bluetoothEnabled = "bluetooth_enabled"
  static let permissionGranted = "permission_granted"
  static let appForeground = "app_foreground"
  static let serviceState = "service_state"

  static let rideId = "ride_id"
  static let platformErrorCode = "platform_error_code"
  static let platformErrorDomain = "platform_error_domain"
}

/// Value of `ConnectionTraceField.decision`.
internal enum ConnectionTraceDecision {
  static let granted = "granted"
  static let denied = "denied"
  static let deferred = "deferred"
  static let skipped = "skipped"
  static let completed = "completed"
  static let timeout = "timeout"
  static let cancelled = "cancelled"
  static let failed = "failed"
}

/// Terminal reason names. Value of `ConnectionTraceField.reason`.
internal enum ConnectionTraceReason {
  static let matched = "matched"
  static let noLinkedBoards = "no_linked_boards"
  static let noBoardLink = "no_board_link"
  static let noSelectedBoard = "no_selected_board"
  static let boardNotPresent = "board_not_present"
  static let bluetoothDisabled = "bluetooth_disabled"
  static let permissionMissing = "permission_missing"
  static let scannerUnavailable = "scanner_unavailable"
  static let scannerBusy = "scanner_busy"
  static let autoConnectDisabled = "auto_connect_disabled"
  static let autoStartDisabled = "auto_start_disabled"
  static let connectionPaused = "connection_paused"
  static let higherPriorityOwner = "higher_priority_owner"
  static let sessionAlreadyActive = "session_already_active"
  static let connectIntentActive = "connect_intent_active"
  static let userCancelled = "user_cancelled"
  static let stopSearch = "stop_search"
  static let deadlineExpired = "deadline_expired"
  static let manualDisconnect = "manual_disconnect"
  static let endRide = "end_ride"
  static let appExit = "app_exit"
  static let taskRemoved = "task_removed"
  static let autoClose = "auto_close"
  static let mechanicalTeardown = "mechanical_teardown"
  static let probeCancelled = "probe_cancelled"
  static let platformError = "platform_error"
}

/// One correlated connection workflow. Pass the handle across layers — lifecycle → scanner →
/// connection → service → recording — so the correlation id survives handoff.
internal final class ConnectionWorkflow {
  let workflowId: String
  let origin: String

  private let reporter: DiagnosticReporter
  private let startedAtMs: Int64
  private let lock = NSLock()
  private var currentOwner: String

  init(reporter: DiagnosticReporter, workflowId: String, origin: String, startedAtMs: Int64, owner: String) {
    self.reporter = reporter
    self.workflowId = workflowId
    self.origin = origin
    self.startedAtMs = startedAtMs
    self.currentOwner = owner
  }

  var owner: String {
    lock.lock()
    defer { lock.unlock() }
    return currentOwner
  }

  /// Record a new owner for subsequent child events. Returns the same handle for chaining.
  @discardableResult
  func handoff(owner: String) -> ConnectionWorkflow {
    lock.lock()
    currentOwner = owner
    lock.unlock()
    return self
  }

  func event(_ eventName: String, fields: [String: Any?] = [:]) {
    reporter.capture(eventName: eventName, properties: baseFields().merging(ConnectionTrace.sanitize(fields)) { _, new in new })
  }

  func finish(decision: String, reason: String, fields: [String: Any?] = [:]) {
    var merged: [String: Any?] = [
      ConnectionTraceField.decision: decision,
      ConnectionTraceField.reason: reason,
    ]
    for (key, value) in fields { merged[key] = value }
    event(ConnectionTraceEvent.workflowFinished, fields: merged)
  }

  private func baseFields() -> [String: Any?] {
    [
      ConnectionTraceField.workflowId: workflowId,
      ConnectionTraceField.workflowOrigin: origin,
      ConnectionTraceField.workflowOwner: owner,
      ConnectionTraceField.workflowStartedAt: startedAtMs,
      ConnectionTraceField.elapsedMs: ConnectionTrace.now() - startedAtMs,
    ]
  }
}

internal enum ConnectionTrace {
  private static let sensitiveMarkers = [
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
  ]

  /// Start a correlated workflow and emit `connection_workflow_started`.
  static func start(
    origin: String,
    owner: String = ConnectionTraceOwner.none,
    fields: [String: Any?] = [:],
    reporter: DiagnosticReporter = .shared
  ) -> ConnectionWorkflow {
    let workflow = ConnectionWorkflow(
      reporter: reporter,
      workflowId: UUID().uuidString,
      origin: origin,
      startedAtMs: now(),
      owner: owner
    )
    workflow.event(ConnectionTraceEvent.workflowStarted, fields: fields)
    return workflow
  }

  /// Rebuild a handle for a workflow that already started, so a layer that only received the
  /// correlation id (background task, notification action, JS intent) keeps emitting under it.
  static func resume(
    workflowId: String,
    origin: String,
    startedAtMs: Int64,
    owner: String = ConnectionTraceOwner.none,
    reporter: DiagnosticReporter = .shared
  ) -> ConnectionWorkflow {
    ConnectionWorkflow(
      reporter: reporter,
      workflowId: workflowId,
      origin: origin,
      startedAtMs: startedAtMs,
      owner: owner
    )
  }

  /// Contract-level exclusion of auth data, PINs, tokens, and telemetry payloads.
  static func isSensitiveField(_ key: String) -> Bool {
    let lowered = key.lowercased()
    return sensitiveMarkers.contains { lowered.contains($0) }
  }

  static func sanitize(_ fields: [String: Any?]) -> [String: Any?] {
    fields.filter { !isSensitiveField($0.key) }
  }

  static func now() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000.0)
  }
}
