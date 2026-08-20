# Connection state

→ [index](./index.md)

## Rule

Native owns live truth. JS sends intents and renders native snapshots.

JS must not optimistically set board connection status. If UI shows `connecting`,
`connected`, `stale`, or `error`, that value came from native `LiveState`.

## Shape

Native emits `onLiveState` and exposes `getLiveState()`:

```ts
type LiveState = {
  board: {
    phase:
      | 'idle'
      | 'connecting'
      | 'discovering'
      | 'subscribing'
      | 'waiting_for_telemetry'
      | 'connected'
      | 'stale'
      | 'reconnecting'
      | 'disconnecting'
      | 'error'
    selectedBoardId: string | null
    connectedBoardId: string | null
    bleId: string | null
    name: string | null
    connectionSeq: number
    lastTelemetryAt: number | null
    recentTelemetry: TelemetryEvent[]
    error: string | null
    autoConnect: boolean
  }

  gps: {
    phase: 'idle' | 'starting' | 'active' | 'error'
    latestFix: LocationEvent | null
    recentLocations: LocationEvent[]
    error: string | null
  }

  scan: {
    phase: 'idle' | 'scanning' | 'error'
    devices: DeviceFoundEvent[]
    error: string | null
  }

  /** Board Presence Scan (ADR 0035). Native-owned; JS renders it and never starts or times it. */
  presence: {
    phase: 'idle' | 'waiting_for_bluetooth' | 'scanning' | 'done'
    purpose: 'presence' | 'add_board' | 'board_probe' | 'connect_intent' | 'reconnect' | null
    owner:
      | 'board_session'
      | 'connect_intent'
      | 'auto_start'
      | 'auto_connect'
      | 'alternative_hint'
      | 'add_board_scan'
      | 'board_probe'
      | 'none'
    startedAt: number | null
    /** Absolute deadline, set once the radio is usable. `null` while waiting for Bluetooth. */
    deadlineAt: number | null
    observations: {
      boardId: string
      bleId: string
      name: string | null
      rssi: number | null
      observedAt: number
      selected: boolean
    }[]
    /** Shared connection-trace decision + terminal reason. */
    decision: string | null
    reason: string | null
  }

  /**
   * Automatic Connection Pause for the selected Board, or `null` when it is not paused.
   * Native owns the deadline; JS renders the remainder and offers **Connect now**.
   */
  pause: {
    boardId: string
    /** Absolute deadline, epoch ms. */
    until: number
    /** Rider action that armed it: `manual_disconnect`, `end_ride`, `app_exit`, `task_removed`. */
    source: string
  } | null

  recording: {
    enabled: boolean
    activeBoardId: string | null
    startedAt: number | null
  }
}
```

## Runtime split

Android native has separate live runtimes:

- board runtime: BLE GATT, VESC polling, telemetry, reconnect, board recording
- GPS runtime: location listener, latest fix, recent fixes, map data
- scan runtime: BLE scanner owned by the Expo module bridge

Board connect/disconnect must not clear GPS fixes. GPS is app-level map data.

## JS role

`src/modules/board/store/bleStore.ts` mirrors native state:

- `syncNativeState()` reads `getLiveState()`
- `onLiveState` replaces lifecycle status
- `onTelemetry` appends telemetry only when `connectionSeq` matches
- `onLocation` appends GPS fixes
- foreground restore hydrates recent telemetry from native `getLiveState()`

Commands call native only:

- `connect(boardId)` → `selectBoard(boardId)`
- `disconnect()` → `stopBoard()`
- `startGpsTracking()` → `startLocationUpdates()`
- `startTelemetryRecording()` → `setTelemetryRecordingEnabled(true)`

## Auto-connect

Auto Connect begins with a native five-second Board Presence Scan on every foreground
entry. JS never triggers or owns this scan. JS renders the native deadline, observations,
pause state, and decisions.

The scan watches saved BLE ids for all linked Boards:

