# Watch Mirror

The Watch Mirror has native wrist implementations under `watch/wearos/` and `watch/watchos/`.
The phone owns Board state, Navigation and location history. The wrist renders received state,
sends rider commands and reports its wake level.

## Ownership

Three modules separate phone coordination, incoming wrist state and map presentation:

- `WatchMirrorCoordinator` in `modules/vescape-core` owns the Watch Frame and Group Ride Frame
  ticks, wake/cadence policy and source subscriptions. Android scopes it to the core service;
  iOS scopes it to the process. `BoardSessionController` supplies Board snapshots and retains
  the existing command actions and safety checks. Ending a Board Session does not end Navigation
  or Group Ride delivery.
  While the wrist takes frames and Navigation has a drawable route, the coordinator reports
  `navigating`, a GPS demand input (`docs/connectionState.md`): the wrist route is drawn around the
  Rider's live position, so it keeps fixes flowing from a pocket without a Board or Group Ride.
- `WatchMirrorIntake` on the wrist decodes and applies streamed frames and retained state. It
  owns receipt times, freshness and replacement/clearing rules. Live transport and fixture replay
  enter through the same intake; the UI adapters publish its individual channels. Transport,
  diagnostics and rider commands stay outside this state module.
- `WatchMapScene` owns the Watch Map's camera target, shared motion, route-loading notices,
  layer ordering and visibility settings. The gauge layout supplies its gauge/readout content
  without deciding how map layers behave. Paths remain below gauges and offscreen Rider marks
  remain above them. `WatchMapSceneState` holds the decisions that can be tested without drawing.

Tests exercise coordination with a controlled clock and transport, intake with encoded message
sequences, and map decisions with combinations of Navigation, Group Ride, ambient and settings.
Replay passes fixture data through the phone encoders and the production wrist decoders before
rendering. It checks application behavior; physical radio delivery and wrist-down runtime still
require hardware verification.

Wear's shared native sources are listed once in `plugins/wearSharedSources.ts`. The config plugin
copies them into their package directories and native-sync fingerprints that same list, so changing
an encoder regenerates the copied watch source. watchOS reuses Swift sources through symlinks.

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
- Emulators only: the watch's `dumpsys activity service WearableService` logs `/telemetry` inbound but
  the wrist never logs `first frame received` (typical after a phone emulator restart). Restart Play
  services on both: `adb -s <serial> shell am force-stop com.google.android.gms`, for each emulator.
  `bun run android:up` does this on its own when no frame arrives.

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

`bun run android:up` boots the phone and Wear emulators, pairs them, installs both apps and waits until
the wrist logs a received frame, restarting Play services if the Data Layer is stuck. Steps, failure
messages and wrist checks are in `docs/agents/watch-emulators.md`.

The two dev modes below are gated by `DevGate` — a debuggable build on an emulator, never a real watch or a release
build — and both are entered explicitly, so an ordinary emulator launch still mirrors its paired
phone like hardware.

Fixture replay feeds a recorded ride into `TelemetryState` on the same path a phone push takes, so
the visuals can be worked on without a board, a phone, or a ride:

```bash
bun run wear:replay
```

Replay draws the street map with no phone, network or token. The synthetic route starts at the
`replay-thor301.jsonl` recording's first GPS fix (`origin` in `watch-route.json`), and the fixtures
ship 17 z16 tiles of the published dark style (about 400 KB, `watch-map-tiles/`, listed in
`watch-map-tiles.json`): every tile within 300 m of a replayed rider position. z16 is what
`watchMapTileZoom` picks for the fixtures' 400 m span at that latitude. Tiles enter `MapTileState`
like phone tile items. `bun run wear:fixtures` downloads only missing tiles, with
`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` from `.env.local`, and deletes tiles no longer listed.

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

### Ride end to end

`bun run wear:ride` takes the phone and Wear emulators to a real watch ride: the
`replay-thor301.jsonl` Debug Recording replaying on the phone, and **normal** Navigation, so the
route reaches the wrist on the same path a rider's does. Use it to check Watch Mirror map work
without a board, a phone or a watch.

