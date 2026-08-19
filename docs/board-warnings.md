# Board Warnings — Kinds Reference

→ [index](./index.md) | [safety](./safety.md)

The single catalog of every **Board Warning** kind. A Board Warning is an app-detected abnormal
Board condition worth the rider's attention (see the domain term in [CONTEXT.md](../CONTEXT.md)).
Warnings are detected **natively** on both platforms; JS only renders them. Each kind is keyed
one-per-problem-kind per Board (automotive fault-code model), carries a fixed severity, and ships a
kind-specific JSON `payloadJson` blob the UI decodes.

> **Adding a detector?** Every new Board Warning kind must be added to this doc (a row in the table
> plus a payload entry) at the same time as its `BoardWarningKind` slug lands. This file is the
> catalog — keep it exhaustive.

## Where each part lives

- **Kind slugs** — `BoardWarningKind` catalog, mirrored on all three surfaces:
  `modules/vescape-core/android/.../BoardWarningKind.kt`,
  `modules/vescape-core/ios/telemetry/BoardWarningKind.swift`, and the JS union in
  `modules/vescape-core/src/index.ts`.
- **Rider-facing titles** — `WARNING_TITLES` in `src/modules/board/lib/boardWarnings.ts` (keyed by the exhaustive
  union, so a missing title is a compile error).
- **Detection logic** — the three detectors under
  `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/` (iOS peers under
  `modules/vescape-core/ios/telemetry/`): `CellSpreadDetector`, `BatteryConfigMismatchDetector`,
  `ConfigSafetyDetector`.
- **Thresholds** — firmware pushback/fault defaults and the per-cell vs pack voltage-unit logic live
  in [safety.md](./safety.md). This doc references those values rather than restating them.

## Detector scopes

Two detection scopes decide _when_ a kind is evaluated:

- **Telemetry-scoped (continuous)** — fed each ~4 Hz smart-BMS / telemetry frame during a live Board
  Session. Stateful trackers with a sustain/stability window so a single odd frame never fires.
- **Config-scoped (post-link-trust)** — pure rules over the decoded Refloat config, run once per
  Board Session after a passing **Link Integrity Check** (and again after tune writes). A rule whose
  config field is absent from the schema is _skipped_ (any stored warning is left untouched), never
  guessed.

## Severity

Fixed at detection time, two levels: `warn` and `critical`. For most kinds the severity is constant
(see the table). `cell-spread` is the exception: it escalates `warn → critical` on the session's peak
sustained spread, and the reported severity/peak are monotonic across a Board Session (a later,
weaker episode never downgrades a stored warning).

## Clear semantics (all kinds)

- **Auto-clear** — a warning clears only when _its own detector re-evaluated with real data and found
  the condition gone_ (a "clean evaluation"). Telemetry-scoped kinds report this at Board Session end
  (`sessionEndClean`); config-scoped kinds report it inline whenever the rule evaluates fine
  (`cleanKinds`). No data / a skipped rule is **not** a clean evaluation — the stored warning stays.
- **Manual clear** — the rider can clear a single warning (`clearBoardWarning`) or all of a board's
  (`clearAllBoardWarnings`). A still-true condition simply re-fires on the next evaluation — including
  within the same Board Session: a manual clear resets the matching telemetry detector's dedupe
  (registry `onManualClear` → session controller), so the detector's sustain window restarts and a
  persisting condition re-reports rather than staying silently gone until the next session.
- **Re-detection** — updates the existing warning in place (preserving `firstDetectedAtMs`) rather
  than creating a duplicate.
- **Dismissal (JS-only)** — the warnings sheet's per-row action is a _dismiss_, not a clear: the kind
  is persisted in the board record's `dismissedWarnings` array (a `board_settings` row, like
  `batteryConfig`). The warning stays in the native registry and renders grayed in the sheet, but
  stops driving the board-bar warning indicator. Restoring removes the kind again. Native detection
  and clear semantics are untouched; `clearBoardWarning`/`clearAllBoardWarnings` remain the actual
  data reset.

## Kill switch

`boardWarningsEnabled` in `AppSettings` (default `true`) is the feature's master switch. Off ⇒
native runs no detector evaluation, no registry writes, and no session-end clean pass; JS hides the
warning icon/sheet. Stored warnings are left untouched and reappear on re-enable (a kill switch is
not a data reset — manual clear exists for that). Toggling takes effect live, no reconnect needed.

## Kinds

