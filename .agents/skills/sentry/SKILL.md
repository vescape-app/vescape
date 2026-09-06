---
name: sentry
description: Triage this repo's Sentry issues and separate real production crashes from local dev noise. Use when the user invokes `/sentry`, asks to check Sentry, review crashes/errors in production, or wants to know what is worth fixing.
---

# Sentry Triage

Org `dxdev`, project slug `vescape` (display name "react-native"). Both Android and iOS report here.

The whole job is separating the handful of real user crashes from a much larger pile of local dev
noise. Do that first, every time. Most issues in this project are the agent's or Kacper's own
machine.

## Rules

- Never resolve an issue without checking its release tags first. "Looks fixed" is not evidence;
  "no events after the fix shipped" is.
- Never call an issue dev noise (or production) from the latest event alone. One event is one
  device. Pull the tag distribution.
- Report event counts and user counts as they are. 4 events across 3 users is not a crisis and
  should not be described as one.

## Triage Loop

1. Production only, unresolved:

```sh
sentry issue list --query "is:unresolved environment:production" --limit 30 --json \
  --fields shortId,title,count,userCount,level,lastSeen
```

2. For anything that survives, get the real distribution — not the latest event:

```sh
id=$(sentry issue view VESCAPE-XX --json | jq -r .id)
for t in environment release user device os; do
  echo "-- $t"
  sentry api "/api/0/organizations/dxdev/issues/$id/tags/$t/" | jq -r '.topValues[]? | "\(.count)\t\(.value)"'
done
```

3. Read breadcrumbs from a specific event when the stack alone is not enough:

```sh
sentry api "/api/0/projects/dxdev/vescape/events/<event-id>/" \
  | jq -r '.entries[]? | select(.type=="breadcrumbs") | .data.values[-15:][] | "\(.timestamp[11:19]) \(.category) \(.level) \(.message)"'
```

4. Resolve what the git history proves is already fixed (`sentry issue resolve VESCAPE-XX`), then
   report what is genuinely left.

## Telling Real From Noise

Two independent signals. Use both — either one alone will mislead.

**Environment.** Set from `__DEV__` in `src/config/sentry.ts` and from the Android build type /
iOS `#if DEBUG` in `plugins/withSentryNativeInit.ts`. So it tracks _build type_, not app flavor:

```
environment=development  -> debug build. Dev noise, even when the package is app.vescape.
environment=production   -> release build. Includes app.vescape.dev release builds (dogfood).
```

A default `sentry issue list` with no env filter is mostly Metro/hot-reload garbage: `undefined is
not a function`, `Property 'x' doesn't exist`, `DebugServerException`, `Cannot find native module`,
`[Worklets] Tried to synchronously call…`. Hundreds of events, always one user, usually an emulator
(`sdk_gphone*`). Ignore; do not resolve them either, they are not fixed, just irrelevant.

**Android versionCode** (`androidVersionCode` in `src/helpers/version.ts`) tells store from local:

```
0.86.0+8600        major*10000+minor*100+patch  -> local / CI build
0.86.0+100000024   explicit VERSION_CODE        -> Play store release, real users
```

Kacper dogfoods on his own devices (Warsaw / Wroclaw, Pixel 9 Pro XL), and has sideloaded release
builds. So a production-env event can still be him. Check the `user` and `device` tag spread: one
user on one device model is probably self-inflicted; several user ids across different models is
real.

## Symbolication State

Android native symbol upload was enabled 2026-08-12 (`23f2594c`, `experimental_android:
{ enableAndroidGradlePlugin: true }` in `app.config.ts`). It only takes effect on release builds
with `SENTRY_AUTH_TOKEN`.

Crashes from before that release have unnamed native frames (`?` inside `split_config.*.apk`) and
cannot be diagnosed — say so instead of speculating about the frames. React Native's own prebuilt
`.so` files ship stripped, so frames inside RN/Hermes stay unresolved regardless; only
`modules/vescape-core` code symbolicates.

Check whether upload is actually working (`debug-files` has no `list` subcommand — use the API).
iOS dSYMs (`symbolType: macho`) have been uploading for a while; Android is `elf`:

```sh
sentry api "/api/0/projects/dxdev/vescape/files/dsyms/" \
  | jq -r '.[] | "\(.symbolType)\t\(.cpuName)\t\(.objectName)"' | sort | uniq -c
```

## Known Recurring Shapes

- `ForegroundServiceDidNotStartInTimeException` on `CoreForegroundService` — a stop intent reviving
  a dead service. Guarded in `CoreForegroundService.kt` (`stopGpsMonitoring` returns early with no
  instance). If it reappears, look for a new start/stop path that skips that guard.
- `NoSuchMethodError` for an API-33 method on an API 30-32 device — D8 stripping `SDK_INT >= 33`
  guards against minSdk. Fixed by pinning `minSdkVersion: 30` in `app.config.ts`; do not raise it.
- `ApplicationNotResponding: Background ANR` via AppExitInfo — arrives with no stack. Breadcrumbs
  are the only evidence. Suspect main-thread work during activity teardown while the foreground
  service keeps the process alive.

## Seer

`sentry issue explain VESCAPE-XX` and `sentry issue plan VESCAPE-XX` exist. Treat output as a
hypothesis to check against the code, not a finding to report.