Keep Metro running. `--device <AVD>` picks the phone AVD.

The command then:

1. Runs `android:up`: both emulators booted and paired, the phone dev build on Metro, the watch app in
   its normal mirror mode (no fixture replay on the wrist), and frames proven on the wrist.
2. Sends the dev-only link
   `vescape://dev/watch-ride?replay=replay-thor301.jsonl&lat=51.13185&lon=16.98653`.
3. The phone starts the replay, waits for the first replayed fix, and only then sets the Direction
   Point (the recording's last fix). The replay owns position once it starts (ADR 0024); a Direction
   Point set earlier would be planned from the emulator's default location. Native runs the Mapbox
   Directions request and pushes `/route` to the wrist. No path is injected.

It succeeds once the phone logs `[watch-ride] … running`, which the command prints. A link that lands
before the app is listening is dropped, so it is resent until the phone logs `[watch-ride] … received`,
and never after: a second link would restart the replay. The route arrives when Directions
answers, a second or two later. Check it with `adb -s <watch> exec-out screencap -p > watch.png`.

The ride loops around a pond that Directions never plans, so the replay leaves the route in places. The
same run therefore also checks off-route behavior: Route Progress, rerouting and what the wrist draws
off the route. The recording lasts about 13 minutes and then ends like a disconnect; running the
command again restarts it. The Direction Point stays set until it is cleared on the phone.

The link is handled by `src/app/dev/watch-ride.tsx` and only in a development (`__DEV__`) JS bundle.
A release build opens the main screen and does nothing else, which is the same rule `DevGate` applies
on the wrist.

## Rider position and recent trail

The map page always shows the Rider's position ring, including without Navigation or a Group Ride.
Settings → Watch → **Trail on telemetry screen** is enabled by default. Turning it off hides the
trail behind the telemetry gauges; the map page still shows it. The preference persists on the phone
and syncs to both watch platforms.

The telemetry screen keeps the ring while any of its map layers is on: trail, Group Ride (**Group
Ride on telemetry screen**), the Navigation route line (**Route line on telemetry screen**) or the
street map (**Map behind gauges** above Off, with **Street map** on). With all four off the gauges are
clean and the ring fades in with nav focus like the trail
(`riderAlpha` in `WatchMapSceneState`, both wrists). The map page never shows a placeholder: with
nothing else to draw it still has the ring, and usually the trail and street map.

The recent ridden trail uses the same native precise GPS history as the phone's
live map. Its 3-point stroke fades from transparent at the oldest end to 60% opacity at the
newest end, measured along the full retained path. The lower peak than the phone's 85% distinguishes
the trail from the planned route. It uses the Rider's colour or the phone dark-map
violet by default. There is no watch-only distance cutoff or shortened fade. At a close zoom the
old, transparent end may be offscreen, just as on the phone. It shares the route/group map's heading
and zoom. Route and trail also share one 300 ms position animation, driven by an absolute GPS
anchor in the same frame. It works without Navigation and survives route-origin changes and
history trimming. The trail tip stays pinned to the Rider while the newest segment grows.
Overlapping stroke joins composite once, avoiding bright dotted joins. The ring sits above
paths and other Riders. Ambient continues to skip the map.

The phone sends a complete trail snapshot with each Watch Frame, capped at 120 evenly sampled
points with both endpoints retained. Points are metres east/north of the current Rider, independent
of the route origin. Route changes cannot move or reset the trail, and a reconnect receives current
history rather than starting a watch-local recording. Empty history clears the trail. Approximate
fixes can move the Rider but do not enter the precise history or extend its line.

The fixed 13-lane telemetry header is unchanged. A trailer follows it: ASCII `TR`, version `2`,
unsigned point count, Float64 Rider latitude/longitude, then Float32 east/north pairs, all
little-endian. Two NaNs mean no GPS anchor. Older wrists ignore the trailer;
new wrists show no trail for absent, unknown, malformed, or non-finite trail data and keep decoding
telemetry. This adds at most 980 bytes per frame and stores nothing on the watch.

Both replay commands accept `--no-telemetry-trail` to verify the disabled telemetry setting while
the map page retains its trail.

Emulator replay derives the trail from earlier fixture positions. Simulated GPS continues beyond
the destination, so ending Navigation does not erase the trail. Add `--ez navigation false` to the
Wear launch intent to verify the standalone or group-only map; watchOS replay accepts
`--no-navigation`. Both replay commands accept `--wander` for smooth seeded detours up to 35 m on
each axis, rejoining the recorded path every two minutes. The simulated position, heading, and
trail move together while the planned route stays fixed. Replays use the same seed on both watch
platforms for repeatable screenshots. For example:

```bash
bun run wear:replay ride --wander --group --device emulator-5554
bun run wear:replay ride --wander --no-navigation --device emulator-5554
bun run watchos:replay --wander --group
```

These switches remain inside the existing emulator/simulator replay gates.

## Street map

A dark raster street map sits under the trail and route whenever the wrist is awake and the phone
has a GPS fix, with or without Navigation or a Group Ride. The phone owns every decision; the wrist
never reports what it holds (ADR-0019, ADR-0033).

**Zoom** (`watchMapTileZoom` / `WatchMapTile.zoom`, shared with both wrists): the span the wrist draws (`routeSpanM`
clamped by `WatchMapSpan` / `WatchMapProjection.clampedSpanM`, 600 m while the phone map is
unmounted) on a 480 px reference face, at the lowest zoom whose 512 px tile is drawn at most 1.3×
its size. A held level survives until the span moves 1.15× past its boundary. In Wrocław 600 m is
z15.

**Wanted tiles** (`WatchMapTilePlan.kt` / `.swift`, pure and tested on both platforms): first a
ring of one span around the rider, the face they are looking at, then a ring of one span around a
centre ahead of the rider along their course, by the larger of half a span or 30 s at GPS speed.
Each ring is nearest the rider first, at the zoom and one zoom out, and the one-out ring (about 4
tiles, which cover the face on their own scaled up) goes first. At speed the ahead ring can clear
the rider's own tiles; the ring around the rider keeps them planned first. Tiles from earlier steps at those
zooms stay on the list, then the level the last zoom change left, all within one cap of 200 tiles;
past that the least recently needed go first, behind the rider before ahead. The left level goes
with the next zoom change.
With a Navigation route, the tiles along it ahead of the rider follow the rings: from their Route
Progress point to the end, at the zoom, every tile within half a span of the path (the face around
the rider anywhere on it), nearest along the path first (`watchMapRouteTiles` /
`WatchMapTilePlan.routeTiles`). They go before the earlier steps' tiles and the left level and share
the same cap. They go out only while the tile gate holds (wrist awake, see **Sending**), so a route
tile reaches the wrist before the rider does as long as the watch was awake with phone signal
earlier on the route; nothing is sent while the wrist is dimmed or asleep. A route tile leaves as soon as the route stops listing it:
passed without entering the ring, rerouted or cleared (`WatchMapRouteProgress` from
`WatchRouteMirror.mapRoute` and Route Progress).
`WatchMapTilePlanner` re-plans only on a new rider tile, a new zoom, a turn over 45°, a new route, or
progress entering a new tile. Extra tile sources join through `retainWatchMapTiles(needed = …)` in
priority order.

Zooming in, the old level becomes the one-out level; zooming out, the new level was the one-out
level and the old one stays as the left level. Either way the wrist already holds tiles that cover
the face, so a phone zoom never blanks the watch map.

**Sending** (`WatchMapTileSender`): only while the coordinator's tile gate holds (the rider has
**Street map** on, the wrist reports `ACTIVE`, not ambient or asleep, and there is a fix). Tiles come from the shared `MapTiles` cache
(ride thumbnails use the same files) and go out unchanged, nearest first, at most 4 in flight. A
failed download or send waits 30 s. On every wake the sender re-reads what the wrist holds. On Wear
OS a tile whose drop (item delete) is still queued is not sent again until the delete has run, so the
delete cannot remove the new copy. On watchOS each list carries a generation (phone wall-clock ms,
kept increasing) and each tile file the generation of the list it went out under; the phone only
sends a tile its current list names. The wrist deletes a received file at once when its latest list
is at least that generation and leaves the tile out, and keeps it otherwise until that list arrives.
A transfer whose tile a later list left out does not count as delivered when it lands. A transfer
an earlier phone process left queued counts as delivered until it fails; then the tile waits out the
30 s retry like a failed send.

