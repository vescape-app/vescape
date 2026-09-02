# Telemetry Alerts

JS layer may be suspended during a ride. Alerts are evaluated natively so they fire regardless.

## Data flow

```
JS calls VescapeCore alert CRUD / Legal Mode intent → native storage updates → native reloads rules
CoreForegroundService: each BLE packet → evaluateAlerts() → SoundPool/TextToSpeech + Vibrator
Fired alerts embedded in that packet's telemetry map → visible in recentTelemetry
```

No separate event. No JS-side audio. Native storage is the source of truth.

## Per-board ownership

Alert Rules are owned by one Board. The native alert engine loads **only the connected Board's**
enabled rules at session start (and on any rule edit), so switching Boards switches the effective rule
set — engine and UI both. Deleting a Board deletes its rules. Rules for a non-connected Board never
evaluate.

Preset rule ids (`preset:<metric>:<index>`) repeat across Boards; uniqueness is per Board via the
composite primary key `(board_id, id)`.

Legal Mode is durable per-Board state in `board_settings`, independent of Board-owned Alert Rule
rows. Native combines that Board's `legalMode.enabled` with the app-wide Legal Policy jurisdiction
and adds a virtual geiger speed rule whenever rules load. Nothing is written to `alerts`.

## Schema — `alerts` table

| column                 | type             | notes                                                          |
| ---------------------- | ---------------- | -------------------------------------------------------------- |
| `board_id`             | TEXT             | owning Board; PK is `(board_id, id)`                           |
| `id`                   | TEXT             | UUID or `preset:<metric>:<index>`                              |
| `control_id`           | TEXT             | see Control IDs below                                          |
| `threshold`            | REAL             | trigger point                                                  |
| `threshold_max`        | REAL nullable    | range upper bound (Geiger mode)                                |
| `enabled`              | INTEGER 0/1      | toggled by user                                                |
| `sound_type`           | TEXT             | feedback value, e.g. `preset:beep` or `tts:Battery {percent}%` |
| `created_at`           | INTEGER          | ms epoch                                                       |
| `repeat_every_seconds` | INTEGER nullable | repeat cadence for a single-threshold rule; NULL is one-shot   |
| `beep_count`           | INTEGER          | sound plays per announcement, 1–5 (preset sounds only)         |
| `threshold_kind`       | TEXT             | `fixed` or `config-relative`                                   |
| `config_field_id`      | TEXT nullable    | VESC config field used by a relative rule                      |
| `threshold_offset`     | REAL nullable    | start offset in alert units                                    |
| `threshold_max_offset` | REAL nullable    | range ceiling offset in alert units                            |

## Control IDs & implicit direction

Direction is hardcoded per control — not stored.

| `control_id`      | direction | value used               |
| ----------------- | --------- | ------------------------ |
| `speed`           | above     | `abs(speed)` km/h        |
| `battery`         | **below** | `batteryVoltage` V       |
| `duty`            | above     | `abs(dutyCycle) × 100` % |
| `motor-temp`      | above     | `tempMotor` °C           |
| `motor-current`   | above     | `motorCurrent` A         |
| `controller-temp` | above     | `tempMosfet` °C          |
| `batt-current`    | above     | `batteryCurrent` A       |
| `imu`             | above     | `pitch` °                |
| `footpad`         | above     | `adc1`                   |

## Geiger mode

Set `threshold_max` to add a range. Active range alerts run a native SoundPool tick loop using the selected geiger preset. The interval shrinks linearly:

- at `threshold` → about 800 ms between ticks
- at `threshold_max` → the selected geiger preset loops continuously

## Single-threshold rules: arm, announce, re-arm

A single-threshold rule announces when the metric crosses it, then latches. It says nothing more
until it re-arms — the metric must travel back past the threshold by that metric's re-arm margin
(`TelemetryMetricDef.alertRearmMargin`: 3 °C temperature, 5 pp duty, 3 km/h speed, 10 pp battery).
A value hovering on the threshold therefore cannot re-announce, and there is no time-based debounce
anywhere in the engine (ADR 0032).

