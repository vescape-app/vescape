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

## Phone → Watch Channels

Three channels, split by how often the data changes:

| Path         | Transport            | Cadence             | Payload                                       |
| ------------ | -------------------- | ------------------- | --------------------------------------------- |
| `/telemetry` | `MessageClient`      | every watch tick    | Watch Frame: packed Float32 lanes, positional |
| `/route`     | Data Layer item      | per route change    | encoded polyline, versioned binary            |
| `/settings`  | Data Layer `DataMap` | per settings change | rider settings, key-value                     |

`MessageClient` drops undelivered sends, which is right for a frame that is stale in 250 ms and wrong
for cold state — hence the Data Layer for the other two, where the last value stays on the watch
across a disconnect and is read again on every watch app start.

`/settings` is a `DataMap` rather than a packed frame because settings accrete one at a time: an
unknown key is ignored by an older watch, and a key an older phone never sends leaves the watch on
its own default. That is what makes it the place to put the next mirrored setting, and why it needs
no version byte the way `/route` and the Watch Frame do.

Adding a mirrored setting:

1. Field on `WatchSettings` + key constant, both sides (`modules/vescape-core/.../watch/WatchSettings.kt`
   and `watch/wearos/.../WatchSettings.kt`, linked by `@parity`).
2. Map it in `AppSettings.toWatchSettings()`; put it in `WatchSettingsPusher`.
3. Read it in `MainActivity.readSettings`.
4. If the setting is written from JS, add its key to the `updateSetting` reload list in
   `VescapeCoreModule.kt` — the pusher runs off applied settings, so without that the watch only sees
   the change at the next service start.

The rider colour is the first of these: pick a colour on the phone and the wrist route, chevron and
rider dot follow it. The Wear Mirror is Android-only, so none of this has an iOS peer.
