# E2E

Maestro flows exercise the installed app like a user: tap, type, assert visible UI.

Maestro is pinned in `.maestro-version`. CI installs that version, and repository runners reject
a missing or different version before invoking Maestro. Run `bun run maestro:setup` after changing
the pin or when the version check asks for it.

## Run everything on Android

Run:

```sh
bun run e2e
```

If Maestro is missing or has a different version, the terminal offers to install the pinned CLI.
Non-interactive shells must prepare it first with `bun run maestro:setup`.

The terminal menu defaults to **All tests**. Press Enter to run native smoke, phone flows,
watch telemetry, and group rides in that order, or choose one suite. The shared device picker asks
for the phone and, when needed, a Wear emulator before any build. It can boot an existing AVD.
Suites run sequentially because they install different app modes on the same phone. A workspace
lock rejects a second `bun run e2e` while one is active.

Each suite builds the current app and prepares its state. Phone, watch, and group suites own
isolated Metro servers; group rides also own a local relay. Servers, child processes, and temporary
ADB reverse listeners are cleaned up after success, failure, or Ctrl-C. Existing development
Metro sessions and unrelated tunnels are preserved. Flows reset the selected app's data.
The summary reports passed, failed, and not-run suites; a failure stops subsequent installs.

Use flags to skip the menus, including in non-interactive shells:

```sh
bun run e2e --all --device Medium_Phone --watch WearLarge
bun run e2e --suite phone --device Medium_Phone
bun run e2e --suite smoke --flow 02-alerts-speed --device Medium_Phone
bun run e2e --flow connect-board --device Medium_Phone
bun run e2e --help
```

Without a terminal, the workflow defaults to all. An ambiguous device choice requires `--device`
or `--watch`; the runner never chooses a different device midway through the run.
`--flow` alone selects the phone suite. It cannot be combined with all, watch, or group.
All means the four Android validation suites, excluding screenshot capture, preview tours,
performance measurements, and iOS tests.

Watch and group require paired Google Play phone/Wear AVDs. Initial companion pairing can require
one manual "Pair with emulator" action, described in
[watch emulator setup](../docs/agents/watch-emulators.md). Group rides require the sibling
`../vescape-server` checkout with Bun dependencies installed, or `GROUP_RIDE_SERVER_DIR`.
Missing Maestro or server prerequisites are handled before builds.

For a fast phone rerun against an already prepared E2E app and Metro:

```sh
bun run e2e:run --device Medium_Phone
bun run e2e:run --device Medium_Phone --flow connect-board
```

`e2e:run` only runs public phone flows in `e2e/flows/*.yaml`, excluding `_` helpers and the legacy
`e2e.yaml` aggregate. It defaults to port 8081; set `E2E_METRO_PORT` to reuse another Metro.

The setup-board flow clears app state, discovers `E2E VESC Board` through `EXPO_PUBLIC_E2E=1`, reviews and saves its Direct link, names it `E2E Board`, adjusts the battery config, skips alert customization, and saves. It then connects the saved board and checks that telemetry appears.

Because this repo currently installs an Expo development build, the launch helper waits for the Expo dev-client launcher, then opens this run's Metro URL directly. The dev-client config hides the tools button, skips onboarding, and prevents the dev menu from opening at launch. Those settings are native config plugin values, so rebuild the Android app after changing them.

## Watch E2E (Wear OS)

```sh
bun run e2e:watch --device Medium_Phone
```

Use a paired phone + Wear OS emulator with Google Play services. `--device` selects the phone
AVD; `WEAR_AVD` selects the watch AVD. Without overrides the shared picker prefers running AVDs.
First-time pairing may need the Wear OS companion's "Pair with emulator" action; see
[watch emulator setup](../docs/agents/watch-emulators.md).

This runs as part of the all-tests workflow or independently. It starts its own Metro and rebuilds/installs the current phone
development app and watch app, checks the real Data Layer link, and starts the thor301 recording
on the phone. The watch launches normally, without its standalone fixture replay. No database
backup is restored and navigation is skipped, so Directions is not a prerequisite.

