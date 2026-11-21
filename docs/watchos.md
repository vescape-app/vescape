# watchOS Mirror

watchOS-specific constraints, platform differences from Wear OS, build/simulator workflows, and open physical-device verification items. Shared Watch Mirror behavior (ownership, trail, street map, channels, Ride Notices, complications) lives in [watch-mirror.md](./watch-mirror.md).

## Unverified on physical hardware (open)

The watchOS Mirror is implemented and unit/simulator-tested, but key runtime behaviors remain unverified on a physical Apple Watch (target test device: Series 6) with a locked iPhone and real Board (#491):

- **Always-On / wrist-down execution:** Apple's Always On display can keep an inactive app visible without letting it run or receive frames. `isLuminanceReduced` cannot be forced on the simulator; wrist-down cadence and background execution (with/without active Navigation, moving vs stationary) require a real device trace.
- **Street map `transferFile` delivery:** The simulator's `wcd` never delivers the file payload to the watch (`failed to find transfer`). Real-device delivery, reinstall/unpair recovery, and layer frame cost are unverified.
- **Board Move & Lights hardware safety:** No real motor has been driven from watchOS. Wrist→phone→BLE latency, 300 ms dead-man ticks over degraded Bluetooth, out-of-range stop timing, cancelled drags/crown scroll during a hold, Lights echo latency / 2 s revert, and glove haptics must be validated on a secured Board (wheel off ground) before trusting Move on hardware.
- **Battery & complication budget:** Real ride battery drain, `WCSession` complication wake budget exhaustion, and closed-app complication freshness are unmeasured.

### Hardware validation checklist (#491)

Record commit, watchOS version, case size, and iOS version with observed results for:

1. Locked phone stationary & moving (60 s wrist-up, 60 s wrist-down; verify frame age with a device trace, not just a fresh frame on raise).
2. Reconnect (~90 s separation), force-quit/reopen, and watch restart (verify Application Context restores settings, route, weather, lights).
3. Leaving to watch face (30 s) and return (`asleep`/`active` diagnostics events).
4. Weather staleness (3 h expiry) and Radar offline failure hint without disrupting telemetry.
5. Navigation start/replace/clear and Settings changes while watch app is closed.
6. Cadence (receive/apply Hz vs measured render cadence across refresh rates) and ≥1 h ride battery consumption.
7. Secured Board (wheel off ground): Lights toggle + disconnect revert, then Move forward/backward holds + interruption tests (drag off, swipe, crown exit, link loss).

## Build & project setup traps

Durable source lives in `watch/watchos/` (peer of `watch/wearos/`). Pure shared logic (`WatchFrame`, `WatchGauge`, `WatchSettings`, `WatchCommand`, `WatchWeather`, `WatchDiagnostics`, `GroupRideFrame`, `RideNoticeFrame`, etc.) lives in `modules/vescape-core/ios/watch/` and is symlinked into `watch/watchos/` so `bun run test:ios` tests it and phone/wrist codecs cannot drift.

- **Single `@bacons/apple-targets` registration:** `app.config.ts` registers it once with `match: '{targets/*,watch/watchos}'`. Listing the plugin twice fails prebuild (`Cannot add mod to "ios.xcodeProjectBeta2"`).
- **`patches/@bacons%2Fapple-targets@4.0.7.patch` is load-bearing:** Upstream derives the `expo:targets` root from whichever target it processes first, which silently compiles a watch app with zero sources when targets sit under two roots (`targets/*` and `watch/watchos`). Verify watch edits appear in `VescapeWatch.SwiftFileList`.
- **Build with `-target VescapeWatch`, never `-scheme`:** `-sdk watchsimulator` applies to every target in a scheme and fails on the iOS-only `ActivityKit` Live Activity widget.
- **watchOS platform runtime required for iPhone builds:** `xcodebuild -downloadPlatform watchOS` must be installed on the Mac; otherwise Xcode refuses the iPhone scheme (`bun run ios`) because it embeds `VescapeWatch.app`.
- **Deployment target:** `WATCHOS_DEPLOYMENT_TARGET=10.0` (`arm64_32` + `arm64` for Series 6); bundle id appends `.watchkitapp` to the phone app id.

## Platform differences from Wear OS

Behavioral contracts and data shapes stay in `@parity` with Wear OS; visual and OS-API differences are intentional:

- **Rectangular `RimGauge`:** `watch/watchos/RimGauge.swift` anchors gauge spans to actual edge and corner lengths (`Rim.Metrics`) rather than fixed perimeter fractions so 40 mm and 44 mm layouts agree. Gauge strokes inset by half the thickest stroke (2 pt for 4 pt) to avoid clipping straight edges.
- **No wall clock or close prompt:** watchOS draws the system clock and owns the Digital Crown press. Vertical paging uses `.verticalPage` (Digital Crown + swipe).
- **Ambient:** `isLuminanceReduced` is a single bit; watchOS handles low-bit and burn-in protection itself (no Wear OS pixel walk).
- **No `wearAutoLaunchOnConnect`:** iOS has no public API for a phone app to launch its watch companion without starting a HealthKit workout session (ruled out). The setting is shown disabled on iOS with an explanation. Persisted setting keys keep their `wear*` prefix to avoid needless migrations.
- **Transport & cold state (`WatchColdState`):**
  - Live Watch Frames, Group Ride Frames, and rider commands (`Move`, `Tilt`, `Lights`, `dismissNotice`) use `WCSession.sendMessageData` / `sendMessage` — immediate delivery that drops when unreachable so stale Move holds never queue. No Wear-style wake gate or capability probe is needed because `WCSession.isReachable` gates live pushes and the watch app is embedded in the phone bundle.
  - Cold state (`settings`, `route`, `weather`, `lights`, `rideNotices`, `mapTiles`, `lastBattery`) shares one `updateApplicationContext` dictionary. **`WatchColdState` must remain the sole writer** (read-modify-write preserving other keys; writing a channel directly silently wipes the route and other channels). It tracks desired vs delivered payloads to retry writes that raced `activationDidCompleteWith`.
    The application context delivers the latest value. `transferUserInfo` would replay each queued update after reconnect. Send explicit clears, including an empty route on startup, because an absent key cannot tell the wrist to discard retained state.
  - Street-map tiles ride `transferFile` with `{style, z, x, y, generation}` metadata. `PhoneLink` moves each received file on the delegate queue into `Application Support/map-tiles/<style>/<z>/<x>/<y>-<receipt>.jpg` before the callback returns (system deletes the temp file on return). The phone tracks finished transfers in `WCSession.watchDirectoryURL` (wiped on reinstall/unpair).
  - Radar imagery is fetched directly by the watch (keyed on `task(id: radarVisible)` for automatic cancellation on page leave / wrist-down), centred on the phone's pushed forecast location.
- **Rounding:** `WatchGauge` explicitly rounds HALF_UP (away from zero) to match Java `String.format`; C `printf` rounds half-to-even.
- **Move haptics:** Uses `WKInterfaceDevice.play(.start)` on hold and `.stop` on release (`@platform-diff` vs Wear OS single `LongPress`).

## Paging & gesture traps

- **Keep `.ignoresSafeArea()` aligned across pager and gauges:** If `FrameLayout` ignores safe areas while the pager uses safe-area bounds, swipes outside the safe area silently fail.
- **Control interaction settling:** Requires page alignment plus 100 ms with no geometry change. Keep `Color.clear` on the gauges page when weather is absent so the horizontal slot stays full-size.
- **Move & Tilt gestures:** Move observes `ButtonStyle.configuration.isPressed` (avoid competing zero-distance drag recognizers) and locks both pagers plus the 45 s idle return while held. On the Tilt page, SwiftUI's `DragGesture` claims all touches including sideways ones, so a sideways drag manually offsets the control pager and snaps on release or `@GestureState` cancellation.
- **Unfinished iOS parity in `BoardSessionController` (`TODO(ios parity)`):** Check navigation/route-placement lanes and live `max_duty` exclusion parity with Android before claiming complete Watch Frame parity.

## Simulator workflows

```bash
# Build & replay fixtures on watch simulator (reads Wear OS JSONL + weather + map tiles directly from repo)
bun run watchos:build
bun run watchos:replay                 # add --group, --wander, --no-navigation, --no-telemetry-trail
WATCHOS_UDID=<uuid> bun run watchos:replay

# End-to-end ride against a paired, booted iPhone + Apple Watch simulator (Metro running)
xcrun simctl pair <watch-udid> <phone-udid>   # once, both shut down
xcrun simctl boot <phone-udid> && xcrun simctl boot <watch-udid>
bun run watchos:ride                          # replays thor301 on phone + real Directions -> watch
```

Battery complication previews (Debug only): launch `VescapeWatch` with `--battery-preview` or `--battery-fixture` (`healthy | warning | stale | unknown`).
