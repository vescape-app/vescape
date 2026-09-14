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
xcodebuild build -project ios/vescapedev.xcodeproj -target VescapeWatch -sdk watchsimulator26.5
```

`-target`, not `-scheme`: `-sdk watchsimulator` applies to every target in a scheme, and the scheme
also builds the iOS-only Live Activity widget, which then fails on `ActivityKit` (#485).

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

The rider-configurable refresh rate and the reduced ambient cadence landed with #486, below.

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

## Gauges and navigation (#485)

The wrist now draws Android's gauges and carries Android's page structure, on the rectangle.

### The rim is a path, not a circle

`watch/watchos/RimGauge.swift` builds the display's rounded-rectangle perimeter once and every gauge
is a trimmed span of it: speed climbs the left edge to top centre, duty the right, battery owns the
bottom edge, and the two temperatures pick up where the battery line ends, round the bottom corners
and carry on up the sides. Same metrics, same colours, same directions of travel as Wear OS — the
shape is the accepted platform difference.

The temperatures deliberately include the corner arc in their length rather than starting above it.
Anchored to the straight edge they left the corner unlit, and a bare corner between two lit gauges
reads as a gap in the rim instead of as two separate readings.

**Spans are anchored to edges, never to fixed perimeter fractions.** A circle has one radius, so
Android can say "start at 180°, sweep 90°" and mean the same place on every watch. A rectangle does
not: written as a share of the perimeter, a bottom span sized for one case runs off the short bottom
edge of another and climbs the sides. `Rim.Metrics` derives every landmark from the actual edge and
corner lengths, which is what keeps 40 mm and 44 mm the same layout rather than two tunings.

The display corner radius is an approximation (`Rim.cornerRatio`) — Apple publishes no API for it.

### What the rectangle changed, and what it did not

- **No wall clock.** watchOS draws the system time over every app; Wear OS's full-screen activity
  hides it, which is why `WatchClock.kt` exists and has no peer here. A second clock beside the real
  one was the first thing the simulator showed.
- **No curved text.** The bottom edge is flat and fits MOTOR / BATT / CTRL upright across it.
- **No close prompt.** Android intercepts Back; the Digital Crown press is the system's, not the
  app's.
- **Ambient is one bit.** `isLuminanceReduced` is the whole signal. Android's `lowBit` and
  `burnInProtection` branches, and its pixel walk, have no peer — the system does that itself.
- **Focus is settled, not dragged.** Android fades its readouts against the live drag offset. A
  `TabView` publishes no offset, so the transition animates between settled pages.
- **The link reasons are inferred from two flags.** `WCSession.isPaired` is iOS-only, so the wrist
  reads "app missing" and "link down" off companion-installed and reachable.

Everything behavioural stays Android's: the same metrics and units, the same fresh/stale/waiting/
disconnected reducer, the same cadence-derived disconnect window, the same page order on both axes,
the same 45 s idle return on the control axis, and the same rule that a page is not interactive
until its transition has settled.

### Navigation

`.verticalPage` gives the crown and the swipe on one axis, in Android's order — radar, weather,
gauges, navigation. The control axis nests inside the gauges page — gauges, Move, Lights,
diagnostics — and shows no page dots, because they land on the battery gauge and Android has none
either. The pages those slices fill are placeholders today (#486–#491); the axes are the point.

### Where the wrist logic lives

The parts with a right answer — the reducer, the gauge fractions, the readout strings, the fixture
parser — sit in `modules/vescape-core/ios/watch/` and are symlinked into `watch/watchos/`, the same
arrangement `WatchFrame.swift` already used. That tree is the only one `bun run test:ios` compiles,
so this is what buys the wrist unit tests at all. The cost is that the phone binary compiles a small
amount of pure code it never calls.

One real bug came straight out of that: Java's `String.format("%.0f", …)` rounds HALF_UP and C's
`printf` rounds half to **even**, so 18.5 km/h read as `19` on Android and would have read `18` on
the wrist. `WatchGauge` rounds away from zero explicitly, and a test pins it.

### Simulator replay

`watch/watchos/FrameReplay.swift` is the peer of `FrameReplay.kt`: it plays the Wear OS JSONL
fixtures into `PhoneLink` on the same path a phone push takes. Gated to the simulator and to an
explicit launch argument, so a real watch and a device build have no replay path. The fixture is
read from the repo tree rather than bundled — a copy is a second artefact that drifts, and the whole
point is that both wrists are fed the same bytes.

```
xcodebuild build -project ios/vescapedev.xcodeproj -target VescapeWatch \
  -sdk watchsimulator26.5 -configuration Debug CODE_SIGNING_ALLOWED=NO