Android UI Automator reads the watch's displayed speed and duty through accessibility. The test
requires nonzero speed and a subsequent speed change with both readouts still live. Stale readings,
placeholders, and another app's UI do not match. UI dumps and a screenshot are saved under
`.expo/watch-e2e/<timestamp>/` on success or failure. Setup, transport, and UI failures exit nonzero.
Maestro is not used here because its Android device discovery excludes the Wear emulator. Owned Metro processes and reverse tunnels are removed afterward; installed apps remain.
Apple Watch is not covered by this command.

## Group Ride E2E, phone + Wear OS

```sh
bun run e2e:group --device Medium_Phone
```

Requires the sibling `../vescape-server` checkout with its Bun dependencies installed, Maestro,
and a paired phone + Wear OS emulator with Google Play services. Set `GROUP_RIDE_SERVER_DIR` for
another server checkout and `WEAR_AVD` for another watch AVD. The selected pair is used even when other emulators are connected. Initial pairing follows [watch emulator setup](../docs/agents/watch-emulators.md).

The command owns an isolated Metro and a local server process on temporary ports. It rebuilds
both current development apps and sets emulator GPS. Phone state is cleared before starting the
Mirror, with location, nearby-device, activity and notification permissions granted for the test. The UI
flow preserves that state and the established phone/watch connection. It mounts
the server's real Group Ride relay, protocol validation, version gate, and App Status routes using
`MemoryStore`. No database, Redis, server credentials, production rooms, JS native fake, or watch
fixture replay are used. The sibling server revision is the implementation under test.

A simulated WebSocket rider creates a nearby ride. Maestro sets the phone's rider name and joins
through Social. The peer must receive native phone GPS presence without a Board Session. The
watch's real roster must show that peer and battery. Changing the peer's presence must update
the phone board name/battery and wrist battery/distance. Leaving through Social must remove the phone
from the relay roster and remove the wrist group page.

Android UI Automator checks the Wear UI; Maestro drives the phone. Logs, the peer's protocol
transcript, phone Maestro artifacts, and watch XML/screenshots are saved under
`.expo/group-ride-e2e/<timestamp>/`. Failures exit nonzero. Owned server/Metro processes stop and their ADB reverse tunnels are removed on success or failure; installed apps remain. Already running emulators are left running. This suite is separate from smoke, regular fake
phone E2E, and `e2e:watch`. Apple Watch, BLE reception, reconnect, public auto-join and Privacy
Zone suppression are outside this flow.

## Component-library smoke

`components.yaml` opens the base, chart, and typography previews and exercises the
IconButton progress ring. It preserves app data and does not require E2E mode.
Run it against a development app already connected to Metro for the current workspace:

```sh
maestro --device emulator-5554 test -e APP_ID=app.vescape.dev e2e/flows/components.yaml
```

Confirm the device appears in Metro's `http://localhost:8081/json/list` before using
this as evidence for local changes. Run in both light and dark app appearances when
changing adaptive colors. Visible preview assertions catch render failures even when
the reconciler error is missing from logcat. This is a smoke check, not coverage of
every showcase state.

## Drawer controls regression

```sh
bun run e2e --flow edge-drawer-controls --device Medium_Phone
```

The drawer showcase has deterministic long, short, and empty pages on both edges. This flow
switches pages repeatedly while open, checks that the first row returns, scrolls with the header
and footer pinned, and exercises content dismissal, grabber dismissal, controlled close, Android
Back, backdrop close, and reopening. A small content pull must spring back; a fling from inside
the list must stop at its start before a fresh gesture can dismiss it.

Maestro captures a reference of each open drawer during the run and compares the whole modal
after returning to the same page or releasing the small pull. The 99% image match catches height,
position, and opacity changes without maintaining device-specific golden images. References and
failure diffs are saved in Maestro's run artifacts. These comparisons check restoration of the
rendered state, not animation smoothness or the correctness of the initial reference itself.

`edge-drawer-focus` also checks row 1 through ScrollView expansion and reopening, FlatList focus
on row 80 outside the initial render window, and rows arriving after opening. Emptying and
refilling the late list must restore the same rendered height and opacity.
Both flows join the regular phone suite automatically.

## Seeded live telemetry

