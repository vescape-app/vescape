# iOS

## Ride Status Live Activity

The ride-status surface (connected / reconnecting / battery / fault) is a **Live Activity**
(ActivityKit) — the iOS peer of Android's persistent foreground-service notification. It replaced an
earlier approach that posted discrete one-shot local notifications per event, which stacked into a
messy pile. A Live Activity is a single card that lives for the whole Board Session and mutates in
place on the Lock Screen and Dynamic Island.

It is driven **entirely from native** (`ConnectionCoordinator` → `RideLiveActivityController`), so it
keeps updating while the screen is off and the JS runtime is dead — same ownership model as the
Android foreground notification. JS never touches it.

### Architecture

- `RideActivityAttributes` (`modules/vescape-core/ios/notification/`) — the ActivityKit contract:
  static `deviceName` + a mutable `ContentState` (phase, status text, short-critical glyph, battery
  percent, fault code).
- `RideLiveActivityController` — thin ActivityKit wrapper: `start` / `update` / `end`, holds the one
  `Activity<RideActivityAttributes>`.
- `RideActivityContent` — pure formatter that builds `ContentState`; mirrors Android
  `NotificationFormatter` + `BoardPhase.displayText` / `shortCriticalSymbol` wording.
- `targets/ride-activity/` — the widget extension (SwiftUI Lock Screen + Dynamic Island views) that
  renders the activity. It only reads `context.state`; it owns no logic.

### Lifecycle (wired in `ConnectionCoordinator`)

- **Start** in `beginSession` — iOS only allows _starting_ a Live Activity while the app is
  foreground, and a session always begins from a user-initiated connect, so this is safe. (Starting
  at `connected` would race a backgrounded app.)
- **Update** from BLE callbacks via `setPhase` (every phase change), battery (only when the integer
  percent steps, so the hot per-frame telemetry path does not spam ActivityKit), and fault
  (edge-triggered). Updates are background-safe.
- **End** in `endSession` / `fail`. A mid-ride drop does **not** end it — the session survives, so
  `setPhase(.reconnecting)` just refreshes the same card.
- Faults fold into the card's state (no separate banner), which is what killed the notification mess.

### Cross-target type sharing

A Live Activity's `ActivityAttributes` type must be compiled into **both** binaries: the `vescape-core`
module pod (drives it) and the widget extension (renders it). ActivityKit matches the two
separately-compiled copies by unqualified type name.

There is one canonical `RideActivityAttributes.swift` in the module (globbed into the pod by the
podspec). `targets/ride-activity/RideActivityAttributes.swift` is a **symlink** to it, so the widget
extension compiles the same source — no duplicated struct. This reuses the repo's existing symlink
pattern (see `cell-presets.json`). Xcode's file-system-synchronized group for the target follows the
symlink; this is verified to compile on device.

### Build / config requirements

- Widget target is created by `@bacons/apple-targets` (`targets/ride-activity/expo-target.config.js`,
  `type: 'widget'` — which links WidgetKit/SwiftUI/ActivityKit/AppIntents by default). No hand-rolled
  pbxproj plugin.
- `app.config.ts`: `ios.infoPlist.NSSupportsLiveActivities = true`.
- `ios.appleTeamId` (via `APPLE_TEAM_ID` env) is **required** — apple-targets needs it to sign the
  extension. Set it in `.env`, EAS secrets, or the build environment; otherwise prebuild warns and
  device builds fail to sign.
- App, widget, and `VescapeCore.podspec` deployment targets are `17.0`, required by Clerk's native
  iOS SDK. Keep all three aligned; lowering only Vescape/Widget config makes prebuild produce an
  invalid mixed-target project and CocoaPods rejects `ClerkExpo`. ActivityKit needs 16.1+, so the
  app's 17.0 floor also means its ActivityKit code needs no `@available` gating.
- The `widget` target adds an App Group entitlement by default. It is unused (local `update`s pass
  `ContentState` directly, no shared storage) but harmless; signing provisioning must cover it.

### Stop ride control

- The Lock Screen and expanded Dynamic Island presentations show **Stop ride**.
- The button uses `StopRideIntent`, a `LiveActivityIntent`. iOS launches the app process without
  opening the app UI, then routes to the same native manual-stop command used by the JS bridge.
- The command reaches `BoardSessionController.shared`; no JavaScript runtime or Expo module
  instance is required. Its active Board id gate makes duplicate invocations no-ops, and the first
  invocation tears down BLE, recording, GPS, alerts, and the Live Activity through `endSession`.
- The intent requires authentication. When the phone is locked, iOS asks the rider to authenticate
  before executing it; Vescape does not implement a custom unlock flow.