|                      | Wear OS                                                                                 | watchOS                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tile bytes           | one Data Layer item per tile, `/map-tile/<style>/<z>/<x>/<y>`, JPEG as an Asset, urgent | `transferFile` with `{style, z, x, y, generation}` metadata                                                                                   |
| What the wrist keeps | the set of those items; the phone deletes an item to drop a tile                        | `mapTiles` list (`{style, tiles, generation}`) in the Application Context, merged by `WatchColdState`                                         |
| What is delivered    | `getDataItems` under `/map-tile`; items of another style are deleted                    | finished transfers recorded in `WCSession.watchDirectoryURL`, wiped with a reinstall or unpair, plus transfers an earlier process left queued |

**Wrist**: `MapTileLayer` picks its own level from the eased span with the same `watchMapTileZoom`
/ `WatchMapTile.zoom` and hysteresis. For each cell of that level over the face it draws the cell's
tile, else the matching quarter of the one-zoom-out tile scaled up, else the one-zoom-in tiles a
zoom-out left, else the background (`WatchMapTileCache.frame`, tested on both platforms). A tile
counts once it is decoded, so the old level stays on screen while the new one decodes. Only each
cell's best held level is decoded (its own tile, else the one-out tile, else the one-in tiles); a
fallback is drawn only if it is already decoded. It places each tile's corners with `WatchMapPosition` as metres from the
rider and draws it as one image with the trail's span, course and position motion. Layers, bottom
up: background, street map, route and trail, Group Ride marks, gauges. The map follows nav focus
from the rider's **Map behind gauges** opacity behind the gauges to 100% on the map page
(`mapAlpha`), and ambient draws none. At most 12
cells are drawn. Tiles decode off the main thread (RGB_565 on Wear OS) into a cache of 12 that
never evicts what the last frame drew or waits on, so a decode cannot evict itself when the face
already pins 12 tiles after a zoom-out. A tile that fails to read or decode is retried after 10 s.

