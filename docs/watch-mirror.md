# Watch Mirror

The Watch Mirror is a Wear OS companion app under `watch/wearos/`. The phone app owns the Board
Session and pushes Watch Frames from native code; the watch only renders received frames.

## Google Play Release

Phone and Wear builds are separate signed AABs under the existing `app.vescape` Play listing:

```text
:app:bundleRelease    -> phone internal -> phone open testing
:wearos:bundleRelease -> wear:internal  -> wear open testing
```

Both use the existing Android upload key. `APP_VERSION` supplies the shared package version name.
CI allocates monotonic, disjoint phone and Wear version codes for every internal build and records
them, with the immutable source SHA and artifact hashes, in the release manifest.

`bun run release` first offers explicit Major, Minor, and Patch release-candidate preparation. It
updates `package.json`, runs canonical note authoring, commits the version and accepted notes on `dev`,
merges `dev` into `main`, fast-forwards `dev` to the release merge, and atomically pushes both branches.
The resulting shared commit is the immutable source offered to the Internal build. The CLI also offers
internal-build, Internal status/resume, open-promotion, and production actions.
Status/resume discovers recent GitHub workflow runs, then shows the live job, step, elapsed time, and
estimated remaining range; it does not depend on terminal-local state. Open promotion selects one
successful internal manifest and promotes the manifest's exact existing codes. Canonical rider-facing
notes are bundled per marketing version from `release-notes/<major>.<minor>.<patch>.md`; internal
builds and open promotion tolerate a missing file for the current version. Open promotion never rebuilds or uploads an AAB.
Track IDs come from the `PLAY_PHONE_INTERNAL_TRACK`, `PLAY_PHONE_OPEN_TRACK`,
`PLAY_WEAR_INTERNAL_TRACK`, and `PLAY_WEAR_OPEN_TRACK` repository variables. Production targets use
`PLAY_PHONE_PRODUCTION_TRACK` and `PLAY_WEAR_PRODUCTION_TRACK`. Defaults are `internal`, `beta`,
`production`, `wear:internal`, `wear:beta`, and `wear:production`.

Workflow dispatches use the repository's trusted default-branch definition while keeping the immutable
artifact source SHA separate. Before mutation, the workflow verifies both requested codes against Play. A code may
be on its internal source track or already on its open target track: this makes a retry converge after
phone-only or Wear-only success. Promotion then runs phone and Wear serially and publishes a
per-form-factor result (`promoted`, `already-open`, or `failed`). It does not touch production tracks,
tags, GitHub Releases, `main`, or `dev`.

Production is a separate, explicitly confirmed `Promote Open → Production` action. Candidate discovery
uses successful open-promotion manifests, so phone and Wear identity stays pinned to the same source SHA
and exact version codes from build through production. A trusted workflow rechecks that source against
`main`, verifies its `package.json` version and canonical release notes, then checks both live open tracks
before making any production change. It promotes existing Play artifacts only; no build, signing, or AAB
upload occurs.

The initial production rollout percentage is explicit. Status, halt, resume, and percentage advancement
all target the selected exact phone and Wear codes and share the non-cancelling `play-publish` concurrency
boundary. Retries converge when only one form factor or Play itself succeeded. Advancement cannot reduce
the current percentage.

After both Play production operations succeed, the workflow creates an immutable `v<version>` tag at the
artifact source SHA and creates the GitHub Release from `release-notes/<version>.md` verbatim. An existing
tag must already point to that SHA; an existing GitHub Release is reused. Historical `production-*` tags
stay untouched, but no current workflow triggers from them and no release command mutates `dev` or
`main`. The `production` GitHub environment is the human approval boundary for live rollout changes.

The internal workflow retains both artifacts even when a Play upload fails:

```text
android/app/build/outputs/bundle/release/app-release.aab
android/wearos/build/outputs/bundle/release/wearos-release.aab
```

One-time Play Console setup remains human-owned:

1. Add the Wear OS form factor to the existing app.
2. Upload an accurate watch screenshot. Capture from the physical watch with
   `adb -s <watch-serial> exec-out screencap -p > wear-screenshot.png`.
3. Enable the dedicated Wear OS testing and production tracks.
4. Upload the first Wear AAB manually if Console requires it while enabling the form factor.
5. Opt into Wear OS review.

Protect the GitHub `production` environment with required reviewers before the first live release.
The production workflow deliberately targets that environment, so a CLI confirmation alone cannot bypass
the final human approval gate.

After CI publishes a test build, install both phone and watch apps from Play on the paired physical
devices. Launch the Watch Mirror, connect a Board on the phone, and confirm live telemetry reaches
the watch. This validates Play signing and Data Layer delivery together; local debug installs do not.

## Local Install

Pair/connect the watch with wireless ADB, then install the Wear app directly:

```bash
cd android
./gradlew :wearos:assembleDebug
adb -s <watch-serial> install -r wearos/build/outputs/apk/debug/wearos-debug.apk
adb -s <watch-serial> shell am start -n app.vescape/app.vescape.wear.MainActivity
```

Install the current phone app separately to the phone:

```bash
cd android
./gradlew :app:assembleDebug
adb -s <phone-serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

When multiple ADB devices are connected, avoid `:app:installDebug` because Gradle may pick the watch
transport. Use explicit `adb -s <phone-serial> install ...`.

## Signing Must Match

Wear Data Layer delivery requires the phone and watch packages to have the same package name and
signing certificate. Both are `app.vescape`, but debug builds can still diverge:

- Phone debug APK is signed with `android/app/debug.keystore`.
- Wear debug APK may be signed with the user's global `~/.android/debug.keystore`.

When certs differ, watch logs show:

```text
WearableService: Mismatched certificate
WearableService: Failed to deliver message ... action=/telemetry
```

Fix by signing the Wear APK with the same debug keystore as the phone:

```bash
cp android/wearos/build/outputs/apk/debug/wearos-debug.apk /tmp/wearos-debug-phone-cert.apk
zipalign -f -p 4 /tmp/wearos-debug-phone-cert.apk /tmp/wearos-debug-phone-cert-aligned.apk
apksigner sign \
  --ks android/app/debug.keystore \
  --ks-key-alias androiddebugkey \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out /tmp/wearos-debug-phone-cert-signed.apk \
  /tmp/wearos-debug-phone-cert-aligned.apk
