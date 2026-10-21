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
a saved theme keeps its id and sounds the same. Settings previews the selected pack's slots: its
cues and its Positive/Info/Warning/Critical sounds.

Every effects pack fills four required sound slots, `severity.positive|info|warning|critical`.
`positive` exists only for app cues: it is not an alert severity, so alert rules, `alert(<count>):`
and `tts(…)` stay info/warning/critical. App cues with an optional slot of their own fall back to a
required slot when the pack leaves theirs out:

| App cue           | Slot                    | Missing ⇒ |
| ----------------- | ----------------------- | --------- |
| Connect           | `cue.on`                | positive  |
| Disconnect        | `cue.off`               | warning   |
| Ride end          | `cue.ride.end`          | info      |
| New Group Ride    | `cue.groupRide.created` | positive  |
| Joined Group Ride | `cue.groupRide.joined`  | positive  |

The other app cues have no slot and always play a fixed severity sound: Error ⇒ critical, Rider
joined ⇒ info, Rider left ⇒ warning, Group Ride lost ⇒ warning, Group Ride restored ⇒ positive.
Their voice lines are unchanged and still speak at Voice level Full. Ride end plays when the ride
dropout grace expires after a lost link, the point at which a Board Session ride is treated as
ended.

### My sounds and overrides

**My sounds** is the rider's library of named sounds: add (import), rename, delete, preview. Imports
accept decodable WAV, M4A or MP3 (recognized by the file header) up to 2 MB and 15 seconds; the document picker source is copied, so its URI is
never used for later playback. Native owns the store (`MySounds.kt`, `MySounds.swift`):
`custom-app-sounds/my-sounds.json` (`{ sounds: [{id, name}], overrides: {slot: id} }`) plus one
`<id>.<wav|m4a|mp3>` per sound.

**Overrides** are a fixed list of slots, each optionally set to a My sound that wins over the
effects pack: `severity.positive` (app cues), the `severity.info|warning|critical` sounds (alert
rules, app cues, and the sound before TTS speech), `cue.on`, `cue.off`, `cue.groupRide.created`,
and `cue.groupRide.joined`. Clearing one returns the slot to the pack. Native drops stored overrides
for slots that are no longer in the list. Ride end and geiger ticks are not overridable. Deleting a sound
clears its overrides.

Optional cue slots resolve at lookup: the slot's own override, else the pack's clip, else (when the
pack leaves the slot out) the same lookup for its fallback slot. So a Positive, Info, or Warning
override also covers the cues that fall back to it, e.g. Connect in a pack without `cue.on` plays
the Positive override.

Custom rules can pick any My sound: `alert(<count>):my:<id>` for single rules, `geiger:my:<id>` for
range rules. A sound that is gone or fails to decode falls back to the parsed pack slot (`warning`
or `soft`), never silence. Previews and alert tests resolve the same way. One-shot My sounds play whole (Android
MediaPlayer, iOS the alert engine); a geiger tick plays from the low-latency pool, which on Android
caps a decoded clip near 1 MB (about 6 s of 44.1 kHz stereo).

The custom app sound packs My sounds replaced (`custom-app-sounds/packs.json`) migrate on first
read: every assigned cue becomes a My sound named `<pack> <cue>`, reusing its file. On the next
settings read, the pack the `soundPack` setting still named becomes overrides for its cues and the
setting resolves to Simple; the other packs' sounds stay plain library entries.

Database backups include the manifest and audio files under `custom-app-sounds/`. Android copies the
files and manifest under the store lock before writing the archive. Restore retains the previous
database and sound files until both have installed; a failed sound install rolls both back.
Restoring an older backup without these entries clears My sounds; one carrying `packs.json`
migrates as above. A restored sound whose file is absent is dropped with its overrides.

## Voice

Speech comes from a second app-wide choice next to Sound effects:

- **Voice** (`voice` setting: `matching`, `hev`, `clean`; default `matching`): whole-sentence lines
  per message key plus value clips. Unset (`matching`) plays the voice the effects pack's `pack.json`
  names (HEV → HEV; Retro, Simple, Clean → Clean); Settings shows that voice as selected, with no
  separate Matching option. Picking a voice level previews it.
