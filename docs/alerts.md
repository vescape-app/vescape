# Telemetry Alerts

JS layer may be suspended during a ride. Alerts are evaluated natively so they fire regardless.

## Data flow

```
JS sends preset intent / custom Alert Rule CRUD / Legal Mode intent → native transaction → native reloads rules
CoreForegroundService: each BLE packet → evaluateAlerts() → SoundPool/TextToSpeech + Vibrator
Fired alerts embedded in that packet's telemetry map → visible in recentTelemetry
```

No separate event. No JS-side audio. Native storage is the source of truth.

## Sound effects

The app-wide **Sound effects** setting (`soundPack`, default `retro`) picks one built-in effects
pack: Retro, Simple, HEV, or Clean. The selected pack supplies every sound native plays: app cues,
the severity sounds of alert rules and speech, and geiger ticks (see
[Built-in packs](#built-in-packs)). Retro and Simple are today's sound themes turned into packs, so
a saved theme keeps its id and sounds the same. Settings previews the selected pack's cues and its
Info/Warning/Critical sounds.

App cues: Connect (`cue.on`), Disconnect (`cue.off`), Error, New Group Ride, Rider joined Group
Ride, and Ride end (`cue.ride.end`), which plays when the ride dropout grace expires after a lost
link, the point at which a Board Session ride is treated as ended.

### Custom app sound packs

A custom pack replaces the five original app cues (Connect, Disconnect, Error, New Group Ride,
Rider joined Group Ride) and may assign any subset. While one is selected, alert and geiger sounds,
Ride end, and every cue without a usable file come from Simple. Native playback and previews read
the same app-owned `custom-app-sounds` manifest and WAV files. Imports accept decodable WAV up to 2 MB and
15 seconds. The document picker source is copied, so its URI is never used for later playback.

Database backups include the custom pack manifest and audio files under `custom-app-sounds/`.
Android copies the referenced files and manifest under the pack store lock before writing the
archive. Restore retains the previous database and pack files until both have installed; a failed
sound install rolls both back.
Restoring an older backup without these entries clears custom packs. A restored pack drops any
assignment whose file is absent, while a selected pack that no longer exists resolves to Simple.

## Voice packs (planned)

> Agreed in #574, not implemented yet. Sound effects (above) are implemented; the rest of this
> section is planned.

Speech will come from a second app-wide choice next to Sound effects:

- **Voice** (`Matching` or a voice pack): whole-sentence lines per message key plus value clips,
  joined natively into one buffer as severity beeps + line + value. `Matching` uses the voice the
  effects pack names; packs without one use Clean.
- **Voice level** `Off | Standard | Full`: Off plays effects only, Standard (default) speaks
  alerts, Full also speaks app cues and group ride events after their effect. Voice level only
  affects presets and app sounds, never custom rules.

Preset alerts emit a message key, severity, and value instead of a `tts:` template, and resolve
the line severity variant → generic → beeps only. Each preset can pin its own effects or voice
pack; unpinned presets follow the app-wide choice. Custom rules keep TTS (with the severity sound
before speech) or use effects and user sounds; voice lines exist only for built-in alert keys.
User WAVs move to a **My sounds** library that can override a fixed set of slots (pre-beeps,
board on/off, other cues). Resolution per slot: override > pinned pack > app-wide choice.

Every `sound_type` follows one grammar, `kind(variant):sound` (`tts` and `alert` are parsed today,
see [Message mode](#message-mode)); the planned kinds are `geiger:soft` and
`voice(critical):battery:10` (severity sound, then voice line + value). `my:` names a My sound.

All sounds that can fire during a ride stay decoded in memory for the session, so playback starts
without load delay. The line schema lives in #574.

### Built-in packs

Packs are generated and committed under `shared/alerts/packs/`. `bun run copy:shared` copies the
effects packs, keeping their `<pack>/pack.json` layout, to Android `assets/alert-packs/` and to
`modules/vescape-core/ios/alert-packs/`, which the podspec bundles as a folder in
`VescapeCoreAssets.bundle`. Native reads each `pack.json` and decodes every slot of every effects
pack at player start (`EffectsPacks.kt`, `EffectsPacks.swift`). Voice packs are not copied or
played yet (#580).

```text
scripts/alert-packs/
  catalog.json          required effect slots, voice keys + value type, value ranges
  effects-<id>.json     segments per slot: sox synth tones or recorded `sources/` clips
  sources/              recorded WAVs behind Retro and Simple (today's sounds)
  voice-<id>.json       Kokoro voice + speed, sox voice fx chain, unit words, lines per key
  generate.ts           manifests → packs;  kokoro.py  TTS helper;  packs.ts  shared checks
shared/alerts/packs/
  effects-<id>/pack.json + <slot>.m4a            severity.*, cue.*, geiger.*
  voice-<id>/pack.json + lines/<key>.<start|end>.<i>.m4a + values/<type>/<n>.m4a
```

- **Effect slots**: `severity.info|warning|critical` (HEV/Clean: 1/2/3 beeps; Retro/Simple: the
  former Notify, Beep, and Urgent sounds), `cue.on`, `cue.off`,
  `cue.error`, `cue.groupRide.created`, `cue.groupRide.joined`, `cue.ride.end`, `geiger.soft|mid|hard`.
  Effects packs never contain voice; `pack.json` names the matching voice pack.
- **Voice keys**: `battery` (percent), `motorTemp`, `controllerTemp` (degrees), `link.connected`,
  `link.lost`, `system.error`, `groupRide.created`, `groupRide.joined`, `ride.end`. Each key needs a
  generic line; `<key>.<severity>` variants are optional. A line is `start` (+ value) (+ `end`),
  each part a list of variants, one Kokoro call per sentence.
- **Value clips**: one clip per number with its unit, spelled out (`minus five degrees.`):
  percent 0–100, degrees −30…300 (the clip says only "degrees", shared by °C and °F).
- **Format**: AAC-LC in `.m4a`, mono 22 050 Hz, 40 kbit/s. Android `MediaCodec` and iOS
  `AVAudioFile` both decode it; Ogg Opus has no iOS decoder. Native must drop the AAC encoder
  priming (~1024 samples of leading silence) before joining clips. Intermediate WAVs are not kept.

Regenerate on a Mac dev machine with sox, ffmpeg, and a Python that has `mlx_audio`:

```sh
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs            # all packs
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs voice-hev  # one manifest
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs --force    # re-synthesize every voice clip
```

The generator validates the manifests against `catalog.json` before generating, builds into a
`<pack>.staging` directory, and replaces the committed pack only after the result validates. `bun test scripts/alert-packs` fails when a committed pack misses a slot, a
key's generic line, a value clip, or a listed file. Kokoro is not bit-stable run to run, so a
voice `pack.json` records a `sources` hash per clip (text, Kokoro settings, fx) and only clips whose
hash changed are re-synthesized; effects encoding is bitexact, so an unchanged manifest regenerates
identical files. Kokoro mispronounces "error"; HEV wording says "failure".

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

| column                 | type             | notes                                                             |
| ---------------------- | ---------------- | ----------------------------------------------------------------- |
| `board_id`             | TEXT             | owning Board; PK is `(board_id, id)`                              |
| `id`                   | TEXT             | UUID or `preset:<metric>:<index>`                                 |
| `control_id`           | TEXT             | see Control IDs below                                             |
| `threshold`            | REAL             | trigger point                                                     |
| `threshold_max`        | REAL nullable    | range upper bound (Geiger mode)                                   |
| `enabled`              | INTEGER 0/1      | toggled by user                                                   |
| `sound_type`           | TEXT             | sound string, e.g. `alert(3):warning` or `tts:Battery {percent}%` |
| `created_at`           | INTEGER          | ms epoch                                                          |
| `repeat_every_seconds` | INTEGER nullable | repeat cadence for a single-threshold rule; NULL is one-shot      |
| `threshold_kind`       | TEXT             | `fixed` or `config-relative`                                      |
| `config_field_id`      | TEXT nullable    | VESC config field used by a relative rule                         |
| `threshold_offset`     | REAL nullable    | start offset in alert units                                       |
| `threshold_max_offset` | REAL nullable    | range ceiling offset in alert units                               |

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

Set `threshold_max` to add a range. Active range alerts run a native tick loop with a geiger tick
of the selected effects pack: `preset:tick` → `geiger.soft`, `preset:tick_hard` → `geiger.mid`,
`preset:gamma` → `geiger.hard` (a level select replaces these names in #579). The interval shrinks
linearly:

- at `threshold` → about 800 ms between ticks
- at `threshold_max` → the tick loops continuously

## Single-threshold rules: arm, announce, re-arm

A single-threshold rule announces when the metric crosses it, then latches. It says nothing more
until it re-arms — the metric must travel back past the threshold by that metric's re-arm margin
(`TelemetryMetricDef.alertRearmMargin`: 3 °C temperature, 5 pp duty, 3 km/h speed, 10 pp battery).
A value hovering on the threshold therefore cannot re-announce, and there is no time-based debounce
anywhere in the engine (ADR 0032).

Set `repeat_every_seconds` to keep announcing on a fixed cadence for as long as the metric stays
past the threshold. Native floors it at `ALERT_REPEAT_MIN_SECONDS` (3 s). Re-arming resets the
repeat clock, so a fresh crossing announces immediately rather than waiting out the cadence.

A single sound rule stores `alert(<count>):<severity>`: the selected effects pack's `info`,
`warning`, or `critical` sound, played `count` times (1–5) per announcement, one beep spacing apart
(Android 350 ms, iOS 200 ms), so a rider can give different rules different signatures. The form
offers Info/Warning/Critical plus a beep count. `alert:` means one play; an unknown severity
(including a `my:` sound before My sounds exist, #584) plays `warning`. Strings from before the
grammar still play: `preset:notify|beep|urgent` read as `info|warning|critical`, once. Schema v50
folded the former `beep_count` column into the string (`preset:beep` + 3 → `alert(3):warning`) and
dropped it; `tts` and geiger strings were left unchanged.

The latch and repeat clock are cleared only when a new Board Session starts — not on rule edits,
preset regeneration, idle pause, or backgrounding. Preset rule ids are deterministic, so changing a
preset level keeps a rule latched.

When multiple alerts fire on the same packet, SoundPool lets their clips or geiger loops overlap.
Within a single evaluation, the most urgent alert is sorted first for telemetry display
(Geiger over simple; higher threshold for above-direction controls, lower threshold for below-direction).
Single-threshold alerts then coalesce per control: only the most urgent announces, and the rest
latch silently — they are past their thresholds, so they are spent rather than pending.

## Message mode

Single-threshold alerts may use native text-to-speech by storing the spoken template directly in `sound_type`, with a severity variant:

```text
tts(warning):Battery {voltage} volts, {percent}%
```

`sound_type` is read by one sound string parser per platform (`AlertSoundString.kt`,
`AlertSoundString.swift`, `src/modules/alerts/lib/alertSoundString.ts`): `kind(variant):sound`,
split on the first `:` after the kind and optional variant, so colons inside the message are part
of the message.

- `alert(3):warning` → the pack's warning sound, 3 times (see above)
- `tts(info|warning|critical):Battery {value} {unit}` → severity sound once, then speak the template
- `tts:…` (no variant) or an unknown variant → `warning`, so rules saved before severity need no
  migration

The form's **Severity** select (Info/Warning/Critical, default Warning) on the Message tab sets the
variant, which plays the selected effects pack's `severity.<variant>` sound once. Speech starts
once the sound has played, and no earlier than 350 ms after it starts (`ALERT_SPEECH_DELAY_MS`), so
the two never overlap, even for a pack's three-beep critical sound; a newer announcement cancels speech still waiting on an older one's sound.

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
- Android presets, app cues, and TTS use the selected audio output: Alarm (default, including existing installs) or Media. Switching streams during a session recreates the SoundPool, reloads assets, and restarts active Geiger loops. iOS retains its existing playback session and hides this Android-only choice.
- TTS is initialized lazily when rules include a `tts` message and speech plays as soon as possible. Do not pre-generate or cache message audio.
- Message alerts vibrate once, same as one-shot preset alerts.
- If multiple spoken messages compete, the most urgent alert wins and may stop a less urgent spoken message.
- Spoken messages play over active geiger ticks; geiger loops are not paused or ducked.
- Preview supports `tts` templates with sample placeholder values and plays the severity sound first.
- There is no app-level template length limit beyond what native storage and the platform can handle.

## Alert Presets

Native generates and persists preset Alert Rules. JS sends preset intents and renders saved rules.
Unsaved add-board drafts call the synchronous native `previewAlertPreset` operation, which uses
the same generator without reading or writing the database. Fixed rules carry concrete thresholds;
a preset the rider opts into matching carries a durable relationship to a board config field instead. Native resolves that
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

A rider picks one **level** per **metric**. `applyAlertPreset` accepts a select, customize,
discard-custom, or match-board-config intent. Native reads that Board's persisted settings and
configuration, then commits the selection and rule changes in one database transaction. A failure
rolls the whole operation back; neither the selected level nor part of its rule set survives alone.

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

Preset values, sound types, and config-relative offsets live in
`modules/vescape-core/shared/alert-preset-definitions.json`. Both native generators consume this
single definition. Edit that file to change preset values. JS formats returned rule snapshots and
does not implement preset generation.

### Provenance & regeneration

Preset rules carry `source = "preset"` (`ALERT_PRESET_SOURCE`) with deterministic ids
(`preset:<metric>:<index>`) and the owning Board's `board_id`. Changing a level replaces that
metric's preset rows inside the same transaction that updates the durable `alertPreset` Board
Settings bag. Manual rules and other metrics survive. Native also updates affected presets in the
Board-save transaction when their generation inputs change.

Saved-board markers, descriptions, chart references, and sound previews read saved Alert Rules.
Config-relative values are resolved for display from the Board's current configuration; unresolved
relations remain stored but do not draw markers or fire. JS never regenerates persisted rules when
configuration arrives. Before session evaluation, native restores missing matched-preset relations
left by older JS saves, preserving existing rules and disabled states. Native reloads evaluation
after committed writes and publishes an `alerts`
data-change event; JS reloads after that event and on foreground catch-up.

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
applyAlertPreset(boardId, metric, { action: 'select', level: 'normal' })
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
