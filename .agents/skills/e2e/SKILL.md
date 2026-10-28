---
name: e2e
description: Run and debug this repo's Maestro E2E tests. Use when user invokes `/e2e`, asks to run E2E tests, mentions Maestro flows, or wants Android end-to-end validation.
---

# E2E

Fast loop for local Android Maestro flows. Goal: agents can run E2E often without rebuilding or dumping giant logs.

## Defaults

- Use `bun` for repo scripts.
- Default command:

```sh
zsh -lc 'bun run e2e'
```

- `bun run e2e` opens the shared workflow picker. Enter selects all: native smoke → phone flows →
  watch telemetry → group ride, sequentially on one selected phone and Wear pair.
- Non-interactive runs default to all. Use `--all --device <phone AVD> --watch <Wear AVD>` to skip
  prompts, or `--suite phone|smoke|watch|group` to select one workflow.
- `bun run e2e --flow connect-board` selects one fake-board phone flow.
- Watch/group require paired Google Play AVDs. Group requires sibling `../vescape-server` with deps,
  or `GROUP_RIDE_SERVER_DIR`. Initial Wear companion pairing may need manual interaction.
- Each workflow prepares the current build. Dev suites own Metro; group also owns a local relay.
  Shared teardown stops owned processes and removes temporary reverse listeners on success,
  failure, and cancellation. Existing Metro and unrelated tunnels stay intact.
- `bun run e2e:run --device <phone>` reruns public fake-board phone flows against an already prepared
  E2E build and Metro. `--flow <name>` narrows that rerun. It does not run smoke, watch, or group.
- Phone helpers start with `_`; they and the legacy `e2e.yaml` aggregate are excluded.
- `bun run smoke` remains the standalone fixture-backed native suite. It restores the database and
  replays a recording without `e2eFake`; its Release build differs from the phone E2E dev build.
- `bun run e2e:watch` owns its Metro, rebuilds both apps, and checks changing live wrist telemetry.
- See `bun run e2e --help` and `e2e/README.md` for flags, prerequisites, and suite boundaries.
- Keep project code clean: do not patch `package.json` or source files to solve local tool/env problems.

## Fast Loop

1. Check a device exists only if state unknown:

```sh
adb devices
```

2. Run E2E:

```sh
zsh -lc 'bun run e2e'
```

3. On failure, rerun only the smallest needed command. Do not run full `check`.

## App State

Most public phone flows clear app state through `_launch.yaml`. Component and tune editor checks
reuse the app already opened by setup.

The package comes from `src/config/appVariant.ts` (`app.vescape.dev` for development). The launch helper waits for the dev-client launcher, then opens the intended Metro URL directly.

Expected fake BLE board:

```txt
E2E VESC Board
```

Expected created board:

```txt
E2E Board
```

## Rebuild Only When Needed

For a fast rerun, reuse the installed E2E app and an E2E Metro server with `bun run e2e:run`.
The full `bun run e2e` command prepares each selected workflow every time.

Run this only when app is missing/stale, native code/config changed, or E2E mode was not installed:

```sh
zsh -lc 'bun run android:e2e'
```

Keep that Metro running, then rerun in another terminal:

```sh
zsh -lc 'bun run e2e:run'
```

E2E mode comes from `EXPO_PUBLIC_E2E=1` in `android:e2e`; it surfaces fake BLE scan data. JS-only UI changes usually do not need reinstall if Metro serves the current bundle.
`e2e:run` defaults to Metro port 8081; set `E2E_METRO_PORT` to reuse another port.

## Efficient Failure Triage

- Device missing -> use the shared picker to boot an available AVD, or connect a phone.
- App not installed/stale -> rerun `bun run e2e --suite phone` for phone setup, or the affected suite.
- Dev-client server screen stuck -> confirm Metro/app run state; last good step matters.
- Fake board missing -> app likely not in E2E mode or wrong build installed.
- Assertion failure -> report failed assertion, last completed Maestro step, screenshot path if Maestro provides one.
- Tool/env missing -> fix shell/agent env outside repo; do not change project code.

## Agent Reporting

Report compactly:

```txt
E2E: pass|fail
Command: zsh -lc 'bun run e2e'
Last step: <last completed Maestro step>
Failure: <one-line exact blocker/assertion>
Next: <smallest action>
```

Include only key logs: failing line, last 5-10 Maestro steps, screenshot/video path if present.