- **Voice level** (`voiceLevel`: `off`, `standard`, `full`; default `standard`): Off plays effects
  only for presets, Standard speaks preset alerts. Full also speaks app cues and Group Ride events:
  the cue's effect, then its voice line (`on` → `link.connected`, `off` → `link.lost`, `error` →
  `system.error`, `ride.end`, and each `groupRide.*` cue under its own key). Off and Standard play
  their effect only; settings previews of a pack's cues never speak. Voice level never affects
  custom rules.
- **Group Ride cues**: `groupRide.created` (a new nearby or own ride; JS fires it, the nearby
  filter lives there), and natively from `GroupRideObserver`: `groupRide.joined` (the rider joined),
  `groupRide.riderJoined` / `groupRide.riderLeft` (someone else in the joined ride's roster),
  `groupRide.lost` (the joined ride's relay socket dropped), `groupRide.restored` (rejoined after a
  loss). All are gated by the app sounds switch (`connectionSoundsEnabled`).

A `voice(<severity>):<key>:<value>` sound plays the effects pack's `severity.<severity>` sound
once, then the voice line, starting once the sound has finished (the same timing as TTS). Native
joins the line's `start` clip, the value clip, and the `end` clip into one PCM buffer
(`VoicePacks.kt`, `VoicePacks.swift`) and plays it: Android through a static `AudioTrack` on the
selected alarm/media stream, iOS through the player's `AVAudioEngine`. Leading encoder priming and
silence (at most 2048 frames) is trimmed from each clip before joining. Line clips of the selected
voice are decoded in the background when sound settings apply; value clips decode on first use and
stay cached.

- **Key**: from the sound string, else from the rule's metric (`battery` → `battery`, `motor-temp` →
  `motorTemp`, `controller-temp` → `controllerTemp`, `speed`, `duty`). No key: severity sound only.
- **Value**: from the sound string, else the rule's (effective) threshold. Battery speaks a
  percent, so a battery rule without a battery percent speaks no value. Speed is km/h, read in mph
  under imperial units. Degrees are °C, converted
  to °F under imperial units before rounding to the nearest clip (degree clips say only
  "degrees", −30…300). A missing value clip is skipped.
- **Line**: `<key>.<severity>`, else the generic `<key>`, else none (severity sound only, never
  silence). The fallback resolves first, then variants are picked at random per part (`start` and
  `end` independently; an `end` of `""` is "none"); the same `start` never repeats twice in a row
  for a key and severity. The pick for the next announcement of a line is made and joined in the
  background right after each one plays, so variety adds no latency.

**Presets** (battery, motor and controller temperature) expand into `voice(<severity>):<key>`
points; severity is the point's rank in its ladder: last (most severe) `critical`, first `info`,
the rest `warning`, and a one-point ladder is `critical`.

**Custom rules** on battery (with a battery config) and temperature default to `voice(<severity>):`
on the Message tab. Its **TTS** switch turns on the text template (`tts(<severity>):<text>`).
Other metrics have no voice lines: TTS is forced on and the switch is hidden. Preview plays the
severity sound and the voice line with the threshold as value, or the TTS text. Custom rules use
the Voice pack but ignore Voice level.

Presets play the app-wide effects and voice packs; there is no per-preset pack choice.

