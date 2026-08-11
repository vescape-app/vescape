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
zsh -lc 'bun run e2e --all'
```

- `bun run e2e --all` runs every public flow in `e2e/flows/`.
- `bun run e2e --flow connect-board` runs one flow by name from `e2e/flows/connect-board.yaml`.
- `bun run e2e` opens a simple interactive selector.
- Helper flows start with `_` and are hidden from the selector.
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
zsh -lc 'bun run e2e --all'
```

3. On failure, rerun only the smallest needed command. Do not run full `check`.

## App State

Public flows clear app state themselves through `_launch.yaml`.

The expected installed app is Expo dev-client package `app.vescape`. Flow selects local Metro server from the dev-client launcher, then exercises add-board happy path.

Expected fake BLE board:

```txt
E2E VESC Board
```

Expected created board:

```txt
E2E Board
```

## Rebuild Only When Needed

Do not rebuild by default. Reuse installed app.

Run this only when app is missing/stale, native code/config changed, or E2E mode was not installed:

```sh
zsh -lc 'bun run android:e2e'
```

Then rerun:

```sh
zsh -lc 'bun run e2e'
```

E2E mode comes from `EXPO_PUBLIC_E2E=1` in `android:e2e`; it surfaces fake BLE scan data. JS-only UI changes usually do not need reinstall if Metro serves current bundle.

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