- There is no Connect or Exit action. A manual stop ends the Live Activity, and iOS apps cannot
  terminate themselves.

### Limits

- The user can disable Live Activities per-app in Settings; `RideLiveActivityController` checks
  `ActivityAuthorizationInfo().areActivitiesEnabled` and no-ops silently when off.

### References

- Apple ActivityKit: https://developer.apple.com/documentation/activitykit
- Displaying live data with Live Activities: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- `@bacons/apple-targets`: https://github.com/EvanBacon/expo-apple-targets

## Critical Ride Alert Notifications

Local notifications are **critical-alert-only**. They are not Android foreground-service parity and
they do not keep BLE, telemetry, or Ride Recording alive. Ongoing ride state remains owned by the
Live Activity.

- No notification is posted for normal `connected`, `reconnecting`, `rescanning`, `disconnected`, or
  stale-status churn.
- The current notification event is a Board Session fault detected while the app is backgrounded.
- Fault notifications are edge-deduped per Board Session and fault code, so a sustained fault does
  not post every telemetry frame. Clearing and re-entering the fault can post again.
- `BoardSessionController` checks existing `UNUserNotificationCenter` authorization and never prompts
  during connect or telemetry. Permission is exposed through explicit native APIs:
  `requestCriticalRideNotificationPermission` and `getCriticalRideNotificationPermissionStatus`.
- If notification permission is denied or not determined, the fault still updates the Live Activity
  and no local notification is posted.

## Background Ride Recording

iOS has no Android `ForegroundService` equivalent. A locked-screen ride cannot rely on a permanent BLE worker or notification. The implementable path for this app is native iOS ownership of the ride session, with background location used as the legitimate long-running activity and CoreBluetooth used for BLE event restoration.

### Implement

- Keep `UIBackgroundModes` in Expo config for `bluetooth-central` and `location`.
- Implement native `CLLocationManager` ride tracking:
  - start when a Board Session starts;
  - stop when the rider explicitly stops the Board Session;
  - set `allowsBackgroundLocationUpdates = true`;
  - set `pausesLocationUpdatesAutomatically = false`;
  - request the location permission level needed for locked-screen ride recording.
- Keep BLE polling and telemetry persistence in native Swift. JS should render state and send intents, not own durable ride work.
- CoreBluetooth state preservation/restoration (done, #378 / ADR 0034):
  - the Board Session central carries `CBCentralManagerOptionRestoreIdentifierKey`; the Board Probe
    central stays bare;
  - `VescapeLaunchSubscriber` (autolinked app-delegate subscriber) re-creates that central inside
    `didFinishLaunching`, gated on the `SessionResumeStore` marker so a normal cold start starts no
    BLE;
  - `centralManager(_:willRestoreState:)` hands restored peripherals to `BoardSessionController`,
    which rebuilds the session from the saved Board Link through the ordinary `beginSession` wiring:
    recording keeps appending to the open recording, GPS re-arms, alerts and the Live Activity
    resume, all with no JS involved.
- Move live session ownership below Expo module lifetime:
  - use a native singleton/runtime, e.g. `VescapeCoreRuntime.shared`, to own `ConnectionCoordinator`;
  - Expo module attaches/detaches event sinks only;
  - `OnDestroy` must not call `stopBoard()`;
  - explicit user `stopBoard()` remains the disconnect path.
- Persist telemetry samples natively during the ride. JS may be suspended while native continues.

### Limits

- `bluetooth-central` wakes the app for BLE events; it does not grant continuous arbitrary execution.
- VESC telemetry is request/response in this app. If iOS suspends all execution, native poll timers stop and the board will not send new telemetry replies.
- A peripheral-side heartbeat/streaming notification would be the cleanest BLE-native wake source, but it requires firmware/peripheral behavior we do not control.
- Background scanning is throttled and should be treated as reconnect assistance only.
- If the user force-quits the app, iOS may prevent background relaunch until the user opens the app again.
- `BGTaskScheduler`, silent push, or background fetch are not suitable for live ride telemetry.
- `audio` background mode should not be used as a silent keepalive hack; it risks App Store rejection unless the app has real user-facing audio.

### Why Float Control Can Likely Record Locked Rides

Float Control's App Store listing says it may use location even when not open. That points to the same viable model: real ride GPS tracking keeps the native process eligible for background execution, while BLE polling and ride recording happen inside native code.

### References

- Apple CoreBluetooth background processing: https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- Apple background execution modes: https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
- Punch Through background BLE/state restoration notes: https://punchthrough.com/leveraging-background-bluetooth-for-a-great-user-experience/
