/**
 * Connection trace contract (ADR 0035) mirrored for JS. Native owns emission; JS only renders and
 * exports these events, so this file must stay value-identical to both native peers.
 *
 * Full Board ids and BLE ids are intentionally present in local events and their export. Auth
 * data, PINs, tokens, and telemetry payloads are excluded by contract.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/ConnectionTrace.kt
 * @parity /modules/vescape-core/ios/diagnostics/ConnectionTrace.swift
 */
export const CONNECTION_TRACE_EVENT = {
  workflowStarted: 'connection_workflow_started',
  workflowFinished: 'connection_workflow_finished',

  presenceScanStarted: 'presence_scan_started',
  presenceScanReady: 'presence_scan_ready',
  presenceScanObserved: 'presence_scan_observed',
  presenceScanMatched: 'presence_scan_matched',
  presenceScanTimeout: 'presence_scan_timeout',
  presenceScanCancelled: 'presence_scan_cancelled',
  presenceScanSkipped: 'presence_scan_skipped',
  presenceScanFailed: 'presence_scan_failed',

  ownerGranted: 'connection_owner_granted',
  ownerDenied: 'connection_owner_denied',
  ownerReleased: 'connection_owner_released',

  connectIntentCreated: 'connect_intent_created',
  connectIntentCleared: 'connect_intent_cleared',
  autoConnectPromoted: 'auto_connect_promoted',
  autoConnectSkipped: 'auto_connect_skipped',
  autoStartArmed: 'auto_start_armed',
  autoStartTriggered: 'auto_start_triggered',
  autoStartSkipped: 'auto_start_skipped',
  alternativeHintOffered: 'alternative_hint_offered',
  alternativeHintAccepted: 'alternative_hint_accepted',
  alternativeHintDismissed: 'alternative_hint_dismissed',

  pauseStarted: 'connection_pause_started',
  pauseCleared: 'connection_pause_cleared',
  pauseExpired: 'connection_pause_expired',
  pauseBlocked: 'connection_pause_blocked',

  serviceStarted: 'connection_service_started',
  servicePromotedForeground: 'connection_service_promoted_foreground',
  serviceDemotedBackground: 'connection_service_demoted_background',
  serviceStopped: 'connection_service_stopped',

  foregroundWorkAcquired: 'foreground_work_acquired',
  foregroundWorkReleased: 'foreground_work_released',
  backgroundTaskStarted: 'background_task_started',
  backgroundTaskEnded: 'background_task_ended',
  backgroundTaskExpired: 'background_task_expired',

  boardSelected: 'board_selected',
  boardLinkPersisted: 'board_link_persisted',
  boardLinkFailed: 'board_link_failed',

  rideSummaryPrepared: 'ride_summary_prepared',
  rideSummaryNotified: 'ride_summary_notified',
  rideSummarySkipped: 'ride_summary_skipped',
} as const

export const CONNECTION_TRACE_OWNER = {
  boardSession: 'board_session',
  connectIntent: 'connect_intent',
  autoStart: 'auto_start',
  autoConnect: 'auto_connect',
  alternativeHint: 'alternative_hint',
  addBoardScan: 'add_board_scan',
  boardProbe: 'board_probe',
  none: 'none',
} as const

export const CONNECTION_TRACE_ORIGIN = {
  foregroundEntry: 'foreground_entry',
  explicitConnect: 'explicit_connect',
  autoStartWake: 'auto_start_wake',
  alternativeHintSwitch: 'alternative_hint_switch',
  addBoardScan: 'add_board_scan',
  boardProbe: 'board_probe',
  reconnect: 'reconnect',
  manualDisconnect: 'manual_disconnect',
  endRide: 'end_ride',
  appExit: 'app_exit',
  taskRemoved: 'task_removed',
  rideFinalized: 'ride_finalized',
} as const

export const CONNECTION_TRACE_FIELD = {
  workflowId: 'workflow_id',
  workflowOrigin: 'workflow_origin',
  workflowOwner: 'workflow_owner',
  workflowStartedAt: 'workflow_started_at',
  elapsedMs: 'elapsed_ms',

  boardId: 'board_id',
  bleId: 'ble_id',
  boardNickname: 'board_nickname',

  decision: 'decision',
  reason: 'reason',
  ownerPrevious: 'owner_previous',
  ownerRequested: 'owner_requested',

  deadlineMs: 'deadline_ms',
  deadlineAt: 'deadline_at',
  attempt: 'attempt',

  scanPurpose: 'scan_purpose',
  observationCount: 'observation_count',
  rssi: 'rssi',

  pauseSource: 'pause_source',
  pausedUntil: 'paused_until',

  autoConnectEnabled: 'auto_connect_enabled',
  autoStartEnabled: 'auto_start_enabled',
  bluetoothEnabled: 'bluetooth_enabled',
  permissionGranted: 'permission_granted',
  appForeground: 'app_foreground',
  serviceState: 'service_state',
  foregroundWork: 'foreground_work',

  rideId: 'ride_id',
  platformErrorCode: 'platform_error_code',
  platformErrorDomain: 'platform_error_domain',
} as const