**Setting**: Settings → Watch → **Street map**, on by default, travels to both wrists as
`streetMapEnabled` on the settings channel. Off, the tile gate closes the same way a sleeping wrist
does: sending pauses, no tile is dropped (no Data Layer item deleted, no shrunk `mapTiles` list), and
the wrist skips `MapTileLayer` (`drawStreetMap`). Route, trail and Group Ride marks stay. Turning it
back on resends only tiles the wrist does not already hold.

Settings → Watch → **Map behind gauges**, shown only while Street map is on: the street map's
opacity behind the gauges, Off / 30 / 45 / 60 / 75 / 90 %, default 60 %. Off (0 %) hides the street
map on the telemetry screen only; it fades in with nav focus to 100 % on the map page, and tiles keep
flowing. It is stored and sent as an
integer percent (`wearMapGaugesPercent`, `mapGaugesPercent` on the settings channel);
`WatchMapGauges.percent` (`WatchMapTile.kt` / `.swift`) snaps anything off those steps to the
default in phone persistence and on both wrists. The map page stays at 100 %, and the setting does
not change which tiles are sent.

## Phone → Watch Channels

Channels are split by how often the data changes:

| Path            | Transport            | Cadence                       | Payload                                       |
| --------------- | -------------------- | ----------------------------- | --------------------------------------------- |
| `/telemetry`    | `MessageClient`      | every watch tick              | Watch Frame: packed Float32 lanes, positional |
| `/group-ride`   | `MessageClient`      | 1 Hz while joined             | Group Ride Frame: versioned binary            |
| `/route-status` | `MessageClient`      | route actions and watch ticks | phase and route fingerprint                   |
| `/route`        | Data Layer item      | per route change              | encoded polyline, versioned binary            |
| `/settings`     | Data Layer `DataMap` | per settings change           | rider settings, key-value                     |
| `/map-tile/…`   | Data Layer item      | per planned street-map tile   | 512 px JPEG as an Asset, one item per tile    |

