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

  recording: {
    enabled: boolean
    activeBoardId: string | null
    startedAt: number | null
  }
}
```

## Runtime split

Native has separate live runtimes:

- board runtime: BLE GATT, VESC polling, telemetry, reconnect, board recording
- GPS runtime: location listener, latest fix, recent fixes, map data
- scan runtime: BLE scanner owned by the Expo module bridge

Board connect/disconnect must not clear GPS fixes. GPS is app-level map data.
On iOS, `GpsMonitor` owns the location manager and `LocationTracker` owns fix state, course
derivation and the recent-fix window. `BoardSessionController` reads the tracker and wires its
consumers. Replay teardown alone clears recorded fixes and restores the parked live monitor.

### GPS phase

Native decides the phase; JS renders it and never derives one from a boolean.

- `idle` — no location manager is held.
- `starting` — a manager is held but updates are not running: the iOS permission dialog is open, or
  the Android foreground service that arms the monitor is still starting.
- `active` — location updates were actually requested and fixes can arrive.
- `error` — the monitor refused or failed. Always carries the same string as `gps.error`.

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

Auto-connect is triggered by **process launch on both platforms**, never by the JS
runtime coming up:

- Android: `AutoConnectProvider` (a `ContentProvider`) → `CoreForegroundService.autoConnectSelectedBoard`
  → `BoardSessionController.autoConnectSelectedBoard`.
- iOS: `VescapeLaunchSubscriber` in `didFinishLaunchingWithOptions` → `BoardSessionController.autoConnectSelectedBoard`,
  called right after `prepareForLaunch()`.

On iOS the order inside the launch hook is fixed: CoreBluetooth state restoration
(ADR 0034) decides first, and auto-connect starts a session only when no live session
is being resumed. A JS reload creates a new module but no new process, so it never
restarts or duplicates a live session.

Auto-connect no-ops when the `autoConnect` setting is off, no board is selected, the
board is unlinked, or the board is gated by a manual-stop tombstone. Starting a Board
Session clears that tombstone on both platforms, so a manual stop followed by a real
reconnect auto-connects on the next launch.

JS never triggers auto-connect. Its only part is writing the `autoConnect` setting and
prompting for BLE permissions; the launch path reads the persisted setting and connects
on its own, with or without a JS runtime.

Native owns the connection throughout. On Android the foreground service keeps BLE work
alive while JS is backgrounded or frozen.

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

Recording means real Ride Recording. A connected Board starts it; from then on it is a capture with
its own durable identity, not a property of the Board Link.

- A connected Board must have started it. Standalone GPS never starts one — GPS without a Board is
  map/status only, and creates no ride history.
- It saves Board telemetry **and** a Ride Track of GPS fixes, on two separate clocks (ADR 0038).
- **It outlives the Board Link.** An unexpected drop does not end it. GPS fixes keep landing in the
  same recording for the whole reconnect loop, however long that takes, and telemetry rejoins the
  same recording when the Board returns — one ride, one history entry, with an honest gap where the
  telemetry was missing.
- There is no hard timeout and no GPS-based Idle Pause. Neither elapsed disconnection time nor GPS
  inactivity ends or pauses a recording.
- It ends only on **explicit rider Stop Recording**, **explicit Disconnect**, a fatal board error, or
  service stop — plus an explicit Connect to a **different** Board (below).

### Persisted end intent

`ride_recordings.ended_at_ms` is the durable record that a recording ended, and nothing clears it.
Only a row with `ended_at_ms IS NULL` can be rejoined, which is what stops a late reconnect callback,
a stale delegate call, or an iOS state-restoration relaunch from reviving a ride the rider ended.
Starting again after a stop mints a new identity, even within the same minute.

Within a live Board Session the same intent is held in memory: auto-recording fires at the **first**
board-ready of a session only, so a reconnect's board-ready never restarts a recording the rider
stopped, nor mints a second one beside the recording still open across the drop.

### Idle Pause and disconnection

While **connected**, the Board controls Idle Pause (ADR 0021): after 30s of non-moving Board samples
both telemetry and Ride Track writes pause, even if the phone is moving, and Board movement resumes
both. A moving phone never overrides a stationary connected Board, and nothing captured while paused
is backfilled on resume.

On **unexpected disconnection the pause gate is released**, because it halts GPS too and off the link
there is no Board movement signal to ever reopen it. Recording continues on GPS alone until the rider
stops it. On reconnection the detector takes over again from the next board-ready.

### Changing Boards

An explicit Connect targeting a different Board ends the previous Board Session and Ride Recording
immediately — including while the old Board is disconnected and reconnecting, and even if the new
connection then fails. Merely browsing or selecting another Board does not end capture. Writes
already admitted are flushed under their original Board and recording identities; fixes captured
between two recordings are never backfilled into either. Old reconnect work is cancelled and late
callbacks for the old Board cannot revive its recording or contaminate the new one.

Stopping a recording releases only its own GPS demand. An independent live GPS consumer — Group Ride,
the map — keeps its own lifetime and stays armed.

Debug raw BLE recording is separate. Android Dev → Debug recordings can capture
raw chunks, connection states, and location for diagnosis, then list and export
the JSONL files. Debug replay playback is intentionally removed from the app.

## Restore

On app foreground/resume, JS calls `syncNativeState()` and shows a restoring state
until the first native snapshot arrives. The restored state comes from native
service truth, not from cached JS status.

### iOS state-restoration relaunch

A CoreBluetooth state-restoration relaunch (ADR 0034) rebuilds the Board Session that was live when
the process died, and its recording **rejoins the open Ride Recording** instead of starting a second
one — a process death the rider never asked for must not split their ride into two history entries.

The resume marker only says the rider had recording on; whether a recording is still open is the
database's answer, so an explicitly stopped or disconnected recording is not revived and a new one is
started instead. The dead interval stays a real gap in both streams: nothing is fabricated for time
the process could not run.

A recording left open by a process that died and was never restored is closed (`disconnected`) when
the next recording is minted — the one moment it is known to be unrejoinable.

@platform-diff Android has no peer. `CoreForegroundService` keeps the process alive, so there is no
restoration relaunch, and its launch auto-connect is an ordinary cold start that may be days later.
