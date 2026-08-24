# Vescape App — Documentation

**Target device**: Floatwheel ADV2 (VESC-based onewheel)
**Stack**: Expo SDK 54 · React Native 0.81.5 · New Architecture · Android · Bun

## Documents

- [architecture.md](./architecture.md) — hardware topology, BLE profile, protocol stack
- [connectionState.md](./connectionState.md) — native-owned live state, GPS, recording, auto-connect
- [history.md](./history.md) — ride history persistence, grouping, markers, and map rendering
- [bleAndroid.md](./bleAndroid.md) — BLE connection problems & fixes (custom native module)
- [vescProtocol.md](./vescProtocol.md) — VESC packet framing, CAN forwarding, Refloat commands
- [refloatAlldata.md](./refloatAlldata.md) — Refloat `COMMAND_GET_ALLDATA` binary layout
- [tune.md](./tune.md) — Refloat tune screen behavior, basic slider formulas, field groups
- [chargingDetection.md](./chargingDetection.md) — charging indicator investigation & findings
- [alerts.md](./alerts.md) — telemetry alerts: storage, native evaluation, Geiger mode
- [safety.md](./safety.md) — safety warnings & thresholds: firmware pushbacks, faults, voltage cutoffs
- [board-warnings.md](./board-warnings.md) — Board Warnings catalog: every kind's slug, title, severity, trigger, payload, clear semantics
- [pin-lock.md](./pin-lock.md) — upstream VESC PIN write-lock: fork firmware, commands, what it blocks (not implemented)
- [watch-mirror.md](./watch-mirror.md) — Wear OS Mirror local install and Data Layer troubleshooting
- [performance-findings.md](./performance-findings.md) — live telemetry: hot/cold split, render-rate rules
- [performance-map-camera.md](./performance-map-camera.md) — compass-mode camera cost, watchdog kill & fix
- [release.md](./release.md) — versioning, per-version notes tiers, tags & GitHub Releases

## Status

| Area                               | State                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| BLE scan & connect                 | ✅                                                                               |
| BLE notifications (Android 13+)    | ✅ fixed — see [bleAndroid.md](./bleAndroid.md)                                  |
| CAN forwarding to motor controller | ✅ fixed — see [vescProtocol.md](./vescProtocol.md)                              |
| Refloat GET_ALLDATA telemetry      | ✅                                                                               |
| Smart-BMS cell-group voltages      | 🧪 Experimental — see [vescProtocol.md](./vescProtocol.md#bms-cell-group-values) |
| iOS                                | stub only                                                                        |
