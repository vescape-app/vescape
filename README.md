<img width="3190" height="1690" alt="image" src="https://github.com/user-attachments/assets/4bb49f5a-b0d5-4afd-87dc-861cdcdd6d30" />

# Vescape

An open-source ride companion for VESC-based boards. See what your board is doing,
hear the signals that matter, and keep a record of the ride. Built by riders, out
in the open.

[Website](https://vescape.app) ·
[Google Play](https://play.google.com/store/apps/details?id=app.vescape) ·
[iOS beta on TestFlight](https://testflight.apple.com/join/DUn2GHAd)

## Features

- **Live telemetry.** Speed, duty cycle, battery, voltage, current, and temperatures,
  with live gauges and graphs to see how your board responds.
- **Audible alerts.** Set your own Alert Rules. Geiger-style beeps pick up as you
  approach a duty-cycle or speed limit, and spoken updates keep you informed
  without another glance at the screen.
- **Ride Recording and Ride History.** Save routes and telemetry while you ride.
  Revisit your stats, photos, and videos, or dig into the signals to understand
  what happened on the board.
- **Group Rides.** Create or join a ride, find your crew on the map, share live
  telemetry, and choose the next spot together. Your position is shared while
  you're in the Group Ride.
- **Maps and weather.** Find Map Points, check the forecast and rain radar, and
  use privacy zones to control location sharing.
- **Battery detail.** Follow charge state and charging detection, with per-cell
  readings on compatible smart BMS hardware.
- **Refloat tuning.** Read, edit, save, and sync Tune Profiles from the app.
- **Your boards, ready to ride.** Save multiple boards, reconnect over Bluetooth,
  and inspect board and connection diagnostics when something feels off.

A Vescape Account is optional. Local board, recording, history, and tuning
features work offline. Online features such as Group Rides need a connection.

## Supported hardware

Tested boards and controllers:

- Floatwheel ADV2
- Floatwheel Pint V
- Thor 301 controller
- Tronic 250R controller

Vescape targets VESC-based boards running Refloat. Compatibility and available
readings depend on the controller, firmware, BLE hardware, and BMS.

Android and iOS have native implementations. Android is the more road-tested
platform; iOS is available in beta.

## Stack

- Expo SDK 57, React Native 0.86, and Expo Router
- TypeScript and Zustand
- Reanimated and React Native Skia for gauges and charts
- Mapbox maps
- Kotlin and Swift in the custom `vescape-core` Expo module
- Native Wear OS and watchOS Watch Mirror implementations
- Bun for dependencies, scripts, and JS tests

## Architecture

Native code owns the board connection, telemetry, recording, alerts, and durable
storage. React Native renders state and sends intents. Long-running board work
doesn't depend on JS timers or an open screen.

Android uses a foreground service, with companion-device wake-up and auto-connect.
iOS has a peer Swift implementation, including background recording and Live
Activity support. Native contracts are linked by `@parity` tags so changes stay
aligned across platforms.

See [Architecture](docs/architecture.md), [Connection state](docs/connectionState.md),
and [iOS](docs/ios.md) for the details.

## Project layout

```text
src/app/                    Thin Expo Router routes
src/modules/<feature>/      Domain code, state, hooks, and components
src/components/             Shared UI primitives
src/screens/                Multi-module screen composition
src/bootstrap/              App-root native-to-JS wiring
src/helpers/                Shared pure utilities
src/constants/theme.ts      Design tokens
modules/vescape-core/        Native core, with Android and iOS peer implementations
watch/                      Wear OS and watchOS companions
targets/ride-activity/       iOS Live Activity extension
shared/                     Shared inputs copied into native builds
docs/                       Architecture, feature contracts, and contributor guides
```

## Development

Use the Bun version pinned in `package.json` under `packageManager` or a newer stable version.
Installation and Git hooks reject older versions; CI uses the exact pin. To install that version on
macOS or Linux:

```bash
expected_bun=$(bun -p 'require("./package.json").packageManager.slice(4)')
curl -fsSL https://bun.com/install | bash -s "bun-v$expected_bun"
```

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

Run on iOS (connected device):

```bash
bun run ios
```

Build, test, or install the Wear OS companion on a connected watch:

```bash
bun run wear:build
bun run wear:test
bun run wear
```

Phone + watch emulators: boot both AVDs, pair them, install both apps and wait for live frames on
the wrist (needs Metro running; see [docs/agents/watch-emulators.md](docs/agents/watch-emulators.md)):

```bash
bun run android:up
```

Run tests (JS via Bun + native Kotlin and Swift unit tests):

```bash
bun run test
```

JS tests only:

```bash
bun run test:bun
```

Native unit tests only:

```bash
bun run test:android
bun run test:ios
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

## Contributing

Bug reports, board compatibility feedback, code, and documentation are welcome.
[Open an issue](https://github.com/vescape-app/vescape/issues) with what you expected,
what happened, and the board, firmware, phone, and app version involved.

Before changing code, read [AGENTS.md](AGENTS.md) for repository conventions and
[CONTEXT.md](CONTEXT.md) for the domain language. Open pull requests against `dev`;
`main` is reserved for production releases. Keep changes focused and include the
verification relevant to your change.

Project-local coding-agent workflows live in [.agents/skills/](.agents/skills/).

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