export const CONNECTION_TRACE_DECISION = {
  granted: 'granted',
  denied: 'denied',
  deferred: 'deferred',
  skipped: 'skipped',
  completed: 'completed',
  timeout: 'timeout',
  cancelled: 'cancelled',
  failed: 'failed',
} as const

export const CONNECTION_TRACE_REASON = {
  matched: 'matched',
  noLinkedBoards: 'no_linked_boards',
  noBoardLink: 'no_board_link',
  noSelectedBoard: 'no_selected_board',
  boardNotPresent: 'board_not_present',
  bluetoothDisabled: 'bluetooth_disabled',
  permissionMissing: 'permission_missing',
  scannerUnavailable: 'scanner_unavailable',
  scannerBusy: 'scanner_busy',
  autoConnectDisabled: 'auto_connect_disabled',
  autoStartDisabled: 'auto_start_disabled',
  connectionPaused: 'connection_paused',
  higherPriorityOwner: 'higher_priority_owner',
  sessionAlreadyActive: 'session_already_active',
  connectIntentActive: 'connect_intent_active',
  userCancelled: 'user_cancelled',
  stopSearch: 'stop_search',
  deadlineExpired: 'deadline_expired',
  manualDisconnect: 'manual_disconnect',
  endRide: 'end_ride',
  appExit: 'app_exit',
  taskRemoved: 'task_removed',
  autoClose: 'auto_close',
  mechanicalTeardown: 'mechanical_teardown',
  probeCancelled: 'probe_cancelled',
  platformError: 'platform_error',
} as const

/** Event names whose meaning in the Event Log is a failed or aborted outcome. */
export const CONNECTION_TRACE_BAD_EVENTS: readonly string[] = [
  CONNECTION_TRACE_EVENT.presenceScanFailed,
  CONNECTION_TRACE_EVENT.presenceScanTimeout,
  CONNECTION_TRACE_EVENT.ownerDenied,
  CONNECTION_TRACE_EVENT.boardLinkFailed,
]

/** Event names whose meaning is a successful outcome. */
export const CONNECTION_TRACE_GOOD_EVENTS: readonly string[] = [
  CONNECTION_TRACE_EVENT.presenceScanMatched,
  CONNECTION_TRACE_EVENT.ownerGranted,
  CONNECTION_TRACE_EVENT.autoConnectPromoted,
  CONNECTION_TRACE_EVENT.autoStartTriggered,
  CONNECTION_TRACE_EVENT.connectIntentCreated,
  CONNECTION_TRACE_EVENT.boardLinkPersisted,
  CONNECTION_TRACE_EVENT.boardSelected,
  CONNECTION_TRACE_EVENT.rideSummaryNotified,
]

/** Event names that are neither good nor bad, only trace progress. */
export const CONNECTION_TRACE_INFO_EVENTS: readonly string[] = [
  CONNECTION_TRACE_EVENT.workflowStarted,
  CONNECTION_TRACE_EVENT.workflowFinished,
  CONNECTION_TRACE_EVENT.presenceScanStarted,
  CONNECTION_TRACE_EVENT.presenceScanReady,
  CONNECTION_TRACE_EVENT.presenceScanObserved,
  CONNECTION_TRACE_EVENT.ownerReleased,
  CONNECTION_TRACE_EVENT.connectIntentCleared,
  CONNECTION_TRACE_EVENT.serviceStarted,
  CONNECTION_TRACE_EVENT.servicePromotedForeground,
  CONNECTION_TRACE_EVENT.serviceDemotedBackground,
  CONNECTION_TRACE_EVENT.serviceStopped,
  CONNECTION_TRACE_EVENT.foregroundWorkAcquired,
  CONNECTION_TRACE_EVENT.foregroundWorkReleased,
  CONNECTION_TRACE_EVENT.backgroundTaskStarted,
  CONNECTION_TRACE_EVENT.backgroundTaskEnded,
  CONNECTION_TRACE_EVENT.alternativeHintOffered,
  CONNECTION_TRACE_EVENT.alternativeHintAccepted,
  CONNECTION_TRACE_EVENT.rideSummaryPrepared,
]

/** Event names for skipped, paused, or cancelled work — expected, but worth noticing. */
export const CONNECTION_TRACE_WARNING_EVENTS: readonly string[] = [
  CONNECTION_TRACE_EVENT.presenceScanSkipped,
  CONNECTION_TRACE_EVENT.presenceScanCancelled,
  CONNECTION_TRACE_EVENT.autoConnectSkipped,
  CONNECTION_TRACE_EVENT.autoStartSkipped,
  CONNECTION_TRACE_EVENT.autoStartArmed,
  CONNECTION_TRACE_EVENT.alternativeHintDismissed,
  CONNECTION_TRACE_EVENT.pauseStarted,
  CONNECTION_TRACE_EVENT.pauseCleared,
  CONNECTION_TRACE_EVENT.pauseExpired,
  CONNECTION_TRACE_EVENT.pauseBlocked,
  CONNECTION_TRACE_EVENT.rideSummarySkipped,
  CONNECTION_TRACE_EVENT.backgroundTaskExpired,
]