adb -s <watch-serial> uninstall app.vescape
adb -s <watch-serial> install /tmp/wearos-debug-phone-cert-signed.apk
```

Verify signatures if needed:

```bash
adb -s <phone-serial> shell dumpsys package app.vescape | rg 'signatures='
adb -s <watch-serial> shell dumpsys package app.vescape | rg 'signatures='
```

The signature ids must match.

## Presence And Frames

The phone only pushes frames when `WatchMirrorPresence.present` is true. Production uses the Wear
capability declared by the watch app. On local debug installs, `CapabilityClient` may report false even
when the watch app is installed and open. Debug builds can fall back to any reachable Wear node so local
testing is not blocked by capability propagation.

Useful phone log:

```bash
adb -s <phone-serial> logcat -s VescSession
```

Good local-debug output:

```text
Watch mirror debug node fallback: true nodes=1
Watch mirror presence initial: true capability=false
```

If the watch says `DISCONNECTED`, distinguish the cause:

- No `Watch mirror presence initial: true` on phone: the phone is not pushing frames.
- `Mismatched certificate` on watch: frames are pushed but rejected before app delivery.
- No board telemetry on phone: no Board Session, so there is no Watch Frame source.

The watch switches to `DISCONNECTED` when no Watch Frame arrives for about three watch ticks.

## Always-On (Ambient)

Ambient is not a separate screen. `FrameLayout` draws the same arcs in the same places with an
`AmbientMode` (`watch/wearos/.../Ambient.kt`), so waking the wrist is a state change on a live tree
rather than a swap between two layouts — the pagers stay mounted, parked on the gauges with their
gestures off, and the idle clock never restarts.

Colour says how current a reading is:

| Lane                      | Ambient                                        |
| ------------------------- | ---------------------------------------------- |
| Battery, motor/ctrl temps | `AmbientText` — exact at the tick              |
| Speed, duty               | `DimText` — last reading, may be a tick behind |
| Clock, forecast, nav      | shown, dimmed                                  |
| Route lanes (`NavRoute`)  | skipped — it animates its zoom                 |
| Any lane, stream stopped  | dash, empty arc                                |

Ambient draws flat strokes only: no gradient wedges, since the fills are lit pixels. The panel flags
come from the ambient callback, never assumed — `deviceHasLowBitAmbient` switches readouts to pure
white, and `burnInProtectionRequired` walks the centre content around a small square once a minute.

The wrist repaints every `AMBIENT_REFRESH_INTERVAL_MS` (10 s), matched to the phone's 5 s ambient
push (`WATCH_FRAME_AMBIENT_INTERVAL_MS`, linked by `@parity`). A slower tick saves no radio wake and
only ages what is on screen.

## Dev Modes On The Emulator

Both are gated by `DevGate` — a debuggable build on an emulator, never a real watch or a release
build — and both are entered explicitly, so an ordinary emulator launch still mirrors its paired
phone like hardware.

Fixture replay feeds a recorded ride into `TelemetryState` on the same path a phone push takes, so
the visuals can be worked on without a board, a phone, or a ride:

```bash
bun run wear:replay
```

Forced ambient renders the always-on layout without power-cycling the screen between screenshots:

```bash
adb -s <serial> shell am start -S -n app.vescape.dev/app.vescape.wear.MainActivity --es replay ride --ez ambient true
```

`-S` because a running activity keeps the intent it was started with. `--es replay sweep` walks every
lane's full range instead of replaying the ride. `bun run wear:replay ride --group` (`--ez group true`)
also joins the replay to a Group Ride: `watch-group-ride.json` is fed into `GroupRideState` at 1 Hz, a
cast covering in-range dots, far triangles, stale, battery and heat levels, no Board, and more than
five rows. Without `--group` the not-joined layout replays. Add `--ez lowBit true` or `--ez burnIn true` to
render for those panels. Screenshot with `adb -s <serial> exec-out screencap -p > shot.png`.

The emulator renders ambient at full brightness with normal colour, so it answers layout questions
only. Readability belongs to a physical watch, entered the real way: enable Settings → Display →
Always-on screen, then `adb shell input keyevent 26`.

## Phone → Watch Channels

Three channels, split by how often the data changes:

| Path          | Transport            | Cadence             | Payload                                       |
| ------------- | -------------------- | ------------------- | --------------------------------------------- |
| `/telemetry`  | `MessageClient`      | every watch tick    | Watch Frame: packed Float32 lanes, positional |
| `/group-ride` | `MessageClient`      | 1 Hz while joined   | Group Ride Frame: versioned binary            |
| `/route`      | Data Layer item      | per route change    | encoded polyline, versioned binary            |
| `/settings`   | Data Layer `DataMap` | per settings change | rider settings, key-value                     |

`MessageClient` drops undelivered sends, which is right for a frame that is stale in 250 ms and wrong
for cold state — hence the Data Layer for the other two, where the last value stays on the watch
across a disconnect and is read again on every watch app start.

`/group-ride` carries the Group Ride Frame (ADR-0039): the Rider's course, the phone map's span, and
each other Rider's id, name, colour, stale flag, east/north offset from the Rider's latest GPS Fix,
battery % (none without a Board Session), battery level and heat level. The phone derives both
levels (normal, warning, critical) from the app's telemetry thresholds in
`telemetry/TelemetryThresholds.kt` / `.swift`, the native mirror of `telemetryThresholds.ts`: battery
warns below 30% and is critical below 10%; heat is the worse of motor and controller temperature,
warning above 70 °C and critical above 80 °C. The wrist never classifies. Its marks project with the
same eased zoom and course as the route (`WatchMapView`, one per frame layout), so a Rider on the
route stays on it through a zoom or a turn; without Navigation the Group Ride's own span and course
drive that map view. In nav focus it labels
every live Rider's mark with their distance ("680m"),
followed by a thermometer when they run hot, else their battery % when it is low. Labels are
placed nearest Rider first and never overlap the nav distance readout, each other or another Rider's
mark: a crowded label flips to the dot's other side or moves up to one label height (along the edge
for a triangle), and one with no clear spot is dropped — the list page has it. The gauges carry no
Group Ride text. The phone pushes it only while the Rider is joined and the wrist reports `ACTIVE` — never in
ambient, and never to a wrist too old to report its wake level. The wrist drops the group after
3.5 s without a frame. The codec is one file, `watch/GroupRideFrame.kt`, compiled by the phone and
copied into the Wear module by `withWearMirror` along with the `TelemetryLevel` wire enum it carries (`telemetry/TelemetryLevel.kt`; watchOS symlinks
the Swift peer); the thresholds stay phone-only. watchOS gets the same bytes under the
`groupRide` key of a `sendMessage`. Rider records are length-prefixed, so a new field is appended
without a version bump; the version byte moves only for a change older wrists must not read. The
battery and level bytes were appended this way: an older wrist skips them, and a record from an
older phone decodes as no battery and normal levels.

While the wrist holds a Group Ride, the vertical axis gains a last page one swipe below nav focus:
the Group Ride page. Title "Group · N", then every other Rider nearest first — colour dot, name cut
to five characters, an arrow to their bearing off the Rider's course, distance, and one status slot:
"lost" when stale, else a thermometer in the heat level's colour when hot, else "—" without a Board,
else battery % (orange or red at its level). Alone it reads "Waiting for riders". Five rows fit;
past that the list scrolls under a fixed five-row window: a vertical drag moves it with the finger
and flings, settling on a whole row, and the crown steps it a row at a time, sliding the rows. A pull
down that begins at the list's top pages back to nav focus; a flick back up the list stops at its
top. While the list fits, every swipe stays the pager's. A position indicator on the
right shows where the window sits: a thin arc just below 3 o'clock on Wear OS, a short bar just
below the right edge's midpoint on watchOS, both clear of the duty head tick. The map, route, nav readout and Group Ride marks
fade out as the page arrives. The group dropping while the page is shown lands the rider on nav
focus. Not joined, the axis is exactly radar, weather, gauges, nav focus.

`/settings` is a `DataMap` rather than a packed frame because settings accrete one at a time: an
unknown key is ignored by an older watch, and a key an older phone never sends leaves the watch on
its own default. That is what makes it the place to put the next mirrored setting, and why it needs
no version byte the way `/route` and the Watch Frame do.

Adding a mirrored setting:

1. Field on `WatchSettings` + key constant, both sides (`modules/vescape-core/.../watch/WatchSettings.kt`
   and `watch/wearos/.../WatchSettings.kt`, linked by `@parity`).
2. Map it in `AppSettings.toWatchSettings()`; put it in `WatchSettingsPusher`.
3. Decode it in wrist `WatchSettings.decode`, called by `MainActivity.readSettings`.
4. Add its app settings key to `WATCH_SOURCE_SETTING_KEYS` (iOS: `watchSourceSettingKeys`). A JS
   write to any key in that set reloads native settings and republishes to the wrist, even when no
   service or Board Session exists; `WatchSettingsTest` fails when a mirrored field has no key there.
   Native process startup also republishes saved settings.

Rider Units travels on this channel as `unitSystem`, defaulting to metric for missing or invalid
values. Both wrists convert speed, navigation, radar, and accessibility readouts while frame values,
route geometry, and gauge proportions stay metric.

The rider colour is another of these: pick a colour on the phone and the wrist route, chevron and
rider dot follow it. The watchOS Mirror carries the same bag on its own channel — see
`docs/watchos.md` for how the two transports differ.
