# Vescape App — Documentation

**Target**: VESC-based self-balancing boards running Refloat
**Stack**: Expo SDK 57 · React Native 0.86 · Android & iOS · Wear OS & watchOS · Bun

Domain vocabulary lives in [GLOSSARY.md](../GLOSSARY.md); hard-to-reverse architectural traps live in [docs/adr/](./adr/).

## Unfinished / PoC / Planned

- [accessories.md](./accessories.md) — in-progress accessory behavior: ground-clearance tilt sensor and unvalidated brake-light PoC
- [accessory-protocol.md](./accessory-protocol.md) — JSON/BLE protocol v1 draft shared with ESP32 firmware
- [pin-lock.md](./pin-lock.md) — upstream VESC PIN write-lock firmware research (not implemented)
- [legacy-float.md](./legacy-float.md) — removal checklist for legacy INFO v1, saved links, and VESC 6.02 support (`@legacy-float` markers)
- [watchos.md](./watchos.md) — watchOS platform differences, build/simulator traps, and open physical-device verification (#491)

## Board protocol & safety

- [vescProtocol.md](./vescProtocol.md) — ESP32 BLE→CAN topology, NUS `6e400002` quirk, VESC framing, CAN forwarding, smart-BMS layout
- [refloatAlldata.md](./refloatAlldata.md) — Refloat `COMMAND_GET_ALLDATA` binary layout, `LIGHTS_CONTROL` v1.1/v1.2, `RC_MOVE`/`REMOTE`, unimplemented read commands
- [mcconf.md](./mcconf.md) — VESC motor config binary signatures, `confgenerator.c` vs XML decode traps, layout generator
- [safety.md](./safety.md) — Refloat firmware pushbacks, per-cell vs pack voltage rules, fault thresholds
- [board-warnings.md](./board-warnings.md) — Board Warnings catalog: every `BoardWarningKind` slug, severity, trigger, payload, clear semantics

## Core system behavior

- [connectionState.md](./connectionState.md) — native-owned live state, GPS Power Mode demand, auto-connect, fast-connect deadlines, Idle Pause, ride boundaries
- [history.md](./history.md) — two-stream Ride History, Maintenance Jobs, Ride weather, bucket route previews, Favorite Media span rules, exports
- [alerts.md](./alerts.md) — native alerts, sound/voice packs, Geiger mode, re-arm semantics, Announcement Queue, Weather Alerts, Alert Presets
- [tune.md](./tune.md) — Tune Preview physical model, Basic slider formulas, Refloat config/runtime protocols, Board Move, version compatibility
- [remote-tilt.md](./remote-tilt.md) — Remote Tilt gesture ownership, wrist stick, single native arbiter rules
- [ios.md](./ios.md) — iOS Live Activity, critical-alert notifications, background ride recording & OS limits
- [watch-mirror.md](./watch-mirror.md) — Wear OS & shared Watch Mirror ownership, channels, ambient, trail, street map, Ride Notices, battery complication

## Design & release

- [design.md](./design.md) — visual design language: adaptive colors, layout, typography, icons
- [release.md](./release.md) — versioning, two-tier release notes, tags, GitHub Releases, Released App Versions

## Agent guides (`docs/agents/`)

Working rules and tooling recipes. `AGENTS.md` holds the rules that always apply; these are the deeper references it points at.

- [agents/react.md](./agents/react.md) — React Native UI conventions, adaptive colors, components, high-frequency live-stream rules
- [agents/skia.md](./agents/skia.md) — Skia canvas: gesture frame cost, transform-only animation, worklet traps
- [agents/mapbox-patches.md](./agents/mapbox-patches.md) — Mapbox dependency patches, direct camera/marker layers, background camera-loop traps
- [agents/native-sync.md](./agents/native-sync.md) — keeping generated `ios/`, `android/`, Pods, and SwiftPM in sync
- [agents/watch-emulators.md](./agents/watch-emulators.md) — `android:up`: phone + Wear emulators paired and mirroring, failures and fixes
- [agents/ios-profiling.md](./agents/ios-profiling.md) — headless Instruments on a real device: record, export, parse
- [agents/clerk-auth.md](./agents/clerk-auth.md) — Clerk production auth setup, Device Token rules, Android email-link debugging
- [agents/issue-tracker.md](./agents/issue-tracker.md) — issues, PRDs, triage vocabulary, and labels on GitHub