- The selected Board may promote into a Board Session when the global `autoConnect`
  setting is on and no Automatic Connection Pause applies.
- A non-selected Board never connects automatically. Native reports it, from its
  advertisement alone, as a short-lived switch-and-connect hint.
- No Boards, no Board Link, disabled Bluetooth, and missing permission produce named skip
  reasons rather than silent returns.
- Bluetooth initialization does not consume the five-second window. The clock starts once
  the scanner becomes ready.

The scan survives an immediate screen lock:

- Android starts the existing core foreground service in foreground mode immediately, with
  a determinate five-second progress notification and a **Stop search** action. There is no
  regular-service-to-foreground promotion path, and a match hands that same service to Board
  Session work without a second start.
- iOS covers the foreground-to-lock handoff with a short native background task. No Live
  Activity exists before a Board Session does.
- **Stop search** and the timeout cancel only the current scan. Neither creates an Automatic
  Connection Pause, and neither disables Auto Start.
- Foreground-service work is owned explicitly (`presence_scan`, `board_session`, `gps`,
  `group_ride`). The service and its notification end only when no owner remains, so
  releasing the scan never tears down GPS, a Group Ride, or a Board Session.

Android starts the existing core service **in the foreground immediately**, with a temporary
progress notification carrying a **Stop search** action. There is no regular-service-to-foreground
promotion path. A match promotes the service into Board Session work. Timeout or Stop search removes
the service and notification. iOS uses its native coordinator and the session central for the same
handoff; it starts no Live Activity before a Board Session exists.

Native lifecycle drives the scan on both platforms — `VescapeLifecycleProvider` (Android
`ActivityLifecycleCallbacks`, 0→1 started activities) and `VescapeLaunchSubscriber`
(`applicationDidBecomeActive`). JS `AppState` and Expo module creation are deliberately not
involved.

### Policy and ownership

The rules are pure and unit-tested on both platforms:

| Concern                             | Type                                             |
| ----------------------------------- | ------------------------------------------------ |
| Scan eligibility, promotion, window | `PresenceScanPolicy`                             |
| Who owns connection work            | `ConnectionOwner` / `ConnectionOwnership`        |
| Who owns the radio, stale callbacks | `ScanPurpose` / `ScannerCoordinator`             |
| Explicit Connect lifetime           | `ConnectIntent` / `ConnectIntentPolicy`          |
| Automatic Connection Pause          | `ConnectionPausePolicy` / `ConnectionPauseStore` |
| Scan run loop                       | `BoardPresenceScan` over a `PresenceScanPort`    |
| Alternative-Board hints             | `AlternativeHints`                               |

Every scan takes an operation token from `ScannerCoordinator`; a BLE callback that cannot prove it
owns the current token is dropped, because scan callbacks outlive their operation.

An explicit Connect creates a Connect Intent immediately. It starts the Android foreground
service or iOS Live Activity and keeps searching through backgrounding and signal loss until
Disconnect, End ride, Exit, task removal, platform force-quit, or configured Auto Close.

Native resolves competing work in this order:

1. Active or reconnecting Board Session
2. Explicit Connect Intent
3. Android Auto Start
4. Auto Connect promotion
5. Alternative-Board hint

Android Auto Start remains per Board. It may wake the app, switch selection, and connect its
armed Board when no Board Session or Connect Intent owns the connection. Add Board scans and
Board Probes own the scanner while active, so the foreground Presence Scan yields to them.

Manual Disconnect, End ride, Exit, and Android task removal create a board-scoped,
time-bounded Automatic Connection Pause shared by Auto Connect and Auto Start. Explicit
Connect clears it. Mechanical teardown, probe cancellation, Stop search, and scan timeout do
not create a pause. Presence still reports a paused Board as nearby.