xcrun simctl install <watch-udid> ios/build/Debug-watchsimulator/VescapeWatch.app
xcrun simctl launch <watch-udid> app.vescape.dev.watchkitapp \
  --replay "$PWD/watch/wearos/src/main/assets/watch-ride.jsonl"
```

Build with `-target VescapeWatch`, not `-scheme`: `-sdk watchsimulator` applies to every target in a
scheme, and the Live Activity widget is iOS-only, so the scheme build fails on `ActivityKit`.

### Verified on the simulator, 2026-09-15

Apple Watch SE 3 40 mm and 44 mm, replaying `watch-ride.jsonl` and `watch-sweep.jsonl`:

- Every metric and unit renders on both case sizes, with no interface fitted inside a circle.
- The sweep fixture drives every lane across its full range: speed clamps at the 50 km/h full scale
  instead of rescaling, both temperatures pin at 80 °C, and battery at 7 % takes the warning colour
  in both the gauge and the readout.
- Null lanes render as a dash at reduced size. At hero size an em dash reads as a filled progress
  bar, which is the opposite of "no reading" — the same trap the first slice's readout documented.

**Not verified.** Ambient rendering and the reduced ambient cadence: `isLuminanceReduced` cannot be
forced on the simulator, and per Apple's Always On guidance a simulator would not prove runtime
behaviour even if it could. Crown rotation, the swipe gestures and the transition gating were not
exercised — `simctl` drives neither the crown nor a paired-phone frame stream. All of that belongs
to the device session, along with everything the first slice already listed as unmeasured.

### Pager and glow implementation notes

The watchOS 10 pager observes unbounded page positions for both axes. Control interaction requires
page alignment and 100 ms without a geometry change; movement cancels that check. This is a
geometry-based fallback, not native scroll-phase parity. The outer vertical pager locks after a
horizontal control page settles; the horizontal pager explicitly remains enabled for returning.
Touches reset the 45-second idle return, and a finger held down prevents the return.

Before implementing Board Move, connect its hold lifecycle to both pager locks and command release.
Move is currently a placeholder; the touch observer only protects idle return and does not establish
motor-control gesture safety. Verify cancelled drags, crown scrolling, nested diagnostics scrolling,
and long holds on the device before enabling those controls.

The inward glow uses 16 overlapping clipped strokes per active gauge, independent of display size.
Its intensity and fade stops match Wear OS. This reduces draw calls from the previous size-dependent
75–100 strokes per gauge; physical-device frame time and power improvements remain unmeasured.

## Mirrored settings (#486)

The rider's phone settings now reach the wrist, and the push cadence they set is applied live.

### Cold state is the Application Context, and it is merged

`WCSession` offers three deliveries and they are not interchangeable:

- `sendMessageData` needs the counterpart reachable now and drops otherwise. Right for Watch
  Frames — a frame is worthless a tick later — and wrong for a setting the rider may change with
  the watch off the wrist and expect applied when they put it back on.
- `transferUserInfo` queues FIFO and delivers every item. A bag changed five times out of range
  would arrive five times, in order, and the wrist would animate through the rider's undo history.
- `updateApplicationContext` keeps exactly one latest value, delivers it opportunistically, and the
  system hands it to the watch app at its next launch through `receivedApplicationContext`.

The third is the one that matches Android's Data Layer: latest-value-wins, survives restart and
reconnect, no backlog. **No queue or buffer was written** — the platform already provides the
semantics, which is also why the Android peer pusher has none.

Android publishes each channel on its own path, so `/settings` and `/route` cannot overwrite each
other. watchOS has one Application Context per session and a whole-dictionary replace, so the
channels share a dictionary and `WatchColdState` is the only writer: it reads the current context,
puts one channel back, and leaves every other key untouched. Writing a channel any other way
silently deletes the route. It also keeps desired and delivered payloads apart, because the first
push of a cold process races session activation — a write refused then is retried on
`activationDidCompleteWith`, not mistaken for a write that landed.

The settings bag itself is Android's, key for key. A missing key is the wrist default, never a
zero: an absent Board Move strength coerced to a number reads as a rider choosing 0 %. A cleared
rider colour rides as a blank string rather than an absent key, so the wrist can tell "cleared"
from "phone too old to send it".

`WatchSettings.swift` and `WatchCommand.swift` are compiled into both the phone and the watch
target, the arrangement `WatchFrame.swift` already used — Android duplicates both by convention
across two Gradle modules, which is why it has two `WatchSettings.kt`.

### Cadence

`wearPushRateHz` (1–20, default 4) is re-read by `BoardSessionController.reloadWatchSettings()` and
re-arms the live tick; `WatchTick.setIntervalMs` already cancels and reschedules, so a lowered
interval takes effect immediately rather than after the current, longer delay.

This deliberately does **not** ride on `reloadTelemetrySettings`, which returns early with no Board
Session. The Watch Mirror is process scoped, not session scoped, so a rider changing the push rate
with no board connected must still reach the tick.

The wrist reports how awake it is — active, ambient, asleep — as the same two-byte command Android
uses, re-asserted every 15 s and immediately when the phone becomes reachable again. Ambient drops
the push to 5 s, matching Android. The cadence has a single owner (`applyWatchInterval`) because
both inputs must resolve together: applying either one directly lets a settings reload drop the
ambient rate back to the live one for the rest of the ambient stretch.

Two Android mechanisms have no peer here, both deliberately:

- **No wake gate on the push.** Android's Data Layer will happily deliver 4 Hz into a stopped
  activity, so it gates on the wake level. `WCSession.isReachable` is already false unless the watch
  app is running and in touch, so `canPush` covers the gate and the wake level only picks a cadence.
- **No capability probe.** Android ships phone and wrist on separate Play tracks, so it has to ask
  whether the installed wrist build speaks the wake protocol. The watch app is embedded in the phone
  app's bundle, so a wrist older than the phone cannot exist.

### Open on connect is not possible on watchOS

There is no public API for an iPhone app to launch its watchOS companion. The one API that starts a
watch app from the phone is `HKHealthStore.startWatchApp(with:)`, and it starts a **HealthKit
workout session** — fitness tracking, which docs above rule out, and which would also make the app
claim a workout the rider is not doing. `WCSession` has no launch call in that direction at all.

So the setting is not implemented and not silently dropped: the switch is shown disabled on iOS with
the reason in its hint, and `wearAutoLaunchOnConnect` is documented as Android-only in both the TS
settings contract and the iOS defaults. A rider who set it on Android and moved to an iPhone is told
why it stopped working rather than left with a toggle that does nothing.

### Naming

The persisted keys keep their `wear` prefix (`wearPushRateHz`, `wearNavArrowEnabled`,
`wearAutoLaunchOnConnect`). They predate the watchOS Mirror; renaming a stored settings key buys a
migration for nothing. Rider-facing copy says "watch", and the Settings entry is no longer gated to
Android.

### Verified, 2026-09-15

- `bun run test:ios` — the settings contract, the wire codec and the cold-state merge, including
  that writing the settings channel preserves an unrelated route channel and that a refused write is
  retried by the activation flush.
- `VescapeWatch` against `watchsimulator26.5` — builds with the shared files compiled into the watch
  target.
- `bun run ts`, `bun run lint`.

**Not verified.** Nothing here has run against a physical Apple Watch or a locked iPhone. The
end-to-end round trip — a setting changed on the phone appearing on the wrist, surviving a watch
restart, and the ambient cadence actually dropping to 5 s while the wrist is lowered — needs the
device session, as does whether `scenePhase` reports `.inactive` for the Always On state on
hardware. The `ios/` tree on this machine has no Pods and no workspace, so the iPhone app itself was
not compiled: the one edit outside the SwiftPM package is the four-line settings-key hook in
`VescapeCoreModule.swift`.

## Weather and radar (#488)

The forecast now reaches the wrist from native iOS, and Wear OS's forecast and radar pages are on
the rectangle.

### Weather is a cold-state channel, not a second writer

`WatchWeather.swift` is compiled into both targets, the arrangement `WatchFrame.swift` and
`WatchSettings.swift` already use, so the encoder and the decoder cannot drift. It rides the merged
Application Context as the `weather` channel through `WatchColdState` — the single writer — for the
reasons that file documents: latest-value-wins, survives a restart and a reconnect, no backlog.
Android publishes the same bag on its own `/weather` Data Layer path; the keys are Android's, key
for key, so the two wrists read the same forecast.

The push is native and process scoped. `WeatherCoordinator.onChange` belongs to the Expo module and
is re-assigned on every JS reload, so the mirror hangs off a second slot, `onNativeChange`, wired in
`startWatchMirror()` — the wrist keeps its forecast through a backgrounded phone and a JS restart.
A forecast already in hand at launch is pushed immediately rather than waited for: the coordinator
keeps the last successful one for the life of the process, and a reconnecting wrist would otherwise
sit blank for up to ten minutes.

Equality deliberately ignores `fetchedAtMs`, matching Android: refetching the same numbers ten
minutes later is not something the wrist should redraw for. The wrist reads the stamp anyway and
retires a forecast after three hours, so a phone that stopped refreshing shows "Forecast too old"
rather than yesterday's conditions looking current. Nothing arrived at all reads as "No forecast /
Waiting for your phone" — a different sentence, because it is a different problem.

### Radar fetches on the watch, and only while its page is on screen

RainViewer imagery is a dozen 256 px PNGs per refresh, worthless once stale, looked at on exactly
one page. Both `WCSession` deliveries are the wrong shape for it: `sendMessageData` is capped well
below a frame set and drops whenever the phone is away — which is when a watch on Wi-Fi can still
fetch — and `transferFile` is a background queue with no cancellation, so a page the rider swiped
past would keep spending the phone's radio and then deliver frames that are already history. So the
watch fetches the frames itself, the same decision Wear OS made, and the phone still owns _where_
the rider is: frames are centred on the forecast location it pushed, so the watch never touches
location services. A watch with no network shows "No radar / Watch has no network" and every other
page is unaffected.

The lifecycle is structured concurrency, not a flag consulted by a timer. `radarVisible` is the
radar page being the settled vertical page, `scenePhase == .active`, and not `isLuminanceReduced`;
both the fetch and the frame animation hang off `task(id:)` keyed on it. Leaving the page, lowering
the wrist or backgrounding the app cancels the task, and with it the in-flight `URLSession`
request — there is no detached task anywhere in `RadarStore`, which is what makes that cancellation
complete rather than advisory. A cancelled load is not reported as a failure: the rider left, and
telling them the watch has no network next time would be a lie.

### What the rectangle changed

- **Range rings are measured off the long side.** Wear OS scales its square frame to the circle's
  diameter. Here the frame covers the display's long side so there are no blank bands, and the rings
  are derived from that same side, so the scale stays honest. A ring that would fall outside the
  narrow dimension is dropped rather than clipped, the same rule Android applies near the poles.
- **The timeline is a rim span, not an arc.** It reuses `Rim.Metrics.battery` on a path one inset
  further in, so it sits inside the battery gauge on every case size without restating the geometry.
- **SF Symbols, not ported artwork.** Wear OS bundles Phosphor drawables because Android has no
  system set worth the name. The slugs — and therefore which condition gets which shape — are still
  the phone's; only the artwork is the platform's.
- **The forecast strip sits in the free centre.** Wear OS hangs it under its own wall clock, in the
  gap the rim arcs leave at the top. watchOS draws the system clock there and the app has no clock
  of its own, so the strip takes the centre the rectangle leaves free, and tapping it opens the
  weather page — only while the gauges page actually owns the screen, or the target would swallow
  drags meant for the pagers.

### Verified, 2026-09-15

- `bun run test:ios` — the weather wire contract (round trip, absent sun times, a short hour lane
  dropping that hour rather than fabricating a 0 °C clear sky, an absent channel, the channel read
  out of a merged context, refetch-is-not-a-change, the staleness window and a clock that jumped
  backwards) and the radar provider contract (observed frames only and not the nowcast, frame URLs,
  Web-Mercator ground range, and the centre-rounding that keeps GPS jitter from throwing the
  animation away).
- `VescapeWatch` against `watchsimulator26.5` — builds, with all seven new wrist files confirmed
  present in `VescapeWatch.SwiftFileList` rather than only in a build that succeeded.

**Not verified.** Nothing here has run against a physical Apple Watch, a locked iPhone, or live
weather. Not measured: a real forecast arriving on the wrist and surviving a watch restart, the
radar actually fetching over the watch's own network (and what it does on a cellular or
Wi-Fi-only watch), the frame animation's cost, whether cancellation on wrist-down is observable as
a stopped request rather than only as a cancelled task, and the rendered layout of either page on
hardware. The `ios/` tree on this machine has no Pods and no workspace, so the iPhone app itself was
not compiled — the phone-side changes were compiled by the SwiftPM package that `test:ios` builds,
not by an app build.