Set `repeat_every_seconds` to keep announcing on a fixed cadence for as long as the metric stays
past the threshold. Native floors it at `ALERT_REPEAT_MIN_SECONDS` (3 s). Re-arming resets the
repeat clock, so a fresh crossing announces immediately rather than waiting out the cadence.

`beep_count` sets how many times the preset sound plays per announcement, 200 ms apart, so a rider
can give different rules different signatures. It does nothing for `tts:` rules, which speak once
per announcement, or for range rules, which own their own cadence.

The latch and repeat clock are cleared only when a new Board Session starts — not on rule edits,
preset regeneration, idle pause, or backgrounding. Preset rule ids are deterministic, so changing a
preset level keeps a rule latched.

When multiple alerts fire on the same packet, SoundPool lets their clips or geiger loops overlap.
Within a single evaluation, the most urgent alert is sorted first for telemetry display
(Geiger over simple; higher threshold for above-direction controls, lower threshold for below-direction).
Single-threshold alerts then coalesce per control: only the most urgent announces, and the rest
latch silently — they are past their thresholds, so they are spent rather than pending.

## Message mode

Single-threshold alerts may use native Android text-to-speech by storing the spoken template directly in `sound_type`:

```text
tts:Battery {voltage} volts, {percent}%
```

This is a plain prefix payload, not a URL. Native only treats the first prefix as meaningful:

- `preset:beep` → play bundled preset
- `tts:Battery {value} {unit}` → speak the template

Additional colons inside the message are part of the message.

Message mode is single-threshold only (one-shot or repeating). Geiger/range alerts (`threshold_max != null`) use geiger presets and must not use `tts:`. Native should guard against invalid stored combinations.

Templates render from current alert values when the rule fires:

| placeholder   | meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `{value}`     | current primary value for the alert control                    |
| `{threshold}` | configured threshold                                           |
| `{unit}`      | display unit for the alert control                             |
| `{voltage}`   | current battery voltage, battery alerts only                   |
| `{percent}`   | current estimated battery state of charge, battery alerts only |

`{percent}` requires a valid Board battery config. If a placeholder is unavailable, native should avoid speaking raw braces and should record a Diagnostic Event.

Runtime behavior:

- Android native `TextToSpeech` speaks from the foreground service so messages can fire while JS is suspended.
- TTS uses the same alarm-style audio attributes as alert presets.
- TTS is initialized lazily when rules include a `tts:` message and speech plays as soon as possible. Do not pre-generate or cache message audio.
- Message alerts vibrate once, same as one-shot preset alerts.
- If multiple spoken messages compete, the most urgent alert wins and may stop a less urgent spoken message.
- Spoken messages play over active geiger ticks; geiger loops are not paused or ducked.
- Preview supports `tts:` templates with sample placeholder values.
- There is no app-level template length limit beyond what native storage and the platform can handle.

## Alert Presets

Presets generate Alert Rules in JS. Fixed rules carry concrete thresholds; a preset the rider opts
into matching carries a durable relationship to a board config field instead. Native resolves that
field from Last Known Board Config Values (Refloat) or Last Known Motor Config Values (MCCONF) and
follows fresh reads/writes without rewriting the rule.

Per-metric opt-in, persisted in the Board's `matchBoardConfig` bag:

| metric            | field                | config  | units    |
| ----------------- | -------------------- | ------- | -------- |
| `duty`            | `tiltback_duty`      | Refloat | fraction |
| `motor-temp`      | `l_temp_motor_start` | MCCONF  | °C       |
| `controller-temp` | `l_temp_fet_start`   | MCCONF  | °C       |

What a field id means — which config it lives in, its scale, and the value at which the board's own
protection is off (duty `1.0`) — is a property of the field, not of the rule, so it lives in one
table mirrored across TS and both platforms (`configRelativeFields`) rather than on every row. A
field that is missing, unread, or disabled leaves the relationship inactive: the rule persists, and
neither a sound nor a gauge marker comes from it until the board supplies a value.