The pause is one persisted map, `Board id -> { absolute deadline, source reason }`
(`ConnectionPauseStore`, SharedPreferences file / `UserDefaults` key
`vesc_automatic_connection_pause`). Expiry is a clock comparison on read, so no cleanup job
exists. Every entry point takes a Board id explicitly, never "the selected Board": Auto Start
evaluates the _detected_ Board and Switch & Connect clears the _target_ Board.

- Arms: Disconnect, End ride, Exit, Android task removal. `ConnectionPausePolicy` refuses any
  other source, so a mechanical path cannot start suppressing Auto Connect by accident.
- Clears: explicit Connect, **Connect now**, Switch & Connect.
- Does nothing: opening Vescape, foregrounding, plain Board selection.

### Alternative-Board hints

A Presence Scan observation of a linked **non-selected** Board becomes an advisory switch hint. It is
built from advertisements only — a non-selected observation never opens GATT and never changes
selection.

- Observations are deduplicated by saved **Board id**. A repeated advertisement refreshes the
  existing observation's timestamp and RSSI in place, so discovery order survives and no Board is
  ever queued twice.
- An observation expires `ALTERNATIVE_HINT_TTL_MS` (thirty seconds) after its **last**
  advertisement. Like the pause, expiry is a clock comparison on read: native prunes every snapshot,
  JS re-checks on a one-second tick.
- JS shows **one** hint at a time, in discovery order, in the FloatingBar.
- **Later** is a local acknowledgement. It reveals the next queued Board, arms no Automatic
  Connection Pause, and changes no selection or ownership. Native records it only as
  `alternative_hint_dismissed`.
- **Switch** goes through the same explicit-Connect path as the Connect pill
  (`BoardSessionController.beginExplicitConnect`): it clears the **target** Board's pause, creates a
  durable Connect Intent, and records the selection. It differs only in trace origin
  (`alternative_hint_switch`, which also emits `alternative_hint_accepted`).
- Selected-Board discovery keeps running while hints are visible; `alternative_hint` is the lowest
  connection owner, so a connected Board Session clears the whole queue.

### Explicit Connect

`beginExplicitConnect(boardId, origin)` on both `BoardSessionController`s is the single
application-level explicit-Connect path: pause clear, Connect Intent creation, and the recorded
`board_selected`. Starting the session stays with the caller, which owns the platform's session
plumbing. Every rider Connect routes through it — the Connect pill (`selectBoard`), **Connect now**,
and Switch & Connect (`switchToAlternativeBoard`) — and `origin` only names who asked.

The Connect Intent it creates ends when the session reaches `connected`, when a rider stop arms an
Automatic Connection Pause, or when its Auto Close deadline passes (a clock comparison on read, so
an expired intent stops blocking the Presence Scan without a timer).

Duration comes from `automaticConnectionPauseMinutes` (0 = never pause). It migrated from the
pre-#406 Android-only `companionPresenceCooldownMinutes`: a stored value is read through the old
key when the new one is absent, and a write under the old key lands on the new one. Stored values
up to 1440 stay valid; the rider stepper offers up to 480 for new choices, so a legacy value is
never silently clamped.

### Fast Connect Stability

The fastest stable path is not to wait longer; it is to avoid competing native
writes during startup.

- `connected` means first valid telemetry arrived, not just GATT ready.
- The runtime connect path is dumb: it seeds direct/CAN mode from the stored Board
  Transport and starts telemetry polling directly, with no startup discovery probes.
  CAN id resolution happens once at setup via Board Probe, not on connect.
- GATT descriptor timeout fallbacks must be canceled after successful CCCD writes,
  otherwise a stale timeout can double-resolve the connection.
- Tune/config reads should not compete with initial telemetry startup. If a config
  read starts while the board is still settling, prefer gating/queuing over adding
  long connection delays.

## Recording

Recording means real ride recording:

- allowed only when board phase is `connected`
- saves board telemetry plus precise GPS samples
- stays active during short native reconnect windows
- stops on explicit board disconnect, fatal board error, or service stop

Standalone GPS does not create ride history. GPS without board is only for map/status.

