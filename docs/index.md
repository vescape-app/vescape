# Vescape App — Documentation

**Target device**: Floatwheel ADV2 (VESC-based onewheel)
**Stack**: Expo SDK 54 · React Native 0.81.5 · New Architecture · Android · Bun

## Documents

### Platform & architecture

- [architecture.md](./architecture.md) — hardware topology, BLE profile, protocol stack
- [native-api.md](./native-api.md) — the native↔JS surface: modules, events, payloads
- [connectionState.md](./connectionState.md) — native-owned live state, GPS, recording, auto-connect
- [ios.md](./ios.md) — iOS specifics: Live Activity, background ride recording, notifications
- [bleAndroid.md](./bleAndroid.md) — BLE connection problems & fixes (custom native module)
- [watch-mirror.md](./watch-mirror.md) — Wear OS Mirror local install and Data Layer troubleshooting

### Board protocol & telemetry

- [vescProtocol.md](./vescProtocol.md) — VESC packet framing, CAN forwarding, Refloat commands
- [refloatAlldata.md](./refloatAlldata.md) — Refloat `COMMAND_GET_ALLDATA` binary layout
- [mcconf.md](./mcconf.md) — VESC motor config binary layout, signature versioning, decode traps
- [chargingDetection.md](./chargingDetection.md) — charging indicator investigation & findings
- [pin-lock.md](./pin-lock.md) — upstream VESC PIN write-lock: fork firmware, commands, what it blocks (not implemented)

### Features

- [history.md](./history.md) — ride history persistence, grouping, markers, and map rendering
- [tune.md](./tune.md) — Refloat tune screen behavior, basic slider formulas, field groups
- [tune-preview-pl.md](./tune-preview-pl.md) — Tune vs Tune Preview, explained (Polish)
- [alerts.md](./alerts.md) — telemetry alerts: storage, native evaluation, Geiger mode
- [safety.md](./safety.md) — safety warnings & thresholds: firmware pushbacks, faults, voltage cutoffs
- [board-warnings.md](./board-warnings.md) — Board Warnings catalog: every kind's slug, title, severity, trigger, payload, clear semantics
- [VESC fault evidence](./adr/0037-vesc-faults-are-board-owned-evidence.md) — live occurrences, past telemetry captures, and the on-demand Controller Fault Log
- [Board tombstones](./adr/0027-boards-are-tombstoned-never-deleted.md) — deleting a Board keeps its row so Ride History can still name it
- [Telemetry keyed on board id](./adr/0028-telemetry-is-keyed-on-board-id.md) — every telemetry table keys on the Board, not the BLE identifier
- [legal-mode-speed-limits.md](./legal-mode-speed-limits.md) — legal mode: jurisdictions and speed caps

### Performance

- [performance-findings.md](./performance-findings.md) — live telemetry: hot/cold split, render-rate rules
- [performance-map-camera.md](./performance-map-camera.md) — compass-mode camera cost, watchdog kill & fix

### Process

- [design.md](./design.md) — visual design language: colors, layout, typography
- [release.md](./release.md) — versioning, per-version notes tiers, tags & GitHub Releases

## Agent guides (`docs/agents/`)

Working rules and tooling recipes. `AGENTS.md` holds the rules that always apply; these are the
deeper references it points at.

- [agents/react.md](./agents/react.md) — React Native UI conventions, icon usage
- [agents/skia.md](./agents/skia.md) — Skia canvas: gesture frame cost, transform-only animation, worklet traps
- [agents/native-sync.md](./agents/native-sync.md) — keeping generated `ios/`, `android/`, Pods in sync
- [agents/mapbox-patches.md](./agents/mapbox-patches.md) — Mapbox dependency patches and native camera semantics
- [agents/ios-profiling.md](./agents/ios-profiling.md) — headless Instruments on a real device: record, export, parse
- [agents/clerk-auth.md](./agents/clerk-auth.md) — Clerk production auth setup, Android email-link debugging
- [agents/issue-tracker.md](./agents/issue-tracker.md) — issues and PRDs on GitHub
- [agents/triage-labels.md](./agents/triage-labels.md) — the five-label triage vocabulary
- [agents/domain.md](./agents/domain.md) — `CONTEXT.md` and `docs/adr/` conventions

## Status

| Area                               | State                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| BLE scan & connect                 | ✅                                                                               |
| BLE notifications (Android 13+)    | ✅ fixed — see [bleAndroid.md](./bleAndroid.md)                                  |
| CAN forwarding to motor controller | ✅ fixed — see [vescProtocol.md](./vescProtocol.md)                              |
| Refloat GET_ALLDATA telemetry      | ✅                                                                               |
| Smart-BMS cell-group voltages      | 🧪 Experimental — see [vescProtocol.md](./vescProtocol.md#bms-cell-group-values) |
| iOS                                | stub only                                                                        |
