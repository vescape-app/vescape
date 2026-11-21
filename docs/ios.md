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

### Lifecycle & Ride Notice constraints

Driven in `BoardSessionController` (`modules/vescape-core/ios/notification/` + `targets/ride-activity/` widget extension):

- **Start vs resume in `beginSession`:** `Activity.request` is foreground-only on iOS, while `update` is background-safe. A foreground session calls `liveActivity.start(...)`; a headless restoration or background auto-connect calls `liveActivity.resume(...)` to adopt any surviving Live Activity rather than ending one it cannot replace.
- **Throttled background updates:** pushed on phase changes, integer battery-percent steps, edge-triggered faults (folded into the card — no separate banner), and when the top Ride Notice's `(id, rev, title, severity)` changes (never per telemetry/engine tick, to preserve ActivityKit's update budget). `noticeTitle` / `noticeSeverity` are optional `ContentState` fields so activities started by an older build still decode.
- **Session-scoped lifetime:** `endSession` / `fail` ends the card; mid-ride dropouts refresh the same card to `.reconnecting`. A Ride Notice never starts a Live Activity or posts a notification (no board-less Lock Screen card; Android mirrors this by only leading its existing foreground-service status line).

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
  instance is required. Stop applies while connecting, searching, reconnecting, or awaiting
  restoration as well as while connected. It cancels deferred BLE work and restoration, suppresses
  launch auto-connect for that Board, and tears down recording, GPS, alerts, and the Live Activity.
  Duplicate invocations are harmless. The intent waits for Live Activity dismissal before returning.
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

iOS has no Android `ForegroundService` equivalent. A locked-screen ride relies on native iOS ownership of the ride session, with background location as the legitimate long-running activity and CoreBluetooth state restoration for BLE wakeups.

### Implementation

- `UIBackgroundModes` enables `bluetooth-central` and `location`.
- Native `CLLocationManager` (`GpsMonitor`) runs with `allowsBackgroundLocationUpdates = true` and `pausesLocationUpdatesAutomatically = false` in `ride` GPS Power Mode (see [connectionState.md](./connectionState.md#gps-demand)).
- BLE polling, alerts, and telemetry persistence run in native Swift (`BoardSessionController.shared`, owned below Expo module lifetime — `VescapeCoreModule.OnDestroy` detaches event sinks only and never calls `stopBoard()`).
- **Background modes keep JS and the sensors running.** `bluetooth-central` and `location` keep the JS thread, CoreMotion, and CoreLocation active with the screen off; only `requestAnimationFrame` pauses. Gate visual-only loops (map camera writes, heading sensors, animations) on `AppState`, or writes queue against a dark screen and trigger FrontBoard's 10 s watchdog kill on unlock (see [agents/mapbox-patches.md](./agents/mapbox-patches.md#camera-loop--shapesource-traps)).
- CoreBluetooth state preservation/restoration ([ADR-0034](./adr/0034-ios-background-lifetime-anchor-and-restoration.md)):
  - the Board Session central carries `CBCentralManagerOptionRestoreIdentifierKey`; the Board Probe central stays bare; Accessories use their own restoration central;
  - `VescapeLaunchSubscriber` runs in fixed order inside `didFinishLaunching`: `BoardSessionController.prepareForLaunch()` (restoration, gated on `SessionResumeStore` so a cold start without a resume marker doesn't spin up restoration BLE), then `autoConnectSelectedBoard()` (only if no session is resuming and auto-connect is eligible), then `AccessorySessionController.prepareForLaunch()` (enrolled accessories always come up on their own restoration central), then `startWatchMirror()`;
  - `centralManager(_:willRestoreState:)` hands restored peripherals to `BoardSessionController`, which rebuilds the session, re-arms recording/GPS/alerts, and resumes the Live Activity with no JS involved.

### Limits

- `bluetooth-central` wakes the app for BLE events; it does not grant continuous arbitrary execution.
- VESC telemetry is request/response in this app. If iOS suspends all execution, native poll timers stop and the board will not send new telemetry replies.
- Background scanning is throttled and should be treated as reconnect assistance only.
- If the user force-quits the app, iOS may prevent background relaunch until the user opens the app again.
- `BGTaskScheduler`, silent push, or background fetch are not suitable for live ride telemetry.
- `audio` background mode should not be used as a silent keepalive hack; it risks App Store rejection unless the app has real user-facing audio.

### References

- Apple CoreBluetooth background processing: https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- Apple background execution modes: https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
- Punch Through background BLE/state restoration notes: https://punchthrough.com/leveraging-background-bluetooth-for-a-great-user-experience/