Debug raw BLE recording is separate. Android Dev → Debug recordings can capture
raw chunks, connection states, and location for diagnosis, then list and export
the JSONL files. Debug replay playback is intentionally removed from the app.

## Ride summaries

A finalized Ride Recording sends **one** silent summary notification with distance, duration, and
the final valid Battery SoC Estimate when there is one. Tapping it opens that exact Ride History
detail through `vescape://history/ride/<recordingId>`.

Eligibility is not a second rule: the summary reuses the ride grouping and the same
`avgSpeedSampleCount > 0` filter that decides whether a finalized recording appears in Ride
History at all. An ineligible tail means no summary, never a summary for an older ride.

The rider setting `rideSummaryNotificationsEnabled` defaults **on** and disables summaries alone —
it changes nothing else about recording or connection. Ride completion never prompts for the OS
notification permission; a denied or undetermined status is a silent, traced skip. Android posts on
its own low-importance, soundless channel `vesc_ride_summary`; iOS posts a local notification with
no sound and `.passive` interruption level. A missing or stale battery estimate omits the battery
text entirely rather than rendering an empty or zero value; "stale" means the persisted estimate is
more than 5 minutes away from the ride's end, or predates its start.

### Durable deduplication

Deduplication is durable, never process memory:

- **Table** `ride_summary_notifications` in the ride database (`vescape.db`) — Room migration
  `MIGRATION_32_33`, GRDB migration `v33_ride_summary_notifications`.
- **Columns** `ride_id TEXT NOT NULL PRIMARY KEY`, `notified_at_ms INTEGER NOT NULL`.
- **Key** the stable Ride History recording id, `deviceId:firstSampleAtMs:lastSampleAtMs` — the same
  string `HistorySession.id` uses, with `unknown` standing in for a blank device id.

The row is _claimed_ with `INSERT OR IGNORE` inside the database's own transaction **before** the
notification is posted, and released again only when posting itself failed. A crash, a CoreBluetooth
restoration, or a repeated finalize callback between claim and post therefore loses at most that one
notification instead of duplicating it. Only the caller that inserted the row posts; everyone else
traces `ride_summary_skipped` with `already_notified`.

Every terminal branch is traced under a `ride_finalized` workflow: `ride_summary_prepared`, then
either `ride_summary_notified` or `ride_summary_skipped` carrying `ride_summary_disabled`,
`permission_missing`, `already_notified`, or `ride_not_eligible`.

## Restore

On app foreground/resume, JS calls `syncNativeState()` and shows a restoring state
until the first native snapshot arrives. The restored state comes from native
service truth, not from cached JS status.

## Connection trace contract

Native emits connection automation diagnostics through one shared contract so every slice traces
the same way. Source of truth:

- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/ConnectionTrace.kt`
- `modules/vescape-core/ios/diagnostics/ConnectionTrace.swift`
- `src/modules/diagnostics/connectionTrace.ts` (JS mirror, render/export only)

The three files are linked by `@parity` and enforced value-identical by
`src/modules/diagnostics/connectionTrace.test.ts`.

### Workflows and correlation

`ConnectionTrace.start(origin, owner)` mints a workflow, emits `connection_workflow_started`, and
returns a handle. Every layer — lifecycle, scanner, connection, service, recording — emits its
child events through that same handle, so `workflow_id` survives handoff. A layer that only
receives the id (Android service restart, iOS background task, notification action) rebuilds the
handle with `ConnectionTrace.resume(workflowId, origin, startedAtMs, owner)`. `handoff(owner)`
records the new owner without changing the correlation. `finish(decision, reason)` emits
`connection_workflow_finished`.

Every event automatically carries `workflow_id`, `workflow_origin`, `workflow_owner`,
`workflow_started_at`, and `elapsed_ms`.

### Events

| Family               | Names                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow             | `connection_workflow_started`, `connection_workflow_finished`                                                                                                                                                                                                |
| Presence Scan        | `presence_scan_started`, `presence_scan_ready`, `presence_scan_observed`, `presence_scan_matched`, `presence_scan_timeout`, `presence_scan_cancelled`, `presence_scan_skipped`, `presence_scan_failed`                                                       |
| Ownership            | `connection_owner_granted`, `connection_owner_denied`, `connection_owner_released`                                                                                                                                                                           |
| Intent and promotion | `connect_intent_created`, `connect_intent_cleared`, `auto_connect_promoted`, `auto_connect_skipped`, `auto_start_armed`, `auto_start_triggered`, `auto_start_skipped`, `alternative_hint_offered`, `alternative_hint_accepted`, `alternative_hint_dismissed` |
| Pause                | `connection_pause_started`, `connection_pause_cleared`, `connection_pause_expired`, `connection_pause_blocked`                                                                                                                                               |
| Service              | `connection_service_started`, `connection_service_promoted_foreground`, `connection_service_demoted_background`, `connection_service_stopped`                                                                                                                |
| Foreground work      | `foreground_work_acquired`, `foreground_work_released`, `background_task_started`, `background_task_ended`, `background_task_expired`                                                                                                                        |
| Board and link       | `board_selected`, `board_link_persisted`, `board_link_failed`                                                                                                                                                                                                |
| Ride summary         | `ride_summary_prepared`, `ride_summary_notified`, `ride_summary_skipped`                                                                                                                                                                                     |

### Owners

Precedence order: `board_session`, `connect_intent`, `auto_start`, `auto_connect`,
`alternative_hint`. Exclusive scanner owners: `add_board_scan`, `board_probe`. No owner: `none`.

### Workflow origins

`foreground_entry`, `explicit_connect`, `auto_start_wake`, `alternative_hint_switch`,
`add_board_scan`, `board_probe`, `reconnect`, `manual_disconnect`, `end_ride`, `app_exit`,
`task_removed`, `ride_finalized`.

### Fields

`workflow_id`, `workflow_origin`, `workflow_owner`, `workflow_started_at`, `elapsed_ms`,
`board_id`, `ble_id`, `board_nickname`, `decision`, `reason`, `owner_previous`, `owner_requested`,
`deadline_ms`, `deadline_at`, `attempt`, `scan_purpose`, `observation_count`, `rssi`,
`pause_source`, `paused_until`, `auto_connect_enabled`, `auto_start_enabled`, `bluetooth_enabled`,
`permission_granted`, `app_foreground`, `service_state`, `ride_id`, `platform_error_code`,
`platform_error_domain`.

Later slices reuse these names. Add a field to all three files at once, never ad hoc in one layer.

### Decisions

`granted`, `denied`, `deferred`, `skipped`, `completed`, `timeout`, `cancelled`, `failed`.

### Terminal reasons

`matched`, `no_linked_boards`, `no_board_link`, `no_selected_board`, `board_not_present`,
`bluetooth_disabled`, `permission_missing`, `scanner_unavailable`, `scanner_busy`,
`auto_connect_disabled`, `auto_start_disabled`, `connection_paused`, `higher_priority_owner`,
`session_already_active`, `connect_intent_active`, `user_cancelled`, `stop_search`,
`deadline_expired`, `manual_disconnect`, `end_ride`, `app_exit`, `task_removed`, `auto_close`,
`mechanical_teardown`, `probe_cancelled`, `platform_error`, `ride_summary_disabled`,
`ride_not_eligible`, `already_notified`.

### Privacy

Full Board ids and BLE ids are deliberately present in Local Diagnostic Events, platform logs, and
the Event Log export; the export confirmation discloses that. Authentication data, PINs, tokens,
and telemetry payloads are excluded by contract — `ConnectionTrace` drops any field whose key
contains `auth`, `credential`, `jwt`, `password`, `payload`, `pin`, `secret`, `session_token`,
`telemetry`, or `token`.
