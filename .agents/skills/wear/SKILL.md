---
name: wear
description: Build, sign, install, launch, and smoke-check local Wear OS app on Kacper's OnePlus Watch 3.
---

# Wear

Use when user says `/wear`, asks update watch app, build/push Wear changes, install to watch, or debug local Wear install.

Caveman style. Short. Command facts.

## Commands

`scripts/wear.ts` owns the whole flow. Do not hand-roll gradle/zipalign/apksigner/adb steps.

```bash
bun run wear:build     # native sync + :wearos:assembleDebug
bun run wear:test      # native sync + :wearos:testDebugUnitTest
bun run wear           # build + sign with phone cert + install + launch + smoke check
```

Each command runs `native:sync android` first, so `watch/wearos` edits reach `android/wearos` via
prebuild (`withWearMirror`). No manual `rm -rf android/wearos && cp -R`.

## Rules

- Durable Wear source: `watch/wearos`.
- Generated native target: `android/wearos`. Gitignored. Do not make lasting edits there.
- Use Gradle for native Android builds. Package manager rules still: no `npm`, `yarn`, `pnpm`, `npx`.
- `wear` picks the watch by `ro.build.characteristics=watch`, not a remembered transport id.
- Several watches (real + emulator) -> arrow-key picker, last pick on top, auto-taken after 3s
  unless a key is pressed. No TTY -> pass
  `--device <serial|model>`, e.g. `bun run wear --device sdk_gwear_arm64`. Same flag on
  `wear:replay`. mDNS duplicates of one watch collapse by `ro.serialno`, never prompt.
- Do not uninstall unless install says `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (the script handles that case itself) or user asks.

## Known Devices

- Watch: OnePlus Watch 3 / `OPWWE231`.
- Phone package and watch package match, including the Expo profile suffix: dev prebuild installs
  `app.vescape.dev`, store build is `app.vescape`. Both can sit on the watch at once, two icons.
- Watch activity class is always `app.vescape.wear.MainActivity`, so the component is
  `<applicationId>/app.vescape.wear.MainActivity`. `wear` reads the applicationId back from the
  generated `android/wearos/build.gradle` — do not hardcode `app.vescape`.
- Watch often appears twice via mDNS. Script collapses the duplicate by `ro.serialno`.

## Why the re-sign

Data Layer needs same package + same cert on phone and watch. Gradle signs the watch APK with its own
debug key, so `wear` re-signs with the phone debug cert (`android/app/debug.keystore`).

Cert mismatch shows up in watch logs as:

```text
WearableService: Mismatched certificate
WearableService: Failed to deliver message ... action=/telemetry
```

## Smoke Check

`wear` already fails on a fresh crash in the watch log. For the ongoing notification:

```bash
adb -s <watch-serial> shell dumpsys notification --noredact | rg -i "app.vescape|vescape_watch_mirror|Telemetry mirror active|numOngoing" -n -C 2
```

Expected: install success, launch success, ongoing notification exists, no fresh crash.

## Debug Disconnect

Phone must see board telemetry. Phone pushes watch frames only when watch presence true.

Phone logs:

```bash
adb -s <phone-serial> logcat -s VescSession
```

Good:

```text
Watch mirror debug node fallback: true nodes=1
Watch mirror presence initial: true capability=false
```

Watch `DISCONNECTED` causes:

- phone not pushing frames -> presence false
- cert mismatch -> `Mismatched certificate`
- no board session -> no telemetry source
- watch slept/paused -> reconnect should happen fast