`MessageClient` drops undelivered sends, which is right for a frame that is stale in 250 ms and wrong
for cold state — hence the Data Layer for the other two, where the last value stays on the watch
across a disconnect and is read again on every watch app start.

Route actions immediately publish `/route-status`; live watch ticks repeat it after a dropped
message or reconnect. The wrist shows an animated ring around the rider position while Directions runs, until it
decodes the expected polyline, or while GPS placement is missing. Loading has no visible text.
A failed request or rejected route write shows **Route unavailable**. Clearing navigation ends the
loader even if an older request is still running. Gauges remain visible; ambient suppresses the
spinner. A disconnected telemetry stream clears the transient status.

The route fingerprint is a nonzero uint32 FNV-1a of the encoded `/route` bytes, including the origin.
A cached previous route cannot satisfy a newer route's loader. A successful Data Layer write only
queues synchronization; the wrist checks its own decoded polyline before replacing the loader with
the map. Route Progress is recalculated from the latest phone GPS Fix when a path is published,
so a stationary rider does not need another location update to see navigation.

Settings → Watch → **Route line on telemetry screen**, on by default, travels to both wrists as
`telemetryRouteEnabled`. Off, the telemetry screen draws no route line; it fades in with nav focus on
the map page (`routeAlpha`, like the trail's `trailAlpha`). The nav chevron and distance readout stay,
since they are gauges rather than a map layer, and the phone keeps pushing `/route` either way.

Preview the receiving state with `bun run wear:replay ride --route-loading`. This is an emulator
fixture using the live rendering state, not a measurement of Bluetooth transfer latency.

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
Group Ride text. Settings → Watch → **Group Ride on telemetry screen**, on by default, travels to
both wrists as `telemetryGroupEnabled`. Off, the telemetry screen draws no dots or edge triangles;
they fade in with nav focus on the map page (`groupAlpha`, like the trail's `trailAlpha`), and the
Group Ride page is unchanged. The phone keeps pushing the Group Ride Frame either way. The phone pushes it only while the Rider is joined and the wrist reports `ACTIVE` — never in
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
5. Persist the app key on the phone: `AppSettings` (`TelemetryEntities.kt`) and `AppDataRepository`
   on both platforms (read, write validation, default). On iOS also read it in the settings reload in
   `IOSWatchMirror.swift`, and decode it in Swift `WatchSettings`.
6. JS: the `AppSettings` field in `modules/vescape-core/src/index.ts` with `@parity`, the settings
   store defaults and their test fixture, the e2e fake, and the row in `src/app/settings/watch.tsx`.
7. Wrist drawing: watchOS passes it `MirrorScreen` → `FrameLayout` → `WatchMapScene`; Wear OS reads
   `SettingsState`. A rule about what the map draws belongs in `WatchMapSceneState`, tested on both.

Rider Units travels on this channel as `unitSystem`, defaulting to metric for missing or invalid
values. Both wrists convert speed, navigation, radar, and accessibility readouts while frame values,
route geometry, and gauge proportions stay metric.

The rider colour is another of these: pick a colour on the phone and the wrist route, chevron and
rider dot follow it. The watchOS Mirror carries the same bag on its own channel — see
`docs/watchos.md` for how the two transports differ.
