# watchOS

WatchOS requirements, platform decisions, constraints, and findings from development and device testing. Runtime behavior is still under investigation.

The watchOS Mirror targets the existing Wear OS Mirror's behavior as closely as the platform permits. The Apple Watch arriving on 2026-09-15 is an opportunity for the first physical-device tests, not a delivery deadline or a reason to reduce the target scope.

Use the repository's bidirectional `@parity` contract for equivalent implementations. Specific platform differences remain design questions until agreed; arrival of the device does not implicitly accept them. Implementation waits until the design interview reaches shared understanding.

Parity follows current Android code, not obsolete feature descriptions. Android no longer forwards alerts to the wrist; its Move and Lights interaction haptics do not constitute alert playback. Watch alert forwarding is therefore not part of this parity scope.

The rider uses the watch while the iPhone stays locked in a pocket. Lowering the wrist must preserve visible gauges with reduced-refresh updates during the ride, matching Wear OS ambient behavior as closely as watchOS permits. This is an accepted product requirement, not a verified watchOS capability; the lifecycle mechanism and physical-device validation remain unresolved.

The watchOS layout uses the full usable rectangular display rather than fitting Wear OS's circular layout inside it. Adapt the rim gauges to the display edges and use the available center area for page content, respecting rounded corners and system safe areas. Preserve the metrics, pages, and controls from Android. This intentional visual platform difference does not relax behavioral or data-contract parity.

Keep Android's swipe navigation and additionally support turning the Digital Crown, the watch's side knob, to navigate vertical pages. It is an alternative navigation input, not a replacement for touch gestures or a Board control.

The first physical test device is the rider's Apple Watch Series 6. Its installed watchOS version and case size are not yet confirmed. Implementation choices must support this device; it does not establish the minimum supported hardware for the product.

Preserve Android's rider-configurable watch refresh rate. There is no fixed battery-duration acceptance target; measure actual runtime on the physical watch and tune from those results.

The rider delegates Apple-specific implementation choices. Do not require them to choose unfamiliar APIs; investigate the mechanisms against the accepted riding behavior and report material product limitations.

## Runtime investigation, 2026-09-14