Use the private `e2e-seed` route to put the app into a deterministic connected-board state. It
creates `E2E Board`, connects it, and starts the native fake telemetry feed. This is useful for
visual checks and rendering/performance work without manually completing the add-board flow.

The seed requires an E2E build and a Metro server:

```sh
bun run android:e2e
```

Run the helper flow to clear app state, open Metro, seed/connect the fake board, and land on the
live telemetry screen:

```sh
maestro test e2e/flows/_perf-home.yaml
```

`_perf-home.yaml` is deliberately private: helper flows start with `_` and are excluded from
`bun run e2e --all`. Its deep link is:

```text
vescape://e2e-seed?flow=connect-board
```

Do not use the deep link alone for perf baselines: it does not clear prior app state or open the
dev-client Metro server. Use `_perf-home.yaml` first.

Measure a seeded telemetry screen with the bundled harness:

```sh
bun run perf --label telemetry --seconds 20
```

The harness runs `_perf-home.yaml` by default, resets `gfxinfo`, then records frame stats and
best-effort per-thread CPU. After manually preparing the same screen, skip setup with:

```sh
bun run perf --label telemetry --seconds 20 --no-setup
```

Future board-session flows should use an E2E native simulation mode instead of mocking JS stores. Native still owns Board Session, BLE/GPS, telemetry, and durable storage. The smoke run below is
the first step of that: it boots from fixtures and a replay instead of `e2eFake`.

## Smoke

`bun run smoke` walks the screens a rider actually opens — live telemetry, custom alerts alongside persisted presets,
map modes, Ride History, Profile stats, and the add-board wizard — and asserts on them on Android
and iOS.

```sh
bun run smoke                      # picks a device, builds, runs every flow
bun run smoke --no-build           # reuse the smoke build already installed
bun run smoke --flow 03-history    # build and run one flow
bun run smoke --no-build --flow 02-alerts-speed # speed alerts against an installed smoke build
bun run smoke --device <serial>    # skip the picker
bun run smoke --platform ios       # use an iOS simulator
bun run smoke --build-only --output .expo/smoke/app.apk
bun run smoke --app .expo/smoke/app.apk --flow 03-history
```

`02-alerts-battery` selects HEV effects, previews its Warning sound, and overrides the matching Radio
voice with Nicole. It then checks battery presets: Normal and Safe expand to their
charge-percentage voice points, the battery preview completes with the selected sound settings,
Safe survives reopening, and Off disables preview. It restores battery Normal before returning
home. `02-alerts-speed` saves a custom speed Geiger rule, changes Normal → Safe → Off, and reopens
Speed to check that the custom range and Off selection survive navigation, then restores Normal.
They are separate flows because together they outlast the Android emulator job's step timeout.
This is playback and continued navigation coverage, not an assertion on audible output or every
pack/voice combination.
Each runner invocation restores fresh fixtures; this checks native writes
and screen reopening, not persistence across app restarts.

CI builds one Release artifact per platform without booting a device. Each platform's flows
then run in parallel jobs, each installing that artifact and starting a fresh fixture session.
The iOS app travels in a tar archive to preserve its bundle permissions and symlinks. Gradle's build
cache and iOS CocoaPods dependencies are separate from app artifacts. iOS caches the compiled
simulator app by native fingerprint, runner architecture, Xcode, and simulator SDK. Matching runs
use Expo repack to refresh JavaScript and assets, preserve bundle links, and ad-hoc sign the app
with its original simulator entitlements. Native sources, dependencies, plugins, shared resources,
build recipes, or native environment changes require a full build. Fingerprint failures also use
a full build without saving an app cache. Cache restores require an exact match; Xcode compiled
output is not transferred between fresh checkouts.

If repacking fails, CI warns and falls back to a full build, including CocoaPods restoration.
The full build must succeed before any app is uploaded. An existing native cache entry is immutable
and is not overwritten on fallback; repeated failures require deleting that entry in GitHub Actions.
A JavaScript export error may therefore fail twice, once during repack and again in the full build.

