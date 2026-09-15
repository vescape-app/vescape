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

The pager uses full-screen bounds. Radar imagery reaches the display boundary. Gauge strokes are
centered on their paths: the path inset is half the thickest stroke (2 pt for a 4 pt line), keeping
its outer edge at the display boundary. Zero inset clips straight segments and makes them appear
thinner than corners. Do not shrink radar imagery to the ring. Inner content uses 12 pt on watchOS
(Wear OS retains 14 dp and a 3 dp gauge inset).

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
either. The pages those slices fill arrived with later slices (#486–#491); the axes are the point.

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

Both platforms also read `watch/wearos/src/main/assets/watch-weather.json`. watchOS finds it beside
the selected JSONL file; Wear OS loads it from assets. It supplies 17°C, partly cloudy conditions,
12 forecast hours, sunrise/sunset and Warsaw coordinates (52.2297, 21.0122). Forecast freshness is
stamped at replay start and hourly labels begin at the next local full hour, wrapping at midnight.
Restart replay after three hours to refresh it. Replay skips live phone listeners on both platforms
so an empty phone context cannot erase the fixture. Wear OS already supported this companion asset;
watchOS now uses the same data and timing rules.

The forecast is synthetic; radar uses real network imagery at the fixture coordinates. Open weather
to check temperature, hourly scrolling and sun times, then radar to check loading and animation.
No rain at that location can mean little visible radar color. A fetch failure is recorded in
diagnostics. This checks rendering and radar networking, not phone-to-watch forecast delivery.
Use the existing `bun run wear:replay` workflow for the same weather/radar inputs on Wear OS.

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
Page movement, page changes, background taps and Move hold changes reset the 45-second idle
return. An active Move hold prevents the return. There is no root drag recognizer tracking touches.

Board Move (#490) connects its hold lifecycle to both pager locks and to command release: while
`moveHeld` is true the vertical axis is disabled, the horizontal axis loses its returning override,
and the idle return is suspended. Cancelled drags, crown scrolling, nested diagnostics scrolling and
long holds are still unverified on a device.

### Paging regression findings (2026-09-15)

On the Apple Watch SE 3 (40 mm), watchOS 26.5 simulator, background swipes appeared stuck while
swipes starting on arrow buttons could work. Colored page probes exposed a shifted page, a strip
of the next page and a black area that did not accept drags. `FrameLayout` ignored safe areas,
but the pager still used the smaller safe-area bounds. Applying `.ignoresSafeArea()` to the
whole mirror gives the pager and pinned gauges the same screen bounds. The user confirmed that
the colored pages filled the screen and the real pages and Move controls then worked.

Keep these constraints when changing this screen:

- Keep paging and gauge bounds aligned; changing only the gauge drawing does not enlarge the
  pager's touch region. Check page alignment before changing gesture arbitration.
- Keep a full-size gauges page even without weather. `Color.clear` preserves the horizontal
  page slot; the conditional weather readout is pinned outside the pager with the telemetry.
- Move uses native `ButtonStyle.configuration.isPressed` tracking. Avoid adding a competing
  zero-distance drag recognizer to the buttons or root solely to observe touches.
- Keep the horizontal scroll-enabled override when the outer vertical pager is locked. Both
  axes lock during a Move hold, then unlock appropriately on release.

For a regression, start with two solid colored pages and visible touch targets. Add buttons,
nested vertical paging, scroll locks, hold tracking, geometry settling, transparent button
labels, gauge overlay, then the real shell and Move view one at a time. Those combinations
passed user-driven simulator checks after aligning the bounds. Earlier gesture-only changes
did not resolve the report; this does not establish that every earlier gesture implementation
was correct. Do not restart that guessing loop.

Rebuild, reinstall and relaunch after each source change. Label each temporary stage visibly;
one submitted screenshot still showed an earlier stage. Debug readouts must be compact and use
`.allowsHitTesting(false)`; drag recognizers used as probes can alter the behavior being measured.
Remove temporary pages, readouts, launch switches and command bypasses after diagnosis.

The final staged simulator check covered real telemetry, Move, lights and diagnostics paging,
background swipes and arrow hold/release. Move commands were suppressed during that check.
This verifies UI behavior, not motor operation, physical-watch gestures or Always On behavior;
those remain part of #491's hardware validation.

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
- **The forecast strip sits above speed at the top left**, inside the rim. Wear OS hangs it under
  its own wall clock; watchOS leaves the upper right for the system clock. The compact row is pinned
  outside the pager and uses the telemetry fade as pages move. Tapping it opens the
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

## Route navigation (#487)

The route the rider is following now reaches the wrist, and the Wear OS route, pointer and distance
are on the rectangle.

### The clear is a value, not a missing key

Android publishes the polyline on its own `/route` Data Layer path and clears it by **deleting** the
data item. There is no delete here. The channels share one Application Context, the delivery is
latest-value-wins, and an absent key is indistinguishable from a key whose push never arrived — so a
clear that rode as a removed channel would be undone by the next reconnect, and the wrist would
restore the route the rider had already cleared. The clear is therefore an explicit payload: the
version with no points. `WatchRoute.decode` reads it, an absent channel and an unreadable one
identically as "no route", because the rider cannot act on the difference.

The same reasoning is why `WatchRouteMirror.attach` pushes immediately instead of waiting for the
first path change. On a phone with a restored Navigation that push is the route; on a phone with
none it is the clear, which is the value that has to be in the context for a wrist that reconnects
having never been told the last route ended.

The polyline itself is Android's byte layout verbatim — version byte, uint16 count, float64 origin,
then int32 micro-degree deltas measured against what the decoder will have reconstructed rather than
against the source point, so rounding cannot accumulate along a long route. The one number that
differs is the point ceiling: 2 000 rather than Android's 8 000, because a Data Layer item has a
path to itself while this one shares a dictionary that is replaced as a unit. `updateApplicationContext`
rejects an oversized payload with `WCErrorCodePayloadTooLarge` and Apple publishes no limit, so the
cap is a margin rather than a number tuned against a measured one. Above it the route is strided
down with its endpoints kept, exactly as Android does.

### The origin moves only once the route has landed

The wrist picture has two halves: the polyline on the cold channel, and where the rider is on it, in
the Watch Frame's `riderEast`/`riderNorth` lanes as metres from the route's origin. An origin
pointing at a route the wrist does not hold puts the rider off the line, and unlike a one-frame skew
that state lasts until the next route change. So `WatchColdState` reports the channel it actually
wrote — including on the activation retry — and the mirror promotes its origin only then. With no
route the origin is nil and the nav lanes ride as `NaN`, which is the "no Navigation" case the wrist
already drew before there was a route to draw.

`updateApplicationContext` is synchronous and latest-value-wins, so the Android pusher's write mutex
and generation counter have no peer: ordering here is already the call order.

### Live progress is native, and the path slot is its own

`NavigationController` gained `onPathChange` beside `onChange`, the same split Android has and for
the same reason #488 documented for the forecast: `onChange` belongs to the Expo module and is
re-assigned on every JS reload, and the route must survive one. It fires only when the drawn path
itself changes, so a `computing` transition over an unchanged path does not re-push a route the wrist
already has, and a failed Navigation is a `nil` path rather than an empty one — a failure has no
line. Bearing and remaining distance come from `RouteProgress`, the phone's existing navigation
truth, recomputed per GPS Fix in `vescape-core`; nothing on the live path touches JS.

`setWatchRouteSpanM` is no longer an iOS no-op: the settled phone-map viewport span rides the frame
and the wrist draws the route at the scale the rider set on the phone.

### What the rectangle changed

- **The chevron rides a rounded rectangle, not a circle.** Wear OS reads a rim point off one radius
  and an angle. A rectangle has a different distance to its edge in every direction, so `Rim.point`
  casts the bearing as a ray and takes where it leaves the shape — straight edges first, then the
  corner arc. A bearing of 90° therefore points at the right _edge_, which is where "east" actually
  is on this panel.
- **The route clips to the display, not to a circle.** Wear OS clips to the circle its gauges ring,
  because a round panel's drawing bounds are square and the line would otherwise run to the bezel.
  Here the clip is the display's own rounded rectangle one step inside the rim gauges, so the route
  uses the corners the rectangle has.
- **Motion is a shape's `animatableData`, not four `Animatable`s.** The rider offset, the course and
  the zoom interpolate together as one animatable pair rather than as three independent springs. The
  course is kept unwrapped so a heading crossing north turns the short way, which is the same rule
  `shortestAngleDelta` encodes on Android.
- **SF Symbols for the empty-nav hint.** Wear OS bundles a Phosphor map-pin drawable; the chevron and
  the pin beside the distance are drawn by hand on both wrists, so those match stroke for stroke.

Everything behavioural stays Android's: the same default and clamped route spans, the same rider drop
below centre, the same line widths and opacities at rest and in focus, the same rule that the arrow
setting hides the chevron and nothing else, the same nav-focus behaviour where the readouts leave and
the nav stack grows, and the same "No navigation / Set a destination on your phone" when the phone is
not navigating. Ambient skips the route layer for Android's reason: a moving map is the most
expensive thing an always-on panel could be asked to draw.

### Verified, 2026-09-15

- `bun run test:ios` — the route wire contract (round trip into metres, delta rounding that does not
  accumulate over 500 points, the clear as an explicit payload, a clear replacing a route inside a
  merged context, an absent channel, an unknown dictionary version, an unknown packed version, a
  truncated buffer, a `points` value of the wrong type, striding a dense route with its endpoints
  kept, and the origin of a cleared route), the distance label's rounding against Java's, and the
  Navigation seam (the path slot firing only on a real path change, a failed Navigation clearing
  rather than drawing an empty line, the mirror's opening clear, and the origin moving only once the
  route is known to be on the wrist).
- `VescapeWatch` against `watchsimulator26.5` — builds, with all three new wrist files confirmed
  present in `VescapeWatch.SwiftFileList` rather than only in a build that succeeded.

**Not verified.** Nothing here has run against a physical Apple Watch, a locked iPhone, or a live
Navigation. Not measured: a real route arriving on the wrist and surviving a watch restart, a clear
surviving a reconnect on hardware, the rider tracking the line while actually moving, the chevron's
bearing against the road ahead, the rendered layout of the nav page on either case size, and the
frame cost of the route layer. The `ios/` tree on this machine has no Pods and no workspace, so the
iPhone app itself was not compiled — the phone-side changes were compiled by the SwiftPM package
`test:ios` builds, not by an app build.

## Board lights (#489)

The board's two light switches are on the wrist, and a wrist tap is the same `setBoardLights` write
a phone tap makes.

### The command is an edit, not a state

This is the first slice to use the wrist -> phone direction (ADR-0033), and the shape of the two
payload bytes is the whole safety argument. The wrist sends `[kind, value]` with **bit0 = the target
on/off state and bit1 = which switch**, Android's numbering verbatim — deliberately not the Refloat
`LIGHTS_CONTROL` mask, where both bits are values and `0b10` would mean the opposite thing.

A command carrying both switches would let a wrist holding a slightly stale board push revert the
switch the rider never touched. So the wrist names one switch and the phone composes the pair, in
`WatchLightsRelay`, against its own `boardLights` truth — the same compose `useBoardLights` does.
Two rapid taps compose on top of each other (the second builds on the first's pending pair rather
than on the pre-edit value), and the moment the phone's own truth moves — echo, config seed, session
end, a refused write — that truth wins again and the pending pair is forgotten. A value above the
two defined bits decodes to nothing, the same "ignored" outcome an unknown kind gets.

The write itself is `BoardSessionController.setBoardLights`, unchanged: the wrist never touches the
board, and it inherits the legacy config rebase without knowing what one is.

### Pending settles from phone truth, never from the send

`sendMessageData` is fire-and-forget with no delivery guarantee, and `setBoardLights` can refuse with
nothing to say. A tap therefore flips its half optimistically at a lower alpha and fires a haptic,
and that value is cleared by exactly two things: the board's echoed state arriving on the cold
channel, or two seconds of silence. Nothing treats "the command was sent" as success, which is what
keeps a failure or a disconnection from rendering as unconfirmed success. Losing a gate mid-flight
drops the optimistic value rather than leaving it dimmed but claimed.

The gates are the phone's, repeated nowhere: `lightsControllable` is computed phone-side from
`setBoardLights`' own guards (`firmwareCommandsTrusted()` and a live session), so the wrist
duplicates no policy. It is pushed on every phase and link-integrity change as well as on every
light change, because trust moves without the lights moving. The wrist adds two of its own — a LIVE
mirror, which is what stops a persisted cold channel from offering switches over an hour-old truth,
and both switches known, because a write states the pair.

### Board state is a cold-state channel

`WatchBoard.swift` is compiled into both targets, the arrangement the frame, settings, weather and
route files already use. It rides the merged Application Context as the `board` channel through
`WatchColdState` — still the only writer. Keys are Android's `/board` `DataMap`, key for key.

Unlike the route there is no explicit-clear problem: the phone always _states_ this channel, and a
teardown push simply omits the two light keys and says `lightsControllable: false`. Absence of a key
is unknown, never off, on both wrists. `startWatchMirror` pushes the opening unknown so a wrist
reconnecting to a phone that has never connected a board finds a stated channel rather than none.

### What the rectangle changed

- **The split is the display's shape, not a circle.** Wear OS splits the circle its rim gauges ring.
  Here the two halves clip to `Rim.path` one step inside the rim, the same shape the route clips to.
- **SF Symbols, not ported artwork.** `lightbulb.fill` and `headlight.low.beam.fill` stand in for the
  Phosphor drawables Wear OS bundles.
- **The haptic is `WKInterfaceDevice.play(.click)`.** Wear OS plays `HapticFeedbackType.LongPress`;
  watchOS has no equivalent constant, and `.click` is the discrete tap confirmation the wrist offers.
  Tagged `@platform-diff` at the call site's screen.

Everything behavioural stays Android's: the same three gates, the same optimistic flip and 2 s
pending timeout, the same resting tint as the state readout with a lower alpha while unsettled, the
same order (LEDs on top, headlight below), and the same rule that a page is not interactive until
its transition has settled.

### Verified, 2026-09-15

- `bun run test:ios` — the board wire contract (round trip, unknown switches omitted rather than sent
  as false, an absent and an unreadable channel both reading unknown and not controllable, the
  channel read out of a merged context) and the relay (an edit keeping the other switch at the
  phone's value, an edit with no known lights dropped, a second edit before the echo composing on the
  first, a phone-side change replacing the pending pair, a refused write leaving no pending pair),
  plus the command wire (round trip for all four combinations, the exact Android byte values, bits
  above the two defined ones ignored, Move still decoding to nothing).
- `VescapeWatch` against `watchsimulator26.5` — builds, with both new wrist files confirmed present
  in `VescapeWatch.SwiftFileList` rather than only in a build that succeeded.

**Not verified.** Nothing here has run against a physical Apple Watch, a locked iPhone, or a real
board. Not measured: a real echo settling a pending tap and how long that round trip actually takes,
the 2 s timeout against that latency, a simultaneous phone and wrist edit on hardware, a reconnect
mid-edit, a rejected write on a board that refuses one, the haptic's feel, and the rendered layout on
either case size. The relay's behaviour under all of those is pinned by unit tests against the
phone's own truth, which is not the same as having seen it. The `ios/` tree on this machine has no
Pods and no workspace, so the iPhone app itself was not compiled — the phone-side changes were
compiled by the SwiftPM package `test:ios` builds, not by an app build.

## Board Move (#490)

A hold on the wrist and a press on the phone's Move card are the same action, reaching the same
`BoardMoveController` stream. This is the one slice that makes a motor turn from a wrist, so almost
all of it is about what happens when the wrist stops talking.

### The wrist sends a direction, and only a direction

Two bytes, `[1, direction]`, direction `-1` back / `0` stop / `1` forward — Android's numbering
verbatim, including `-1` as `0xFF`. Strength is a phone setting: `WatchMoveRelay` multiplies
`BOARD_MOVE_INPUT_MAX` by the rider's `boardMoveStrengthPercent` and hands the result to
`startBoardMove`. A wrist that could name its own input value would be a second place deciding how
hard the board pushes, and a wrist protocol is not a place to keep that decision.

Everything else the phone already owned stays where it was. The relay calls `startBoardMove` /
`stopBoardMove`, so the trusted-link check, the firmware generation's wire format and repeat cadence,
and the arbiter's refusal while a sensor is correcting all apply to a wrist press exactly as they
apply to a phone press. Nothing about Board Move's safety envelope is re-stated on the wrist.

A direction from a future wrist is clamped rather than rejected: it must never become a bigger move
than full scale, and it must never fail to be readable as a stop.

### A hold is a stream of ticks, and the dead-man is the feature

There is no press/release pair on this wire. The wrist re-states its direction every 300 ms, and the
phone stops the board after 900 ms of silence — three missed ticks, Android's numbers exactly.

Press/release alone would be unsafe for one reason: the release is the single message that must not
be lost, and it is exactly the message a dropped link eats. A lost release would leave the phone
streaming motor output indefinitely, because the firmware's own ~1 s lapse never fires while the
phone keeps talking. Ticking instead turns lost release, wrist app exit, a dead watch and a walk out
of range into one event the phone can see — ticks stopped — and one answer.

The timeout runs on the phone's own scheduler, armed when a tick is _received_. No wrist timestamp
is read anywhere in this path: the two devices have independent clock domains, and a clock the phone
does not own is not a thing to gate a motor on.

Re-issuing the hold each tick costs nothing (the controller's repeat loop is already running and
only swaps its input) and it self-heals a hold that was refused when it started — a board that
finished connecting mid-press starts rolling on the next tick instead of needing a second press.

### Stale holds cannot queue

The command rides `sendMessageData`, which drops when the phone is unreachable and never queues.
That is load-bearing, not a limitation to work around: `transferUserInfo` and the Application Context
deliver FIFO, so a reconnect would replay a backlog of stale holds and roll a board minutes after the
rider let go. A release therefore cannot get stuck behind the holds that preceded it — there is
nothing for it to be behind. Android has to build a latest-wins slot in front of its blocking Data
Layer send to get the same property for free here.

Even a hypothetical burst is bounded: each tick re-arms the same timer rather than adding one, so
fifty stale holds are still 900 ms of roll and no more. A late hold landing after a release stops the
board on arrival of the release and can only roll for one dead-man afterwards.

A board session ending cancels the relay outright, so a hold never carries into the next session.

### The press follows native button state

`MovePressStyle` observes `ButtonStyle.configuration.isPressed`, allowing the native button and
pager to arbitrate a press versus a swipe. Release clears the pressed direction; disappearance,
loss of live telemetry, leaving the active scene phase or losing page alignment also cancels the
hold. The cancellable repeat task sends a stop on exit. The phone's dead-man timeout remains the
fallback for a lost release. Move is offered only on a LIVE mirror and a settled, active page.

While a hold is active both pagers lock and the 45 s idle return is suspended: a hold must not be
read as a page swipe, and the page must not move out from under a finger that is driving a motor.

### What the rectangle changed

- **The split is the display's shape, not a circle**, clipped to `Rim.path` like Lights and the route.
- **SF Symbols `chevron.up` / `chevron.down`** stand in for Wear's triangle glyphs.
- **The haptic is `WKInterfaceDevice.play(.start)` on hold and `.stop` on release.** Wear OS plays a
  single `HapticFeedbackType.LongPress` at the start; watchOS has no equivalent constant, and the
  start/stop pair is the closest the wrist offers to "this is running now". Tagged `@platform-diff`.

### Verified, 2026-09-15

- `bun run test:ios` — 17 tests in `WatchMoveRelayTests`, all against a virtual clock with no
  wall-clock sleeps: strength scaling (including a strength that cannot exceed full scale or invert
  the direction), a release stopping exactly once and disarming the dead-man, a release before any
  hold touching nothing, silence stopping the board at the boundary and not before, ten ticks keeping
  a hold alive with one diagnostic event, two missed ticks survivable and the third not, a refused
  hold self-healing, a lost release stopping on the dead-man and staying stopped, a late hold after a
  release outliving it by no more than one dead-man, fifty stale holds still being one dead-man,
  teardown stopping an active hold, and the wire (round trip, the exact Android bytes including
  `0xFF`, a future direction clamped, a short or unknown payload decoding to nothing).
- `VescapeWatch` against `watchsimulator26.5` — builds, with `MoveScreen.swift` confirmed present in
  `VescapeWatch.SwiftFileList` rather than only in a build that succeeded.

**Not verified, and this is the slice where that matters most.** No motor has been turned by any of
this. Nothing has run against a physical Apple Watch, a paired iPhone or a real board, so none of the
following is measured: the actual wrist-to-phone-to-BLE latency of a hold, whether 300 ms ticks
survive a real degraded Bluetooth link, the dead-man against that real latency, what a genuine
out-of-range walk mid-hold does end to end, whether the pager locks hold up against a real cancelled
drag or crown scroll, and how the start/stop haptics feel under a glove. The phone-side behaviour is
pinned by deterministic fixtures against the phone's own truth, which is not the same as having seen
a board stop. The `ios/` tree on this machine has no Pods and no workspace, so the iPhone app itself
was not compiled — the phone-side changes were compiled by the SwiftPM package `test:ios` builds.
Hardware validation is slice 8's job and Move must not be trusted on a board until it happens.

## Diagnostics and leaving (#491)

The diagnostics page and lifecycle gates are implemented. #491 remains open for integrated
validation on the rider's Apple Watch Series 6 and real Board. Simulator builds and unit tests do
not establish locked-phone operation, wrist-down execution, battery use, or physical control safety.

### Implementation

`WatchDiagnosticsLog` lives in `modules/vescape-core/ios/watch/WatchDiagnostics.swift`, symlinked
into the watch target. `PhoneLink` owns it. It keeps decoded/failed frame counts and the newest 50
events in memory, resetting with the process. Decode failures log once per failure streak;
a decoded frame ends the streak. Link and wake events log only when their values change.
Radar failures and simulator replay also appear in the log. Event times use the watch's wall clock
so they can be compared with phone logs.

The page shows link state, frame age, received/applied cadence, decoded frames, decode failures,
mirrored settings, route presence, weather freshness, and Board light state. Unknown light values
remain distinct from off. Repeated decode failures can indicate incompatible phone/watch frame
layouts; inspect the byte count and lane count before attributing the failure to a build mismatch.

Cadence uses monotonic timestamps and a five-second window. Arrival is timestamped in the session
callback; application is timestamped on the main queue. Old samples expire when read, so a stopped
stream reports zero without needing another frame to arrive. These are receive/apply rates, not
measurements of actual display rendering. Measure render cadence separately on hardware.

watchOS leaves through system navigation and has no equivalent to Wear OS's back-confirmation
prompt. `MirrorScreen` reports scene-phase changes: active uses the rider's cadence, inactive uses
ambient, and background reports asleep. Asleep stops the wrist heartbeat; the iPhone's existing
reachability gate determines whether frames can be sent. Asleep does not itself select ambient
cadence in the current phone implementation.

Move requires an active scene phase. Losing it cancels the tick task and requests a stop; the
phone's 900 ms dead-man covers suspension or a lost release. Lights discards pending optimistic
edits when the active phase is lost. These are code paths, not evidence of device timing.

### Local verification, 2026-09-15

- `bun run test:ios`: passed.
- Focused `WatchDiagnosticsTests`: event ordering/cap, decode streaks, link/wake deduplication,
  leave/return events, replay identification, cadence expiry/reconnect and delayed application.
- `VescapeWatch` build against `watchsimulator26.5`: passed, including the symlinked diagnostics
  source in the watch compilation.
- Physical-watch testing: not run. The iPhone app was not rebuilt in this diagnostics handoff.

### Hardware validation checklist

Install the current branch on both devices. Record commit, watch OS version, case size and iPhone
OS in a `Device validation, <date>` section, followed by observed results for each check below.
Mark unavailable checks as not run. First confirm `frames` increases and inspect any decode failures.

1. **Locked phone, stationary:** observe wrist-up telemetry for 60 seconds. Record frame age and
   reachability. Lower the wrist for 60 seconds, then record frame age immediately on raising it.
   Use a device trace to establish whether frames continued while lowered; a fresh frame on return
   alone cannot prove background execution.
2. **Moving:** repeat the locked-phone wrist-up/down checks during a ride. Record separately from
   stationary behavior.
3. **Reconnect:** separate watch and phone for about 90 seconds, then return. Check stale/disconnected
   presentation, recovery without restarting, and timestamped link events.
4. **Recovery:** force-quit/reopen the watch app, then restart the watch. Check settings, route,
   weather and light state restore from Application Context.
5. **Leaving:** leave for the watch face for 30 seconds, then return. Inspect asleep/active events
   and phone-side sending/reachability. Record actual behavior rather than assuming ambient cadence.
6. **Weather:** verify the forecast and gauge readout. Let the phone forecast expire and verify stale
   weather disappears from rider-facing pages while diagnostics reports stale.
7. **Radar:** check animation, leave and return. Make the radar provider unavailable while keeping
   WatchConnectivity reachable. Check the failure hint and event while telemetry remains live.
   Record the network arrangement used; airplane mode may also disconnect the phone.
8. **Routes:** start, replace and clear navigation. Check replacement redraws without interpolating
   across route origins. Reopen the watch app and confirm a cleared route stays cleared.
9. **Settings:** change rider color, nav arrow and Move strength, both with the watch app open and
   closed. Confirm the latest values after reopening.
10. **Cadence:** record receive/apply Hz and separately measured render cadence for each configured
    refresh rate, awake and wrist-down. Explain any gaps.
11. **Runtime:** record starting/ending battery, elapsed ride time of at least an hour, always-on
    usage and percent consumed per hour. There is no arbitrary runtime pass threshold.

For Board controls, use a secured Board with the wheel off the ground, keep people clear, and keep
the phone and power cutoff accessible. Complete Lights before testing Move.

12. **Lights:** toggle each switch and check the physical lights and Board echo. Disconnect the phone
    and check an unechoed edit reverts within about two seconds. Check stale/disconnected gates and
    leaving the app during a pending edit.
13. **Move:** test forward/backward holds, configured strength, gauge feedback and normal release.
14. **Move interruption:** separately test dragging off the half, attempted page swipe, leaving via
    the crown, and losing phone connectivity. Check both pager locking and actual wheel stop timing;
    a moved page with an ongoing hold is a failure. Verify stale/disconnected state cannot start Move.

Record failures and remaining platform differences here and track unresolved work in #491 before
shipping. App Store preparation remains #493.
