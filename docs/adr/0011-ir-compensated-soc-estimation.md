# IR-compensated SoC estimation

> **Note:** The "no smoothing / responsive display" stance below is superseded by [ADR-0016](0016-median-windowed-soc-estimate.md), which adds a median window to the SoC Estimate. IR compensation itself stands.

Under load (hill climbs, hard acceleration), battery voltage drops due to internal resistance (voltage sag). Raw voltage-based SoC estimation reports artificially low % during high-current draw, causing unreliable battery display and premature alert triggers.

We apply IR compensation before the SoC curve lookup: `V_corrected = V_measured + I_battery × R_pack`, where `R_pack = R_cell × seriesCount / parallelCount`. Each cell preset carries its own `internalResistanceMilliOhm`: the cell's DC internal resistance at 50% SoC from a ~10 A pulse, as manufacturer datasheets list it. Never use the AC 1 kHz impedance; it is about half the DC value and under-compensates sag. When a datasheet gives only AC, use 2× AC. Manual battery config uses a default of 18mΩ with series count estimated from max voltage.

Raw voltage remains unchanged in telemetry output — only the % calculation (display, alerts, history buckets) uses the corrected voltage. VESC `batteryCurrent` is positive during discharge, so the formula adds voltage back.

## Considered Options

- **EMA smoothing on SoC output.** Rejected: smoothing hides real drops (actual discharge) alongside sag artifacts. Can't distinguish "battery is draining" from "hill ended, voltage recovered." IR compensation addresses the root cause.
- **Per-cell SoC curves at different C-rates.** More accurate but requires multiple discharge curves per cell, which we don't have. IR compensation with a single curve is good enough for rider-facing %.
- **User-configurable R_internal.** Rejected for now: preset values cover all supported cells. Manual mode uses a reasonable default. Can revisit if users report inaccuracy with unusual packs.

## Consequences

- `BatterySocEstimator.estimateBatteryPercent()` takes an optional `batteryCurrentA` parameter (default 0.0, backward compatible).
- Both call sites in `CoreForegroundService` pass `parsed.batteryCurrent` / `it.batteryCurrent`.
- `CellPreset` Kotlin data class gains `internalResistanceMilliOhm: Int`. JS `BatteryCellPreset` type mirrors it.
- At zero current, behavior is identical to pre-compensation code path.
- Correction is instantaneous (no smoothing, no hysteresis). Displayed % will track load in real time — this is intentional; riders prefer responsive readings over artificially stable ones.