The workflow discovers public flow files through `bun run scripts/smoke.ts --list-flows`, so a new
flow automatically joins both platform matrices. Manual dispatch can select one flow and/or one
platform. Failed jobs retain their own Maestro diagnostics; one failure does not cancel siblings.
Each job runs boot and its selected flow in one Maestro session, so iOS starts XCTest only once.
Android smoke launches the prepared app through `adb am start -W` with a 60-second timeout, then
Maestro checks readiness. This avoids its [unbounded Android launch/permission calls](https://github.com/mobile-dev-inc/Maestro/issues/3658);
fixture reset and permission grants still happen before launch.
Boot handles the known Pixel Launcher ANR dialog on hosted Android images between bounded
telemetry waits. It does not dismiss Vescape's own ANR or weaken the telemetry assertion.
Android keeps the Pixel 6 layout in dp at a lower render resolution for the software GPU.
Smoke flows use known exit controls and bounded settling waits, then assert the destination;
continuously animated telemetry does not need to become visually idle before every tap.

It shares its boot with the screenshot capture below — Release build, restored fixture database,
Debug Recording replayed through the real telemetry pipeline — and that is the whole point.
`EXPO_PUBLIC_E2E=1` reroutes board and telemetry reads to `e2eFake` (~40 call sites in
`modules/vescape-core/src/index.ts`), so the flows in `e2e/flows/*.yaml` assert against a fake and
cannot catch a native regression. A smoke build sets `EXPO_PUBLIC_SMOKE=1` instead: nothing between
the recorded BLE chunks and the rendered gauge is faked.

Simulator boot has two CI-specific requirements. The iOS runner ad-hoc signs the built app with a
stable simulator application identifier and keychain group; an unsigned app throws OSStatus
`-34018` when reading Device Tokens. No developer certificate is needed. Android smoke builds
currently disable GWP-ASan to work around a CI crash in its unwinder during Hermes startup.
Normal and screenshot builds retain the default GWP-ASan setting. Native sync tracks the smoke
flag so switching modes regenerates the manifest. Remove this workaround once the runtime crash
is resolved; a passing smoke run does not validate GWP-ASan compatibility.

One thing stays faked, and only one. An emulator or a desk-bound phone has no board to advertise, so
BLE _discovery_ falls back to `e2eFake.scan()` — `FAKE_SCAN` in `modules/vescape-core/src/index.ts`.
That fake stands in for absent hardware; every other `E2E_ENABLED` branch stands in for absent data,
which fixtures and replay now supply.

The replay recording has to outlast the flows that need it. `replay-thor301.jsonl` is a 13-minute
ride, and a full pass can run longer than that — Maestro spends most of its time waiting for a live
view hierarchy to settle. Flows 01-04 finish inside the window; `05-add-board` is written to work
whether the session is still up or has already ended on its own.

In a local full pass, flow order is load-bearing. `05-add-board` runs last because saving a board hands it to the
connection manager, which goes at the real BLE stack, finds nothing, and takes the replay session
down with it. That flow therefore asserts the wizard and the durable write, not a connection: a
replay runs under a synthetic `replay:` board id (ADR 0024) and cannot stand in for a chosen board's
session. Binding a replay to a given board id is native work; until then the board-connect path
stays covered by the E2E suite's `connect-board`.
CI's isolated flow jobs each restore their own fixtures, so add-board cannot interrupt another
flow's replay.

Waits are on things the app renders, never on `waitForAnimationToEnd`. A live telemetry screen never
stops animating, so that command spends its whole timeout every time. `e2e/flows/fixture/_boot.yaml`
waits on `battery-bar` (only present once the session is delivering) and the map flow waits on each
mode's own exit control.

`map-settled` — the marker `MainMap` publishes from Mapbox's idle event — is _not_ used, despite
looking made for this. It never appears in Maestro's view hierarchy even with the map fully drawn,
and it has no caller anywhere in the repo, so it appears never to have worked. Fixing or deleting it
is a follow-up.

Maestro itself is the slow part of a smoke run, and it is not something the flows can tune away.
`hierarchyBasedTap` waits for the view hierarchy to stop changing before it trusts a tap, and on
these screens `accessibilityText` carries live values (`"93%, 80.0V"`), so it never does — a single
tap on the telemetry screen can cost 20-40s. That is the price of asserting against a live UI rather
than a frozen fake.

`e2e/flows/fixture/` holds what the two runs share: the boot, the return-to-home dismissal ladder
and the map reveal gesture.

## Store screenshots

`e2e/flows/screenshots/*.yaml` capture the eight store panels from the real app, driven by
`scripts/screenshots.ts`:

```sh
bun run screenshots                 # asks for platform, then device
bun run screenshots --platform ios  # skip the platform picker
```

The bare command asks for the platform first (Android / iOS / Both), then the device. "Both" is a
deliberate choice rather than the default: the runs are sequential, so a whole Android pass — build,
eight panels — happens before iOS starts.

One flow set drives both platforms. The runner passes `OUT_DIR` to Maestro
(`screenshots/android` or `screenshots/ios`), so the panel list, order and filenames are identical
and the two sets can be compared side by side. The flows never use `back`: they dismiss through the
same on-screen controls a rider taps (`weather-exit`, `legal-limits-exit`, `history-back`,
`header-back`, `map-exit`, drawer backdrops), because Android's hardware back has no iOS equivalent
for overlay view states. Anything genuinely platform-specific lives in `scripts/lib/androidCapture.ts`
and `scripts/lib/iosCapture.ts` behind the `CaptureDriver` contract, not in a second flow set.

Both runs pin the device to Wrocław old town (`CAPTURE_LOCATION`): `xcrun simctl location set` on
iOS, `adb emu geo fix` on an Android emulator. Replay does own position — the recording's GPS fixes
are replayed alongside its chunks — but the pin still decides the backdrop before the first replayed
fix lands, and without it the two sets stop being comparable at boot. A physical Android device keeps its own location — mocking it would mean
installing a provider app.

iOS captures on an **iPhone 17 Pro Max simulator** (1320x2868, the 6.9" size App Store Connect
requires; Apple downscales to the rest). A physical device is not an option — `simctl status_bar`,
which pins the clock, battery and signal for the whole run, has no device equivalent. The fixture
zip is copied straight into the simulator container
(`xcrun simctl get_app_container <udid> <bundle> data` → `Documents/`); Android pushes it to the
app's external files dir with `adb`.

A screenshot build is a **Release** build with `EXPO_PUBLIC_SCREENSHOTS=1` and `EXPO_PUBLIC_E2E`
**unset**. That distinction is load-bearing: `EXPO_PUBLIC_E2E=1` reroutes `getBoards`,
`getLiveState`, `getTelemetryHistory` and friends to `e2eFake`, while `startDebugReplay` always goes
to native — an E2E build would run a replay session the UI never sees. Screenshot mode uses the real
native module end to end, and only suppresses developer chrome (replay badge, `REC`, no-board pill,
render-rate warning).

Data comes from two existing mechanisms, no new native code:

- durable (history, boards, tunes, alerts): a backup zip at `shared/fixtures/screenshot-db.zip`,
  staged into the app's fixture dir (`src/config/fixtureSession.ts`) and restored by
  `restoreDatabase` on startup — Room on Android, GRDB on iOS, already `@parity` peers.
- live (home hero panel): `startDebugReplay` at 1x through the real telemetry pipeline.

`screenshots/` is gitignored; the fixture zip is committed. It is generated from a real backup by

```sh
bun run scripts/sanitize-db-fixture.ts <backup.zip> [--rides 2]
```

which keeps the last rides, drops diagnostics, Privacy Zones, Board Warnings, favorites and every
other board, renames the board/tunes/rider and the device MAC, then rebases every timestamp so the
newest ride reads as today. Re-run it when the dates look stale. Without the zip the run still
works, with empty history.

Fixture names travel as build-time env (`EXPO_PUBLIC_FIXTURE_REPLAY`, `EXPO_PUBLIC_FIXTURE_DB`)
rather than a manifest file the app reads. On Android `expo-file-system` sandboxes paths outside the
app's document and cache directories, so it cannot read the external files dir the runner pushes
into — only native `restoreDatabase` can, via a `ContentResolver` open.

Iterate on one panel:

```sh
bun run screenshots --panel 4
```

The device picker is the same arrow-key list as the platform one (↑/↓ or j/k, Enter, Esc to cancel):
attached devices and existing AVDs with their resolutions on Android, available simulators on iOS. It warns when the
chosen device is not the store size (1080x2400 for Play, iPhone 17 Pro Max for App Store Connect).
`--device <serial|udid|name>` skips the picker and needs an explicit `--platform`.

It builds the screenshot build every run by default, because the installed package id alone cannot
distinguish one from an ordinary dev install and capturing against the wrong build produces a run
that goes nowhere. Pass `--no-build` to reuse what is installed once you have a screenshot build on
the device.

Other flags: `--replay <name>` (default `replay-thor301`), `--platform android|ios|both` (default `both`).

Replay warmup covers the first six minutes up front: it plays at 30× against a clock shifted that
far into the past, which fills the live window instead of compressing the samples into a fraction of
it (ADR 0024). The replay recording must be at least as long as the whole run, warmup included,
since it spends recording too.

## App preview videos

`bun run preview` records a Release fixture build with the platform recorder, then exports H.264
MP4 footage for a landing page or promo. It reuses screenshot device preparation and the sanitized
history database. `EXPO_PUBLIC_PREVIEW=1` selects dark appearance and fast-forwards the first eight
minutes off-camera through the same native replay warmup used by screenshots. The map opens on the
later western stretch with an established trail and filled charts, then plays recorded BLE/GPS at 1×.
Normal rider controls, including REC, remain visible.

```sh
bun run preview --platform ios --device 'iPhone 17 Pro Max'
bun run preview --platform android --device Medium_Phone
bun run preview --platform ios --scene ride --no-build
```

The default `tour` scene holds the live ride for 30 seconds, then visits history and two ride details
with readable pauses. `--scene ride` captures a minute of the moving dashboard for a landing-page
hero. `--scene store` captures a shorter tour for the App Store. `--platform both` runs iOS
then Android; omit the platform to pick. `--replay <name>` changes the recording baked into the
build. `--no-build` requires a preview build from the current workspace, not a screenshot, smoke,
development or production app.

Two standalone scenes cover landing-page feature sections:

```sh
bun run preview --platform ios --scene history --no-build
bun run preview --platform ios --scene board-alerts --no-build
```

`history` browses the ride overview and detail, toggles duty cycle and motor temperature, pinches the
charts, scrubs telemetry, opens full-screen graphs, and saves a named Favorite. `board-alerts`
changes speed and duty alert presets, expands the live telemetry strip, scrolls through its metrics,
and opens the live IMU dial and charts. These scenes use `bunx agent-device@0.21.23` for native input,
including real two-finger pinch gestures that Maestro cannot express. Platform recording and fixture
preparation are shared with the other scenes. Device automation startup remains outside the footage,
and the owned automation session closes after each take.

The runner sets native device appearance to dark before launch and restores it after the take.

For `tour`, `ride`, and `store`, Maestro starts/stops recording through a temporary host-local
callback after app setup. XCTest
startup and fixture restore stay outside the footage. Android also settles the emulator replay
backlog and map tiles before recording. Dwell callbacks keep screens readable without
waiting for continuously changing telemetry to become idle. Android enables touch indicators and
restores the prior setting on exit. Both platforms retain normal animation speed.

Outputs live under gitignored `previews/<platform>/<scene>/` with unique names. iOS retains the raw
MOV. The `store` scene additionally exports the full take at 886×1920, 30 fps, H.264 and checks
the 15–30 second App Store range, keeping footage for editing if the take is outside it. It never truncates or
accelerates the narrative to make it fit. Both platforms export a smaller silent 720-pixel-wide web MP4 with fast-start metadata.
Android retains its original full-resolution MP4. The iOS App Store export has a silent stereo AAC
track; the raw MOV has no audio. The Android recorder has a 180-second cap; Play promo delivery requires a
YouTube URL rather than uploading this file. Music, titles, cuts and publishing are separate work.

Requires `maestro`, `ffmpeg` and `ffprobe`, plus `adb` for Android or Xcode's `simctl` for iOS.