[Float Control's App Store listing](https://apps.apple.com/us/app/float-control-vesc-companion/id1590924299) confirms wrist telemetry and voice-summary commands, requires watchOS 10.2 or later, and declares background location use. It does not establish which process uses location, whether it uses workout sessions, or whether wrist-down telemetry updates continuously. Its implementation must not be inferred from its store category or the presence of watch support.

[Apple's background location guidance](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) supports real-time navigation on watchOS. Investigate this mechanism first for Vescape's navigation behavior, without introducing fitness tracking. Location must serve an actual feature, not be a discarded stream used solely to evade suspension. Behavior when no route is active, when stationary, and when location permission is denied remains unresolved.

[WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity/wcsession) offers immediate messages to reachable apps and deferred background transfers. Use immediate messages for live frames and rider commands; never substitute queued background delivery for Board Move holds. Mirror cold state through latest-state delivery, preserving independent route, settings, weather, and Board state when updating the combined context.

[Apple's Always On documentation](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state/) distinguishes displaying an inactive app from continuing to execute and update it. The Series 6 display alone does not prove runtime parity. Do not mark ambient parity complete based on simulator screenshots.

## First implementation and device verification

Start with native phone-to-watch frames and lifecycle instrumentation before completing the UI. Keep durable watch source under `watch/watchos/` with reproducible config-plugin injection, following ADR-0019. Reuse the existing native iOS Board state and action owners; do not introduce a JS-dependent live path.

Verify changing frame timestamps with the phone locked, wrist raised and lowered, both with and without an active route, while moving and stationary. Check freshness after interruption and reconnection. Measure actual received and rendered cadence against the rider setting; Android currently defaults to 4 Hz active and pushes every 5 seconds in ambient mode.

Then port the remaining Android channels, controls, and rectangular UI with bidirectional parity links and matching contract fixtures. Preserve the phone-side Board Move timeout, immediate stop on release, and rejection of controls on stale state. Validate delayed and lost commands before testing motor movement.

If the runtime experiment cannot meet wrist-down behavior, record the measured limitation and revise the mechanism. Do not silently replace the agreed behavior with updates only after raising the wrist.

## Project setup (#484)

The watch app is a native SwiftUI companion. Its durable source is `watch/watchos/`, the Apple peer
of `watch/wearos/`; the generated `ios/` tree holds no watch source of its own.

- **Target generation.** `@bacons/apple-targets` builds the target from
  `watch/watchos/expo-target.config.js` (`type: 'watch'`). It is registered once in `app.config.ts`
  with `root: '.'` and `match: '{targets/*,watch/watchos}'` — one registration covering both the
  extension root and the watch root. The plugin cannot be listed twice: its Xcode base-mod provider
  must be the last mod added, and a second registration fails the prebuild with
  `Cannot add mod to "ios.xcodeProjectBeta2"`.
- **What prebuild produces.** `SDKROOT=watchos`, `TARGETED_DEVICE_FAMILY=4`,
  `WATCHOS_DEPLOYMENT_TARGET=10.0`, an Embed Watch Content phase on the iPhone app, a target
  dependency, and a `VescapeWatch` scheme. Targets are keyed by name, so repeated prebuilds update
  the one target instead of appending another.
- **Identity.** `bundleIdentifier: '.watchkitapp'` appends to the phone's, so the variants stay
  paired with no second switch to maintain: `app.vescape.dev` → `app.vescape.dev.watchkitapp`,
  `app.vescape` → `app.vescape.watchkitapp`. `WKCompanionAppBundleIdentifier` is filled from the
  phone target. Version and build number come from the phone app (`CFBundleShortVersionString`
  0.92.1, `CFBundleVersion` from `VERSION_CODE`). Signing uses `APPLE_TEAM_ID` from `.env.local`,
  same as the rest of the project — nothing machine-specific is committed.
- **Deployment target 10.0.** Series 6 runs anything from watchOS 7 to 26 and the rider's installed
  version is not confirmed, so the floor sits below it rather than forcing an OS update before the
  first test. Nothing in this slice needs newer API; WatchConnectivity is watchOS 2.

### Building and running

The watch target compiles against the watchOS simulator SDK:

```
xcodebuild build -project ios/vescapedev.xcodeproj -scheme VescapeWatch -sdk watchsimulator26.5
```

**The watchOS platform must be installed** (`xcodebuild -downloadPlatform watchOS`). Without the
simulator runtime, Xcode refuses the _iPhone_ scheme outright — "This scheme builds an embedded
Apple Watch app. watchOS 26.5 must be installed in order to run the scheme" — so `bun run ios`
fails on a machine that has never done watchOS work, even though nothing about the phone app
changed. This is a machine setup step, not a project one; do not work around it in project config.

Installing on the paired watch is Xcode's normal flow: build and run the `VescapeWatch` scheme with
the watch selected as destination, or install the phone app and let the watch pull the embedded
companion from the Watch app on iPhone.

### Build verification, 2026-09-14

Run on this machine, unsigned:

- `VescapeWatch` against `watchsimulator26.5` — succeeds.
- The iPhone app, Debug, iOS Simulator — succeeds, and the product carries
  `vescapedev.app/Watch/VescapeWatch.app`.
- The iPhone app, Release, `generic/platform=iOS` — succeeds, same embedded path. The watch binary
  is `arm64_32` + `arm64`, so Series 6 is covered. This is the product `xcodebuild archive`
  packages, which is as far as the archive claim can be taken without signing credentials: **no
  archive or App Store export has been produced.**

Release builds also need `SENTRY_DISABLE_AUTO_UPLOAD=true` (or a `SENTRY_AUTH_TOKEN`) locally. That
gate predates the watch app and has nothing to do with it.

### The apple-targets patch is load-bearing

`patches/@bacons%2Fapple-targets@4.0.7.patch` anchors the shared `expo:targets` group at the project
parent and gives each synchronized root group its full path from there. Upstream derives the group
path from `path.dirname(props.cwd)` of whichever target it processes first. With targets under two
roots — `targets/*` and `watch/watchos` — the first target won the group path and the second
resolved to a directory that does not exist.

This fails **silently**: the target, its build settings, its Info.plist and its embed phase are all
correct, the build succeeds, and it produces a watch app with no sources in it. Verify a watch
change by checking the build actually compiled the source files, not by checking that it succeeded.

### Running on the watch simulator

There is no Series 6 simulator in the watchOS 26.5 runtime; **Apple Watch SE 3 (40mm)** is the
closest geometry. A watch simulator on its own reports `not activated` — WatchConnectivity needs a
paired phone, so pair the two before expecting frames:

```
xcrun simctl pair <watch-udid> <phone-udid>     # once; both must be shut down
xcrun simctl boot <phone-udid> && xcrun simctl boot <watch-udid>
xcrun simctl list pairs                          # wait for "(active, connected)"
```

Install the phone app first and the watch app second — installing the iPhone app also installs the
watch app embedded in it, which is not necessarily the one just built:

```
xcrun simctl install <phone-udid> <DerivedData>/Debug-iphonesimulator/vescapedev.app
xcrun simctl install <watch-udid> ios/build/Debug-watchsimulator/VescapeWatch.app
xcrun simctl launch <phone-udid> app.vescape.dev
xcrun simctl launch <watch-udid> app.vescape.dev.watchkitapp
```

Frames start with the phone app, not with a board session, so the wrist fills in with no board
connected: every Board lane reads `—` and the instrumentation panel goes live.

### Measured on the simulator, 2026-09-14

Paired SE 3 (40mm) + iPhone 17, no board:

- `link: reachable` — session activated, paired, companion installed, reachable.
- `age: 0.0s` sustained.
- `rx: 4.0 / 4.0 Hz` received/drawn, against the configured 250 ms tick. Readings during the first
  few seconds run high (4.5 Hz) while the 5-second rate window is still filling; wait for it before
  believing a cadence number.

This proves the encode → `sendMessageData` → decode → render path and the cadence. It proves
**nothing** about wrist-down execution, ambient behavior or a locked phone: both simulator apps were
foreground on a Mac. Simulator rendering is not evidence of background execution.

### Telemetry path

`vescape-core` owns the phone side, beside the telemetry truth, so the wrist keeps updating while
JS is backgrounded mid-ride:

- `ios/watch/WatchFrame.swift` — the frame model, builder, encoder and decoder. Symlinked into
  `watch/watchos/`, so phone and wrist compile the _same_ lane order. This is the one place watchOS
  is better off than Android, where the wrist decoder is a separate Gradle app and the lane list is
  duplicated by convention (ADR-0018).
- `ios/watch/WatchTick.swift` — the cadence, 4 Hz, matching Android's active-mode default.
- `ios/watch/WatchTelemetryPusher.swift` — `WCSession.sendMessageData`, gated on
  activated + paired + app installed + reachable.

Started from `VescapeLaunchSubscriber` at process launch, not at session start: the wrist mirrors
the phone, not the board session. Android starts the same tick in `CoreForegroundService.onCreate`
and stops it on service destroy; iOS has no service to bound it by, so there is a start and no stop.

Not yet filled on iOS, and marked `TODO(ios parity)` in `BoardSessionController`:

- Navigation and route-placement lanes (5–10). They ride as `NaN`, which is exactly the "no
  Navigation" case the wrist already draws.
- Live `max_duty` exclusion. Android nulls duty per live sample; iOS decides exclusion at
  bucket-build time and has no live flag, so the wrist shows raw duty.
- The rider-configurable refresh rate and the reduced ambient cadence.

### Lifecycle instrumentation

The wrist readout is deliberately minimal and deliberately instrumented — the runtime question
below the metrics is what this slice exists to answer, and a finished UI on an unproven execution
model would make a stalled mirror look healthy. `MirrorView` shows session activation state, phone
reachability, companion-installed, **frame age**, received Hz and drawn Hz. Age is the one that
answers the wrist-down question: if the app stops executing while lowered, age climbs while the
numbers above it freeze at a value that still looks plausible.

`WKSupportsAlwaysOnDisplay` is set, and the readout uses `TimelineView` rather than a timer so the
system decides the ambient re-evaluation rate — the degradation is itself the measurement.

Phone-side counterpart transitions (activation, install, reachability) and send failures are
recorded as Local Diagnostic Events, one per streak, so a field session is readable afterwards
instead of only while someone is watching the wrist.

**Not yet measured.** Nothing in this section has been run against a physical Series 6 or a locked
iPhone. No claim is made here about wrist-down execution, ambient cadence, behavior with no route,
stationary behavior, connectivity loss and restoration, or permission-denied behavior. Those
readings, and the decision the last acceptance criterion turns on, belong to the device session.
