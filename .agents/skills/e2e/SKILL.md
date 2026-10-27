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

- `bun run e2e` builds/installs through `android:e2e`, waits for its own Metro and connected app,
  then runs every public flow in `e2e/flows/`. It stops its processes afterwards.
- `bun run e2e --flow connect-board` runs one flow by name from `e2e/flows/connect-board.yaml`.
- `bun run e2e:run` reruns all flows against an already prepared E2E app and running Metro.
- `bun run e2e:run --flow connect-board` reruns one flow without build/setup.
- Both commands default to all flows; `--all` remains accepted.
- Helper flows start with `_`; they and the legacy `e2e.yaml` aggregate are excluded.
- `bun run smoke` is the separate fixture-backed run: real native, restored database, replayed
  recording, no `e2eFake`. Needs its own build (`EXPO_PUBLIC_SMOKE=1`, produced by the runner), so it
  cannot share a device install with `bun run e2e`. See `e2e/README.md`.
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

Most public flows clear app state through `_launch.yaml`. Component and tune editor checks
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
The full `bun run e2e` command performs setup every time.

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

- Device missing -> ask user to start emulator/connect device.
- App not installed/stale -> run `bun run android:e2e`.
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