| Slug                      | Title                          | Severity            | Scope                    | Detector                        | Trigger                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------ | ------------------- | ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell-spread`             | Cell voltage spread            | `warn` → `critical` | telemetry (continuous)   | `CellSpreadDetector`            | Smart-BMS cell-group voltage spread (`max − min` across valid groups, ≥ 2 groups) stays at or above the warn threshold for a sustained window; peak sustained spread escalates to critical. Thresholds are field-tuned detector constants (`WARN_THRESHOLD_V` 0.10 V, `CRITICAL_THRESHOLD_V` 0.25 V, `SUSTAIN_MS` 3 s). |
| `battery-config-mismatch` | Battery config mismatch        | `warn`              | telemetry (continuous)   | `BatteryConfigMismatchDetector` | Smart-BMS cell count, stable across 3 consecutive frames, disagrees with the board's configured battery **series count**. Missing series count → skipped, not clean.                                                                                                                                                    |
| `footpad-disabled`        | Footpad sensor disabled        | `critical`          | config (post-link-trust) | `ConfigSafetyDetector`          | Both footpad ADC switch voltages are 0 (`fault_adc1 == 0` **and** `fault_adc2 == 0`) — the footpad switch is disabled entirely. See [safety.md](./safety.md#fault-disengagement-board-turns-off).                                                                                                                       |
| `lv-pushback-low`         | Low-voltage pushback too low   | `critical`          | config (post-link-trust) | `ConfigSafetyDetector`          | `tiltback_lv` below the safe minimum in its config units (below `10 V` means per-cell on supported firmware; otherwise pack total). Unit resolution + defaults: see [safety.md](./safety.md#pushbacks-nose-lifts-to-warn-the-rider). Rule skipped when firmware capability / required series count is unknown.          |
| `hv-pushback-high`        | High-voltage pushback too high | `warn`              | config (post-link-trust) | `ConfigSafetyDetector`          | `tiltback_hv` above the safe maximum in its config units (below `10 V` means per-cell on supported firmware; otherwise pack total). Same unit resolution as LV; see [safety.md](./safety.md#pushbacks-nose-lifts-to-warn-the-rider).                                                                                    |
| `duty-pushback-high`      | Duty pushback too high         | `warn`              | config (post-link-trust) | `ConfigSafetyDetector`          | `tiltback_duty` above the safe maximum (`DUTY_MAX` 0.85 fraction). VESC max duty is 0.95; see [safety.md](./safety.md#pushbacks-nose-lifts-to-warn-the-rider).                                                                                                                                                          |
| `moving-fault-disabled`   | Moving-fault protection off    | `warn`              | config (post-link-trust) | `ConfigSafetyDetector`          | `fault_moving_fault_disabled` is enabled — moving faults are turned off, weakening fault protection while riding. See [safety.md](./safety.md#fault-disengagement-board-turns-off).                                                                                                                                     |

## Payload shapes

`payloadJson` is a JSON object string, built natively via `JSONObject` / `JSONSerialization` (never
hand-assembled). Numeric fields are rounded to 4 decimals before serialization
(`boardWarningRound4`). JS decodes it generically in `parseWarningDetail` (`src/modules/board/lib/boardWarnings.ts`)
until a kind opts into bespoke detail text.

### `cell-spread`

```json
{ "peakSpread": 0.1342, "worstGroup": 7, "charging": false, "balancing": true }
```

| Field        | Type         | Meaning                                                                                                                          |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `peakSpread` | number (V)   | Peak sustained spread observed this session (`max − min`), 4 dp.                                                                 |
| `worstGroup` | number (int) | Index of the cell group furthest from the pack average at that peak; `-1` when none.                                             |
| `charging`   | boolean      | Whether a charger was present (charge-port voltage above the detect floor) when the finding fired. Context, not a separate kind. |
| `balancing`  | boolean      | Whether any cell group was actively balancing.                                                                                   |

### `battery-config-mismatch`

```json
{ "bmsCellCount": 20, "configuredSeries": 15 }
```

| Field              | Type         | Meaning                                      |
| ------------------ | ------------ | -------------------------------------------- |
| `bmsCellCount`     | number (int) | Stable cell count reported by the smart BMS. |
| `configuredSeries` | number (int) | Board's configured battery series count.     |

### Config-scoped kinds — `footpad-disabled`, `lv-pushback-low`, `hv-pushback-high`, `duty-pushback-high`, `moving-fault-disabled`

All five share one payload shape:

```json
{ "param": "tiltback_lv", "value": 42.0, "bound": 45.0 }
```

| Field   | Type   | Meaning                                                                                                                      |
| ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `param` | string | The offending Refloat config parameter. `footpad-disabled` reports the pair `"fault_adc1/fault_adc2"`.                       |
| `value` | number | The parameter's current value, 4 dp. Boolean rules encode enabled as `1` (e.g. `moving-fault-disabled`, `footpad-disabled`). |
| `bound` | number | The safe bound the value violated (in the same units), 4 dp. `0` for the boolean/pair rules.                                 |
