<img width="3190" height="1690" alt="image" src="https://github.com/user-attachments/assets/4bb49f5a-b0d5-4afd-87dc-861cdcdd6d30" />

# Vescape

Mobile telemetry proof of concept for VESC-based boards over BLE.

The app scans for nearby VESC BLE devices, starts an Android native session,
connects over the Nordic UART Service, discovers the motor controller on CAN,
and polls Refloat telemetry for live riding, electrical, and thermal values.

## Supported Hardware

- Floatwheel ADV2
- Floatwheel Pint V
- Thor 301 controller
- Tronic 250R controller

These are the boards and controllers we have tested on. It should work with most
VESC-based controllers running Refloat.

Current development targets Android. iOS has a native module stub only.

## Features

- Fast live telemetry (up to ~35 Hz)
- Fast connect and reconnect
- Multiple saved boards
- Ride history recordings with map routes, photos, and videos
- Ride alerts: TTS spoken messages and Geiger-style audio alerts
- Battery state-of-charge with charging detection
- Smart BMS readout with per-cell display
- Weather and rain radar
- Refloat tune profiles (read, edit, sync)

## Stack

- Expo SDK 56
- React Native 0.85
- Expo Router
- TypeScript
- Zustand
- Reanimated + React Native Skia (gauges, charts)
- `phosphor-react-native` icons
- Styling via `StyleSheet` + design tokens in `src/constants/theme.ts` (no NativeWind/Tailwind)
- Bun
- Custom Expo native module for BLE: `modules/vescape-core`

## How It Works

```text
React Native UI                 Companion device / auto-connect provider
  -> vescape-core JS session API      -> (wakes service without JS)
        \                        /
         -> Android foreground service
              -> BLE / Nordic UART Service
              -> VESC BLE bridge
              -> CAN bus
              -> VESC motor controller
```

The Android foreground service owns the long-running board session. It owns
connection, polling, packet parsing, and notification updates, keeping
telemetry off JS timers and the React Native bridge. React Native renders state
and sends intents, but it is not required for a session to run.

The session can start without the JS layer alive at all:

- A `CompanionDeviceService` lets Android wake the app and connect when the
  paired board comes into BLE range, even with the app process dead.
- A `ContentProvider` runs at process start (before React Native) to
  auto-connect the selected board.

So the board can connect and stream in the background, and the UI attaches to an
already-running session when it opens.

## Project Layout

```text
src/app/                     Expo Router routes only (no logic)
src/modules/<feature>/       Domain modules (board, battery, tune, map, history, alerts,
                             weather, group-ride, settings, diagnostics, profile, legal) —
                             each colocates its lib/ store/ hooks/ components/ constants/
src/components/              Domain-less UI kit (base, forms, charts, controls, widgets, ...)
src/screens/main/            Main screen composition (map/, overlays/, history/)
src/hooks/                   Generic React hooks (no domain imports)
src/bootstrap/               App-root wiring (native -> JS data sync)
src/constants/theme.ts       Design tokens (single source of color/typography)
shared/                      Pure JS shared with native (copied in via copy:shared)
modules/vescape-core/            Custom Expo native BLE/session module
modules/vescape-core/android/    Kotlin: Expo bridge, foreground service, polling, protocol
modules/vescape-core/ios/        Swift module stub (iOS not yet functional)
docs/                        Protocol, architecture, ADRs, and agent notes
CONTEXT.md                   Shared domain language
```

## Development

Install dependencies:

```bash
bun install
```

Start Expo:

```bash
bun run start
```

Run on Android:

```bash
bun run android
```

Build, test, or install the Wear OS companion on a connected watch:

```bash
bun run wear:build
bun run wear:test
bun run wear
```

Run tests (JS via Bun + native Kotlin unit tests):

```bash
bun run test
```

JS tests only:

```bash
bun run test:bun
```

Native Kotlin unit tests only:

```bash
bun run test:android
```

Type-check:

```bash
bun run ts
```

Compile only the Android native BLE module:

```bash
cd android
./gradlew :vescape-core:compileDebugKotlin
```

Build the full Android debug app:

```bash
cd android
./gradlew assembleDebug
```

## Agent Skills

Project-local skills under `.claude/skills/` are slash commands you type in Claude Code. They chain together into a plan-to-PR pipeline, but each works standalone too.

### Planning

- `/grill-me` — Stress-test your idea before writing code. Asks pointed questions one at a time until the plan is solid. Good when scope is fuzzy.
- `/grill-with-docs` — Same as `/grill-me` but cross-checks answers against project docs (`CONTEXT.md`, ADRs, glossary) and updates them as decisions land.
- `/to-prd` — Turn a conversation into a PRD issue on GitHub. Use after grilling or when you already know what to build.

### Breaking down work

- `/to-issues <prd>` — Break a PRD or plan into small, independently-grabbable GitHub issues. Each issue is a vertical slice (thin end-to-end, not one layer at a time).

### Implementation

- `/to-code <issue>` — Pick up one issue and implement it locally. Reads project docs, writes code, runs tests, reports what changed. No git operations — your working tree stays uncommitted.
- `/pr` — Take whatever changes are in your working tree, create a branch, commit, push, and open a PR. Works without an issue — just describe what you did. Attaches a device screenshot if UI files changed and a phone is connected.
- `/to-pr <issue>` — End-to-end: implements the issue (via `/to-code`) then ships it (via `/pr`). Groups related issues into one feature PR automatically.

### Typical flow

```text
/grill-me            # sharpen the idea (optional)
/to-prd              # idea -> PRD issue on GitHub
/to-issues <prd>     # PRD -> N implementation issues
/to-pr <id>          # implement issue + open/update feature PR
```

Or skip issues entirely:

```text
# just make changes and ship
/pr "Add dark mode support"
```

PR base is always `dev` (`main` is reserved for production releases).

## Documentation

- [Architecture](docs/architecture.md)
- [Domain language](CONTEXT.md)
- [Architecture Decision Records](docs/adr/)
- [VESC protocol](docs/vescProtocol.md)
- [Refloat GET_ALLDATA layout](docs/refloatAlldata.md)
- [Android BLE notes](docs/bleAndroid.md)
- [Tune](docs/tune.md)
- [Alerts](docs/alerts.md)
- [Ride history](docs/history.md)
- [Connection state](docs/connectionState.md)
- [Releases](docs/release.md)

## License

Copyright (C) 2026 Kacper Kozak

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [LICENSE](LICENSE) for details.