Planned (not implemented): all sounds that can fire during a ride stay decoded in memory for the
session (#576).

### Built-in packs

Packs are committed under `shared/alerts/packs/`: effects packs are made by hand in a DAW (slots,
format, `pack.json`, adding a pack, and the HEV/Clean sox recipes are in
[`scripts/alert-packs/EFFECTS.md`](../scripts/alert-packs/EFFECTS.md)); voice packs are generated. `bun run copy:shared` copies the
effects and voice packs, keeping their `<pack>/pack.json` layout, to Android `assets/alert-packs/` and to
`modules/vescape-core/ios/alert-packs/`, which the podspec bundles as a folder in
`VescapeCoreAssets.bundle`. Native reads each `pack.json` and decodes every slot of every effects
pack at player start (`EffectsPacks.kt`, `EffectsPacks.swift`); voice packs are copied the same
way and decoded per clip (see [Voice](#voice)).

```text
scripts/alert-packs/
  EFFECTS.md            effects pack slots, format, and sox recipes (hand-made, not generated)
  catalog.json          voice keys + value type, value ranges
  voice-<id>.json       Kokoro voice + speed, sox voice fx chain, unit words, lines per key
  generate.ts           voice manifests → packs;  kokoro.py  TTS helper;  packs.ts  shared checks
shared/alerts/packs/
  effects-<id>/pack.json + <slot>.m4a            severity.*, optional cue.*, geiger.*
  voice-<id>/pack.json + lines/<key>.<start|end>.<i>.m4a + values/<type>/<n>.m4a
```

- **Effect slots**: required `severity.positive` (a short rising two- or three-note chime),
  `severity.info|warning|critical` (HEV/Clean: 1/2/3 beeps; Retro/Simple: the former Notify, Beep,
  and Urgent sounds), and `geiger.soft|mid|hard`; optional `cue.on`, `cue.off`, `cue.ride.end`,
  `cue.groupRide.created|joined`, each falling back as in [Sound effects](#sound-effects). All four
  built-in packs fill every optional slot today.
  Effects packs never contain voice; `pack.json` names the matching voice pack.
- **Voice keys**: `battery` (percent), `motorTemp`, `controllerTemp` (degrees), `speed`, `duty`
  (number), `link.connected`,
  `link.lost`, `system.error`, `groupRide.created|joined|riderJoined|riderLeft|lost|restored`,
  `ride.end`. Each key needs a
  generic line; `<key>.<severity>` variants are optional. A line is `start` (+ value) (+ `end`),
  each part a list of variants, one Kokoro call per sentence; `""` in `end` is the "none" variant
  and gets no clip. HEV and Clean ship two `start` variants per line and an optional `end` on
  critical lines.
- **Value clips**: one clip per number with its unit, spelled out (`minus five degrees.`):
  percent 0–100, degrees −30…300 (the clip says only "degrees", shared by °C and °F), number
  0–100 with no unit. Speed and duty use bare numbers and one generic line ("Speed…"), no
  severity variants: the alert is time-critical, so it stays as short as possible.
- **Format**: AAC-LC in `.m4a`, mono 22 050 Hz, 40 kbit/s, for both effects and voice. Android
  `MediaCodec` and iOS `AVAudioFile` both decode it; Ogg Opus has no iOS decoder. Native must drop
  the AAC encoder priming (~1024 samples of leading silence) before joining clips. Intermediate
  WAVs are not kept.

Regenerate voice packs on a Mac dev machine with sox, ffmpeg, and a Python that has `mlx_audio`:

```sh
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs            # all voice packs
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs voice-hev  # one manifest
KOKORO_PYTHON=/path/to/venv/bin/python bun run alerts:packs --force    # re-synthesize every voice clip
```

The generator validates the manifests against `catalog.json` before generating, builds into a
`<pack>.staging` directory, and replaces the committed pack only after the result validates. `bun test scripts/alert-packs` fails when a committed voice pack misses a
key's generic line, a value clip, or a listed file. Kokoro is not bit-stable run to run, so a
voice `pack.json` records a `sources` hash per clip (text, Kokoro settings, fx) and only clips whose
hash changed are re-synthesized. Kokoro mispronounces "error"; HEV wording says "failure".

## Per-board ownership

Alert Rules are owned by one Board. The native alert engine loads **only the connected Board's**
enabled rules at session start (and on any rule edit), so switching Boards switches the effective rule
set — engine and UI both. Deleting a Board deletes its rules. Rules for a non-connected Board never
evaluate.

Preset row ids (`preset:<metric>`) repeat across Boards; uniqueness is per Board via the
composite primary key `(board_id, id)`.

Legal Mode is durable per-Board state in `board_settings`, independent of Board-owned Alert Rule
rows. Native combines that Board's `legalMode.enabled` with the app-wide Legal Policy jurisdiction
and adds a virtual geiger speed rule whenever rules load. Nothing is written to `alerts`.

## Schema — `alerts` table

| column                 | type             | notes                                                                    |
| ---------------------- | ---------------- | ------------------------------------------------------------------------ |
| `board_id`             | TEXT             | owning Board; PK is `(board_id, id)`                                     |
| `id`                   | TEXT             | UUID, or `preset:<metric>` for an Alert Preset row                       |
| `control_id`           | TEXT             | see Control IDs below                                                    |
| `threshold`            | REAL             | trigger point                                                            |
| `threshold_max`        | REAL nullable    | range upper bound (Geiger mode)                                          |
| `enabled`              | INTEGER 0/1      | toggled by user                                                          |
| `spec`                 | TEXT             | sound string, e.g. `alert(3):warning`, `tts:Slow down`, `preset(normal)` |
| `created_at`           | INTEGER          | ms epoch                                                                 |
| `repeat_every_seconds` | INTEGER nullable | repeat cadence for a single-threshold rule; NULL is one-shot             |
| `threshold_kind`       | TEXT             | `fixed` or `config-relative`                                             |
| `config_field_id`      | TEXT nullable    | VESC config field used by a relative rule                                |
| `threshold_offset`     | REAL nullable    | start offset in alert units                                              |
| `threshold_max_offset` | REAL nullable    | range ceiling offset in alert units                                      |

A preset row uses only `board_id`, `id`, `control_id`, `spec`, and `created_at`; threshold,
repeat, enabled, and config-relative columns are ignored, because the preset definition owns them.

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
of the selected effects pack at the rule's level, `geiger:soft|mid|hard` → `geiger.<level>`. Rules
saved before the sound string grammar keep working through the parser: `preset:tick` → soft,
`preset:tick_hard` → mid, `preset:gamma` and `preset:sustained` → hard. An unknown level ticks soft;
`geiger:my:<id>` ticks with that My sound, or soft once it is gone.

The speed and duty cycle presets and the custom geiger form offer a Soft / Mid / Hard select.
On a preset it is the `geiger=<level>` option of the preset string, applied to every geiger point
the definition gives that metric; without it the definition's default plays (speed soft, duty cycle
hard). `preset(off)` keeps its options, so Off and back keeps the level. The interval shrinks linearly:

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
(Android 350 ms, iOS 200 ms; a sound longer than that, such as HEV's three-beep critical, repeats
one spacing after it ends), so a rider can give different rules different signatures. The form
offers Info/Warning/Critical plus a beep count. `alert:` means one play; an unknown severity plays
`warning`. `alert(<count>):my:<id>` plays that My sound instead, `warning` once it is gone. Strings from before the
grammar still play: `preset:notify|beep|urgent` read as `info|warning|critical`, once. Schema v50
folded the former `beep_count` column into the string (`preset:beep` + 3 → `alert(3):warning`) and
dropped it; `tts` and geiger strings were left unchanged.

The latch and repeat clock are cleared only when a new Board Session starts — not on rule edits,
preset changes, idle pause, or backgrounding. Expanded preset rules get deterministic ids
(`preset:<metric>:<index>`), so changing a preset level keeps a rule latched.

### Ready audio

Every sound a ride can play is in memory before the first alert fires, so first plays carry no load
delay:

- Starting a Board Session brings the player up (`wake`) and keeps it up until the session ends
  (`goIdle`). Android plays a looping silent track; iOS keeps its engine and `.playback` session
  running. Either way the output route, Bluetooth included, stays awake between sounds and the
  first sound after a quiet stretch is not clipped. Loaded sounds survive `goIdle`.
- All built-in effects pack slots load when the player is created (Android: on its own audio thread,
  which also runs geiger ticks, off the main looper). Installing rules (`prepare`) decodes My sounds
  for slot overrides and `my:` rules, prepares a MediaPlayer per one-shot My sound on Android, and
  decodes the selected voice pack's lines.
- A sound that still has to wait on a load queues and plays once ready; speech after it is timed
  from the sound's actual start, so the two never overlap.
- iOS sounds lease a player node from a pool of attached nodes instead of attaching one per sound.
- A sound starting 150 ms or more after its request (`ALERT_AUDIO_LATENCY_REPORT_MS`) records one
  `alert_audio_latency` Diagnostic Event (`sound`, `latency_ms`, `path`) per sound per session.

When multiple alerts fire on the same packet, SoundPool lets their clips or geiger loops overlap.
Within a single evaluation, the most urgent alert is sorted first for telemetry display
(Geiger over simple; higher threshold for above-direction controls, lower threshold for below-direction).
Single-threshold alerts then coalesce per control: only the most urgent announces, and the rest
latch silently — they are past their thresholds, so they are spent rather than pending.

## Message mode

Single-threshold alerts may use native text-to-speech by storing the spoken template directly in `spec`, with a severity variant:

```text
tts(warning):Battery {voltage} volts, {percent}%
```

`spec` is read by one sound string parser per platform (`AlertSoundString.kt`,
`AlertSoundString.swift`, `src/modules/alerts/lib/alertSoundString.ts`): `kind(variant):sound`,
split on the first `:` after the kind and optional variant, so colons inside the message are part
of the message.

- `alert(3):warning` → the pack's warning sound, 3 times (see above)
- `tts(info|warning|critical):Battery {value} {unit}` → severity sound once, then speak the template
- `tts:…` (no variant) or an unknown variant → `warning`, so rules saved before severity need no
  migration
- `voice(info|warning|critical):<key>:<value>` → severity sound once, then the voice line (see
  [Voice](#voice)); a custom rule stores `voice(<severity>):`

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

An Alert Preset is one row in `alerts` per Board and metric, id `preset:<metric>`, whose `spec` is
a preset string:

```
preset(<level>)[:<key>=<value>[,<key>=<value>…]]
preset(normal)
preset(normal):geiger=mid
preset(off):geiger=mid,match=on
```

The row holds only what the rider chose: the level and options. Every point's threshold and sound
come from `modules/vescape-core/shared/alert-preset-definitions.json`, so a changed definition
reaches every rider with no migration. Options:

| key      | values                  | meaning                                                    |
| -------- | ----------------------- | ---------------------------------------------------------- |
| `geiger` | `soft` · `mid` · `hard` | tick level for the preset's geiger points                  |
| `match`  | `on`                    | config-relative points follow the board config (see below) |

Unknown keys are ignored and kept, so an older app reads a newer row. A row exists only when it
differs from the app default, `preset(normal)` with no options: a metric without a row is the
default, and picking Normal with no options deletes the row. Board creation and migrations follow
the same rule, so defaults stay observable. Off is `preset(off)`, never a deleted row, so the app
can tell "turned off" from "never set". Battery needs a valid battery config before its preset
expands.

Native expands preset rows whenever it loads rules: the session evaluator, gauge markers,
descriptions, chart references, and previews all read the expanded list, and JS never expands.
Unsaved add-board drafts call the synchronous native `previewAlertPreset` operation, which expands
a draft preset string without touching the database. Fixed points carry concrete thresholds; with
`match=on` a point carries a relationship to a board config field instead, resolved from Last Known
Board Config Values (Refloat) or Last Known Motor Config Values (MCCONF) and following fresh
reads/writes:

| metric            | field                | config  | units    |
| ----------------- | -------------------- | ------- | -------- |
| `duty`            | `tiltback_duty`      | Refloat | fraction |
| `motor-temp`      | `l_temp_motor_start` | MCCONF  | °C       |
| `controller-temp` | `l_temp_fet_start`   | MCCONF  | °C       |

What a field id means — which config it lives in, its scale, and the value at which the board's own
protection is off (duty `1.0`) — is a property of the field, not of the rule, so it lives in one
table mirrored across TS and both platforms (`configRelativeFields`) rather than on every row. A
field that is missing, unread, or disabled leaves the relationship inactive: no sound or gauge
marker comes from it until the board supplies a value.

The rider's own Alert Rules for the same metric sit beside the preset row and fire together with
its points. The metric screen shows the level switch (and Soft / Mid / Hard for geiger metrics),
then the rider's rules, then **+ Add alert**. There is no edit of a preset's points: to replace
them, set the preset Off and add rules.

Schema v51 turned the earlier per-Board settings into these rows: each live Board gets one row per
metric from its old `alertPreset` level (none or `custom` became `off`, so nothing new started
firing; a metric whose old preset points were all disabled became `off` too, while a partly
disabled ladder kept its level), the geiger level it had chosen, and `match=on` where it matched
its board config. The
copied preset rows, the `source` column, and the `alertPreset`, `matchBoardConfig`, and
`alertPresetSound` Board Settings went; `sound_type` became `spec`.

`applyAlertPreset` sets the level or an option. Native rewrites the preset row in one database
transaction, reloads evaluation, and publishes an `alerts` data-change event.

### Levels

Four levels, safest first: **Off**, **Safe**, **Normal**, **Minimal**. `off` (and any guard failure)
expands to no rules. Safer levels add more warning points and start earlier; Minimal warns late and
only at the extreme.

### Metrics & families

Five metrics, in two feedback families:

| metric            | family   | feedback                                                           |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `battery`         | discrete | one voice rule per SoC % point; needs a valid Board battery config |
| `motor-temp`      | discrete | one voice rule per °C point                                        |
| `controller-temp` | discrete | one voice rule per °C point                                        |
| `speed`           | geiger   | one range rule, start scaled by Rider Top Speed                    |
| `duty`            | geiger   | one range rule over % duty                                         |

- **discrete** → one single-threshold `voice(<severity>):<key>` rule per configured point (see
  [Voice](#voice)).
- **geiger** → one range rule (`threshold` → `thresholdMax`); the start drops with protection while the
  ceiling stays fixed.

Both native expanders consume the single preset definition; edit that file to change preset values.

### Board Top Speed

`topSpeedKmh` (a **Board Settings** key, renamed from the former profile-level Rider Top Speed) scales
the speed preset's thresholds and the speed gauge full-scale — it is the rider's self-assessed top speed
for that Board, not a legal or firmware limit. The speed preset reads it at expansion. Missing ⇒
display default 50 km/h.

### Board Settings keys

Three per-Board keys sit beside the preset rows, backed by the `board_settings` table and composed
onto the `Board` object (like `batteryConfig`). Missing keys normalize to display defaults:

| key                     | default  | meaning                                          |
| ----------------------- | -------- | ------------------------------------------------ |
| `topSpeedKmh`           | 50       | Board Top Speed (km/h)                           |
| `alertPresetsOnboarded` | false    | one-time guided-setup gate for this Board        |
| `legalMode`             | disabled | native-owned `{ enabled }` Legal Mode activation |

### Setup surfaces

One block, `MetricAlerts`, renders a metric's whole alert setup: the preset gauge and level switch
(`AlertPresetControl`), then the rider's own rules (`AlertRuleList`) and **+ Add alert**. It renders
a `MetricAlertsController` and is reached two ways:

- **Add-board wizard** — the alerts step (`AlertsStep`) sets Board Top Speed, then one sub-step per
  preset metric, each a `MetricAlerts` over the wizard's in-memory draft (`useDraftMetricAlerts`).
  On save the levels and draft rules are written to the new Board, which is marked
  `alertPresetsOnboarded`.
- **`/control` details** — each control's detail screen shows `MetricAlerts` for the active Board
  (`useBoardMetricAlerts`), writing presets through `applyAlertPreset` and rules through the Alerts
  store.

## JS side

```ts
// store — backed by native VescapeCore APIs, bound to the active Board (#254)
store.load(boardId)                     // `startAlertsBoardSync` calls this on every active-board change
store.add(controlId, threshold, thresholdMax?)   // stamps the bound boardId
store.toggle(id)
store.remove(id)

// native API is board-scoped
applyAlertPreset(boardId, metric, { level: 'normal' })   // or { geiger: 'mid' } / { match: true }
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