A rider picks one **level** per **metric**; `generateAlertPresetRules` (`src/modules/alerts/lib/alertPresets.ts`)
deterministically expands `(metric, level, options)` into concrete rule specs the Alert Preset store
persists through the same CRUD as manual rules.

### Levels

Four levels, safest first: **Off**, **Safe**, **Normal**, **Minimal**. `off` (and any guard failure)
generates no rules. Safer levels add more warning points and start earlier; Minimal warns late and only at
the extreme.

### Metrics & families

Five metrics, in two feedback families:

| metric            | family   | feedback                                                         |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `battery`         | discrete | one TTS rule per SoC % point; needs a valid Board battery config |
| `motor-temp`      | discrete | one TTS rule per °C point                                        |
| `controller-temp` | discrete | one TTS rule per °C point                                        |
| `speed`           | geiger   | one range rule, start scaled by Rider Top Speed                  |
| `duty`            | geiger   | one range rule over % duty                                       |

- **discrete** → one single-threshold `tts:` rule per configured point.
- **geiger** → one range rule (`threshold` → `thresholdMax`); the start drops with protection while the
  ceiling stays fixed.

Values seed from the shared `TELEMETRY_THRESHOLDS` where sensible so presets track the visual warning
tiers. Tune counts/values only in `alertPresets.ts` — never in native or components.

### Provenance & regeneration

Preset rules carry `source = "preset"` (`ALERT_PRESET_SOURCE`) with deterministic ids
(`presetAlertRuleId(metric, index)`) and the active Board's `board_id`. Changing a level regenerates
that one metric wholesale (delete-then-upsert scoped to its preset rules on that Board) — manual rules
and other metrics' preset rules survive. The per-metric level selection is the durable `alertPreset`
**Board Settings** bag; regeneration reads it back plus that Board's Board Top Speed and battery config.

### Board Top Speed

`topSpeedKmh` (a **Board Settings** key, renamed from the former profile-level Rider Top Speed) scales
the speed preset's thresholds and the speed gauge full-scale — it is the rider's self-assessed top speed
for that Board, not a legal or firmware limit. Changing it regenerates the speed preset. Missing ⇒
display default 50 km/h.

### Board Settings keys

Four per-Board keys drive Alert Presets and Legal Mode, backed by the `board_settings` table and composed onto the
`Board` object (like `batteryConfig`). Missing keys normalize to display defaults; no preset rules are
generated until the rider touches setup:

| key                     | default  | meaning                                          |
| ----------------------- | -------- | ------------------------------------------------ |
| `alertPreset`           | null     | per-metric level selection bag (null ⇒ all Off)  |
| `topSpeedKmh`           | 50       | Board Top Speed (km/h)                           |
| `alertPresetsOnboarded` | false    | one-time guided-setup gate for this Board        |
| `legalMode`             | disabled | native-owned `{ enabled }` Legal Mode activation |

### Setup surfaces

The same setup (Board Top Speed + all five sliders, `AlertPresetSetup`) is reached two ways:

- **Add-board wizard** — a `presets` step shown for every new Board (each Board gets its own guided
  setup). The step edits a draft; on save the draft is persisted onto the new Board and its preset rules
  are generated. Completing sets that Board's `alertPresetsOnboarded`.
- **Settings › Alerts** — the durable home for the active Board, always available.

## JS side

```ts
// store — backed by native VescapeCore APIs, bound to the active Board (#254)
store.load(boardId)                     // `startAlertsBoardSync` calls this on every active-board change
store.add(controlId, threshold, thresholdMax?)   // stamps the bound boardId
store.toggle(id)
store.remove(id)

// native API is board-scoped
getAlertRules(boardId)
upsertAlertRule(rule)                    // rule carries boardId
setAlertRuleEnabled(boardId, id, enabled)
deleteAlertRule(boardId, id)

// fired alerts arrive on every matching telemetry packet
onTelemetry: (e) => e.firedAlerts?.forEach(a => ...)
```

Native alert mutations reload the connected Board's foreground-service rules after writing.

## iOS

iOS mirrors the Android native alert path: persisted rules feed a native evaluator, presets/TTS play without JS, and fired alerts are attached to telemetry payloads.
