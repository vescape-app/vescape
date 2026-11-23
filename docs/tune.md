# Tune Screen Reference

## Tune Preview model

The flat-response Tune Preview uses model version `refloat-bundled-legacy-v18`, tied to
`modules/vescape-core/android/src/main/assets/refloat-settings.xml`. It is a deterministic Refloat
controller simulation around a simplified Board plant. Pitch Input adds a bounded pitch rate
of up to `130°/s` while held. A symmetric quadratic ease-out makes the center more responsive:
25% travel requests about 44% of maximum rate, 50% requests 75%, and the endpoints remain 100%.
The control reports that requested rate in `°/s` instead of an abstract percentage. Changes are
smoothed before reaching the controller so gesture input does not shake Board. It does not set,
anchor, or constrain Board angle and does not model rider weight or pressure. Refloat PID reacts to
the accumulating Board/Target error, and its current changes optional dynamic speed. Releasing the
gesture stops adding pitch error and lets the tune recover Board from its current state.

Longitudinal preview speed uses the bundled schema's documented reference conversion for the
default 11-inch tire and 30-pole Hypercore motor: `3.5 km/h = 1000 ERPM`. Advanced settings scale
that conversion using the configured wheel diameter and motor pole count. PID, Torque Tilt, ATR, and Brake Tilt behavior is
derived from Refloat v1.2.1 `pid.c`, `torque_tilt.c`, `atr.c`, `brake_tilt.c`, and `main.c`
(GPL-3.0-or-later). ATR includes Refloat's fixed `8 A` rolling offset and nonlinear response above
`25 A`. Same-direction Torque Tilt and combined ATR/Brake Tilt use the larger offset, as in firmware.

Tune Profiles saved before the ERPM thresholds entered the app allowlist use the bundled schema
defaults (`500 ERPM` constant, `0 ERPM` variable). The preview labels this fallback; fresh profiles
retain the decoded fields explicitly.

Optional preview hills are a moving spatial sinusoid. Height is the physical valley-to-peak rise,
spacing is the peak-to-peak distance, and scenario speed advances phase in real meters. Terrain and
the reference 11-inch wheel share one pixel-per-meter scale; large hills therefore extend beyond
the viewport instead of being visually compressed. Terrain slope feeds a synthetic measured-
acceleration disturbance into the legacy ATR equations. The disturbance is gravity projected along
the grade (`g * slope / sqrt(1 + slope²)`), so a 10% grade contributes about `0.98 m/s²`. It never
forces Board pitch to the terrain tangent and does not model traction, suspension, or collision.

The physical model is always active and converts terrain and controller effort through estimated
Board setup values. Its collapsed `Advanced settings` accordion exposes combined Rider + Board
mass, motor preset and torque constant, motor current limit, wheel diameter, motor pole count,
drivetrain efficiency, Rider + Board center-of-mass height, and pitch damping. Defaults are
`88 kg`, `60 A`, `11 in`, `30` poles, `85%`, `0.9 m`, and `30 /s`. Available motors are FM Hypercore
`0.68 Nm/A`, SuperFlux HS `0.56`, SuperFlux HT `0.75`, CannonCore V2 `0.68`, or CannonCore V3
`0.75`. The estimate is:

```text
total mass = Rider mass + Board mass
gravity force along grade = total mass * g * slope / sqrt(1 + slope²)
wheel torque = gravity force * wheel radius
hill-load current = wheel torque / (motor torque per amp * drivetrain efficiency)
ATR disturbance = hill-load current / configured ATR amps-to-acceleration ratio
```

The estimated total motor current also feeds Torque Tilt and Brake Tilt through an ATR-frequency
low-pass filter. With dynamic speed, motor
current is converted through the configured torque constant, wheel, efficiency, and total mass,
then gravity along the grade is subtracted. Board pitch uses the PID balance-current component,
while hill-load current remains part of total motor current and longitudinal speed; this prevents
terrain feed-forward load from suppressing Board's correction toward Target. Released deck pitch converts that acceleration around
the configured Rider + Board center-of-mass height and includes configurable passive pitch damping for the rider, tire, and
drivetrain. It intentionally does not add free inverted-pendulum gravity: without a model of rider
body position and ankle response, that term creates energy that does not represent a real Board.
The pitch plant includes a calibrated balance-authority factor because translating wheel acceleration
around center-of-mass height alone underestimates the fast rotational response of a balancing Board.
This lets Board follow adaptive ATR/Torque Tilt targets without a flat-ground limit cycle at ±60 A.
The right-side preview readout labels this value as `Motor ±… A`; it is the estimated total motor
current, not battery current.

The preset torque constants are scenario estimates, not known Tune Profile values. The result is
therefore a comparison tool, not a calibrated prediction of real motor current.

Preview speed is always dynamic: it starts at `15 km/h`, and tune-derived controller current changes
it through the always-active physical model. The reset button beside the speed readout restores
`15 km/h` and clears the measured-acceleration derivative so the reset does not create a false ATR
impulse. Speed remains within `-50..50 km/h`; signed ERPM preserves direction while Refloat speed
thresholds use its magnitude. Pitch Input can therefore carry Board through zero into reverse. The
evolving value feeds the existing ERPM, tilt, ATR, terrain-phase, and ground-travel paths. The model
does not predict an exact real braking distance, power, traction, deck-ground contact, rider body
movement, or safety.

With Hills disabled, the flat-ground travel marks are spaced every `1 m`; this is four times less
dense than the previous `0.25 m` marks so speed is easier to judge visually.

This document captures practical tune-screen behavior used by a Refloat-focused
board app. It is intended as product and implementation reference for building a
safe tuning UI in this app.

The important design pattern is a two-layer tuning model:

- Basic mode exposes a small set of rider-facing sliders.
- Detailed or advanced mode exposes the underlying Refloat fields directly.

Basic sliders are not merely labels for single config values. Some sliders write
multiple low-level fields, and some use a different rider-facing name from the
underlying firmware concept.

## Basic Slider Model

Basic sliders map rider-facing controls onto one or more Refloat fields (canonical definitions, ranges,
and interpolation/inverse formulas live in `src/modules/tune/lib/sliderDefinitions.ts`):

- **Aggressiveness** (`-5..10`) is compound: it writes `kp`, `kp2`, `ki`, and inversely moves
  `mahony_kp` / `mahony_kp_roll` together (coordinating PID and IMU filter feel, not just "more PID").
- **ATR intensity** (`0..15`) writes both `atr_strength_up` and `atr_strength_down` equally; its
  displayed value tracks `max(atr_strength_up, atr_strength_down)`.
- **Nose stiffness**, **Tail stiffness**, **Carve tilt**, and **Brake tilt** map to single fields.

Opening an editor and applying without changing anything preserves saved values. Basic controls
display actual linked values until the dial moves; editing a single linked field preserves unequal
siblings (e.g. asymmetrical ATR uphill/downhill strengths), while moving a compound basic slider
collapses that custom shape back onto the basic formula. Individual field editors keep raw values in
profiles, open in ruler mode with manual numeric entry available without snapping, warn on values
outside the ruler's usual range without blocking Apply, and convert percentages only at display/input
boundaries.

Field naming note: Refloat's canonical field IDs are the serialized struct names from `<SerOrder>`,
not VESC Tool `cDefine` defaults (e.g. `atr_strength_up` / `atr_strength_down`).

## Wire Protocol & Persistence Model

There are two separate Refloat tuning channels:

- **Custom config read/write (`COMM_GET_CUSTOM_CONFIG_XML` / `GET` / `SET`):** full persisted binary controller struct (the path Vescape uses for Tune Profiles — see [ADR-0035](./adr/0035-board-config-is-exclusively-owned-while-connected.md)).
- **Runtime tune commands (`COMM_CUSTOM_APP_DATA`):** temporary live commands that do not persist without `SAVE_TUNE`. Do not mix these casually with full-config writes.

### Custom Config Read Flow

The board exposes custom config metadata and bytes through VESC custom config
commands. On a CAN-forwarded controller, each command is wrapped as:

```text
[COMM_FORWARD_CAN, canId, command, ...args]
```

Relevant custom config commands:

| Command                          |   ID | Purpose                                                         |
| -------------------------------- | ---: | --------------------------------------------------------------- |
| `COMM_GET_CUSTOM_CONFIG_XML`     | `92` | Read the XML/schema for a custom config index.                  |
| `COMM_GET_CUSTOM_CONFIG`         | `93` | Read the current binary config bytes for a custom config index. |
| `COMM_GET_CUSTOM_CONFIG_DEFAULT` | `94` | Read default binary config bytes.                               |
| `COMM_SET_CUSTOM_CONFIG`         | `95` | Write binary config bytes back to the controller.               |

Observed read sequence:

1. Discover or already know the motor controller CAN id.
2. Fetch XML/schema chunks with `COMM_GET_CUSTOM_CONFIG_XML`.
3. Reassemble the XML bytes until the returned total length is complete.
4. Parse the XML into ordered fields, value types, scale factors, labels, units,
   and min/max metadata.
5. Fetch current config bytes with `COMM_GET_CUSTOM_CONFIG`.
6. Decode only allowlisted tune fields using XML-derived offsets and types.
7. Return a snapshot containing decoded groups, missing field IDs, schema hash,
   raw config hash, config byte length, CAN id, board id, capture time, and
   firmware string if available.

The XML request carries:

```text
[92, confIndex, requestedLength:uint32, offset:uint32]
```

The XML response carries:

```text
[92, confIndex, totalLength:uint32, offset:uint32, chunk...]
```

The config bytes request carries:

```text
[93, confIndex]
```

The config bytes response carries:

```text
[93, confIndex, packageSignature:uint32, encodedConfigBytes...]
```

For Refloat package config, `confIndex` is `0`.

**Android XML parser trap**: Android's DOM provider rejects desktop JVM SAX external-entity feature flags (desktop tests pass, but real Android linking fails with `UNSUPPORTED_SCHEMA` and stalls 30 s). `RefloatConfigSchema.kt` keeps `DOCTYPE` rejection with a rejecting entity resolver instead (iOS uses `XMLParser.shouldResolveExternalEntities = false`). Because neither desktop JVM tests nor E2E (`e2eFake.finalizeBoardLink`) catch this provider difference, verify Android XML parser edits on a device/emulator with `RefloatConfigSchemaDeviceTest`:

```sh
cd android && ./gradlew :vescape-core:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.vescapecore.config.RefloatConfigSchemaDeviceTest
```

### Custom Config Write Flow

Persistent config writes should be treated as full-config writes, not individual
field writes.

The write command payload shape is:

```text
[95, confIndex, packageSignature:uint32, encodedConfigBytes...]
```

For a safe write flow:

1. Read the current XML/schema.
2. Read the current binary config bytes.
3. Decode the fields into a local draft.
4. Apply UI changes to the draft.
5. Re-encode the full config using the same schema/signature.
6. Send `COMM_SET_CUSTOM_CONFIG`.
7. Confirm success or failure before updating UI state.
8. Re-read the config after saving when possible.

The full-config rewrite matters because the controller stores a binary struct,
not independent key/value pairs. Unknown fields must be preserved exactly. A
write implementation should never create a config from only the visible tune
fields.

#### Which fields a push writes

`pushProfileToBoard(profileId, fieldIds)` patches only the named fields, with values read from the
stored Tune Profile, into the fresh write base (or a fresh read). The rest of the struct is kept
byte for byte. A push that names no fields, or a field the stored profile lacks, fails with
`CONFIG_VALUE_INVALID`.

- **Save & sync** writes only the fields the rider edited in that save. Saved fields that already
  differed from the board (board drift) are left alone. The sync bar shows them next to the
  unsaved count ("N other fields differ from board, not sent").
- **Send to board** applies the whole saved profile. It writes every profile field that differs
  from the last board snapshot, and it skips the native call when there are none.

The encoder checks every field before it writes any byte and rejects the whole write with
`CONFIG_VALUE_INVALID` for an id not in the schema, a non-number for a numeric field, a non-finite
value, or a value the wire type and scale cannot hold. Integer and scaled values round half up
before the range check. `BOOL` fields accept a boolean or exactly `0`/`1`. Tune field ranges in
`src/modules/tune/lib/fields.ts` stay inside each field's wire limit, and manual entry rejects
values outside it.

#### Idle board gate

A push is refused with `BOARD_NOT_IDLE` unless the latest Refloat telemetry is fresh (received
within `TELEMETRY_STALE_MS`, 4 s) and shows the board idle: the state is not RUNNING, TILTBACK or
WHEELSLIP (`isRefloatEngaged`), and handtest (bit `0x08` of the ALLDATA switch-state byte) is off.
UPSIDEDOWN and FLYWHEEL do not count as engaged. The gate runs when the push starts and again
right before `COMM_SET_CUSTOM_CONFIG` is sent.

Known limitation: polling is paused for the whole config operation (and iOS swallows
`COMM_CUSTOM_APP_DATA` while one is in flight), so no new telemetry usually arrives between the two
checks. The pre-SET check therefore judges the latest sample against the operation start time
minus the stale window rather than against "now". It catches samples that do arrive mid-operation,
but it cannot see an engagement that starts during a schema/config read.

#### Read-back verify and uncertain outcomes

After the SET ack the app reads the config back and compares it byte for byte with what it
wrote. The one expected difference is `meta.is_default`: Refloat clears it on a config write, so
when the schema has that field the verifier expects `0` there.

Once SET has been sent, any failure (verify mismatch, timeout, GATT failure, or a lost link while
waiting for the ack or the read-back) leaves the board state unknown. The app then demotes the
in-memory Board Config Values to last known and drops the write base, so the next push does a
fresh schema and config read instead of patching bytes that may no longer match the board.
Failures before SET (invalid values, read failures) keep the write base.

### Refloat Runtime Commands

Refloat also exposes package-specific tune commands over
`COMM_CUSTOM_APP_DATA` (`36`) using the Refloat package id (`101`). These are
separate from full custom config persistence. The runtime channel includes tune
commands, live control commands, accessory controls, and read commands.

Relevant package command IDs:

| Command            |    ID | Purpose                                                                          |
| ------------------ | ----: | -------------------------------------------------------------------------------- |
| `FLYWHEEL`         |  `22` | Apply flywheel-related runtime action.                                           |
| `LIGHT_INFO`       |  `25` | Read light controller/runtime light info.                                        |
| `LIGHT_CTRL`       |  `26` | Apply live light control values.                                                 |
| `LCM_INFO`         |  `27` | Read LCM-related info.                                                           |
| `GET_INFO`         |   `0` | Read package/device info (`REFLOAT_GET_INFO`).                                   |
| `GET_RTDATA`       |  `34` | Read runtime data.                                                               |
| `SET_TUNE`         |  `35` | Apply tune values at runtime.                                                    |
| `SET_DEFAULT_TUNE` |  `36` | Apply/reset default tune values.                                                 |
| `SAVE_TUNE`        |  `37` | Persist current tune state.                                                      |
| `RESTORE_TUNE`     |  `38` | Restore saved tune state.                                                        |
| `TUNE_OTHER`       |  `39` | Apply miscellaneous tune values.                                                 |
| `RC_MOVE`          |   `7` | Refloat 1.0–1.2 app move command: spin motor while board is idle. Not tilt.      |
| `REMOTE`           |  `15` | Refloat 1.3+ app remote input command; also drives app move while board is idle. |
| `BOOSTER`          |  `41` | Apply booster-related runtime action.                                            |
| `LOCK`             |  `45` | Toggle package-level lock state.                                                 |
| `TONE`             | `210` | Tone/horn/playback runtime channel.                                              |

This implies two possible edit strategies:

- Full config strategy: edit a local full config draft and persist through
  `COMM_SET_CUSTOM_CONFIG`.
- Runtime tune strategy: send Refloat tune commands for immediate behavior
  changes, then explicitly call `SAVE_TUNE` if the change should survive
  restart.

Do not mix these paths casually. A runtime tune command may affect live behavior
before a full config save, while a full custom config write may replace values
that were changed through runtime tune commands. The UI should present clear
draft/apply/save semantics if both paths are ever supported.

### Runtime Channel Capability Summary

The custom app data channel is not limited to tune sliders. It is a small
Refloat-specific runtime API. Confirmed categories:

| Category                 | Commands                                                                         | Can Change On The Fly                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime data reads       | `GET_INFO`, `GET_RTDATA`, `GET_ALL_DATA`, `PRINT_INFO`, `LIGHT_INFO`, `LCM_INFO` | Nothing persisted; reads package version, board state, angles, input tilt, throttle, speed/duty, and light/controller metadata.                                                                                                                                                                                                                                 |
| Tune editing             | `SET_TUNE`, `SET_DEFAULT_TUNE`, `TUNE_OTHER`, `BOOSTER`                          | Live tune state and helper/advanced tune values. These affect behavior immediately but should be considered temporary until saved.                                                                                                                                                                                                                              |
| Tune persistence actions | `SAVE_TUNE`, `RESTORE_TUNE`                                                      | Save current runtime tune state or restore saved tune state. These are actions, not field writes.                                                                                                                                                                                                                                                               |
| Movement / tilt input    | `MOVE`, `LOCK`, `FLYWHEEL`                                                       | Live movement, Remote Tilt input, lock state, and flywheel-related action. Treat as immediate control input.                                                                                                                                                                                                                                                    |
| Lighting                 | `LIGHTS_CONTROL` (20, or 202 before Refloat 1.2), `LCM_LIGHT_CTRL` (26)          | Two channels: `LIGHTS_CONTROL` switches Refloat's own lights and headlights (mask + value bits), while `LCM_LIGHT_CTRL` writes brightness levels to an external light module. `LIGHTS_CONTROL` was renumbered and its mask widened in Refloat 1.2.0, and pre-1.2 it writes config rather than a runtime override. See [refloatAlldata.md](./refloatAlldata.md). |
| Sound / tones            | `TONE`                                                                           | Tone support/version, horn, play, and stop actions. Tone handler install is a separate script/LISP flow; playback control then uses the `TONE` runtime channel.                                                                                                                                                                                                 |

The practical split is:

- Runtime data reads are safe polling commands.
- Tune commands alter live balancing behavior and need explicit save semantics.
- Movement/flywheel/chuck-style commands can create motor output and need an
  arming/neutral/disconnect safety design.
- Lighting and tones are accessory runtime controls, not board tune settings.

### Remote Tilt and Move Controls

Floaty's `MOVE` channel is live remote-control input, not a direct angle
setter. It can drive forward/reverse board input. When Remote Tilt is enabled,
the board maps that same input into dynamic tilt according to its configuration.
These features combine a persistent configuration gate with a short-lived
runtime command stream.

There are two setup/config pieces:

- `inputtilt_remote_type`: enables Remote Tilt input. Values are `None = 0`,
  `UART = 1`, `PPM = 2`. The app-controlled path uses the UART-style mode
  (`1`) when enabling Remote Tilt from the UI and writes `0` when disabling it.
- Remote Tilt behavior is then constrained by normal config fields:
  `inputtilt_angle_limit`, `inputtilt_speed`,
  `inputtilt_invert_throttle`, and `inputtilt_deadband`.

Important Remote Tilt field behavior:

| Field                       | Behavior                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputtilt_angle_limit`     | Maximum dynamic tiltback angle. The board scales input percentage into this angle. Example: a 10 degree limit with 50% input gives a 5 degree tilt target. |
| `inputtilt_speed`           | Rate limit for moving toward the requested tilt angle, in degrees per second.                                                                              |
| `inputtilt_invert_throttle` | Direction mapping. Default `true` means forward input lowers the nose and backward input lifts the nose.                                                   |
| `inputtilt_deadband`        | Center deadband before input starts changing the setpoint. Example: 10% deadband ignores the first +/-10% around center and rescales from there.           |

When Remote Tilt is toggled from the UI, the flow is:

1. Read current custom config with `COMM_GET_CUSTOM_CONFIG`.
2. Clone the current config object.
3. Replace only `inputtilt_remote_type` with `1` when enabled or `0` when
   disabled.
4. Encode the full config payload with the current schema.
5. Write it back with `COMM_SET_CUSTOM_CONFIG`.

The live slider input is then sent separately as VESC chuck (Nunchuk) data,
which Refloat reads as its UART remote when `inputtilt_remote_type` is `1`:

```text
[COMM_SET_CHUCK_DATA, 0, 255 - value]
```

Floaty Android v3.0.0 was used as the protocol reference. `value` is the
`0..255` slider with `128` as the rest/neutral position; the second data byte is
the chuck Y axis, inverted to `255 - value`. The board maps this to a tilt
target via `throttle_val * inputtilt_angle_limit` (see `float.c`), so the input
sets dynamic nose tilt while riding. `inputtilt_invert_throttle` flips the
direction. The board drops the remote input after roughly one second of silence,
so the app repeats the active value on a fixed 100 ms tick (`REMOTE_TILT_REPEAT_MS` —
matching Board Move's remote cadence without starving telemetry polling). This is runtime
input only; it never writes configuration.

The UI is a 2D pad rather than a 1D slider. The horizontal axis is the tilt
value above; the vertical axis sets a release decay time (bottom = instant snap,
up to `60 s`). The top band of the pad is a **lock** zone: releasing there holds
the tilt indefinitely (the live hold stream just keeps running) until the user
cancels. While the finger is down the app streams the held tilt live. On a
normal release it hands off to a linear ease: the held value is interpolated back
to `128` (neutral) over the chosen duration, one step per 100 ms tick, then the
stream stops. The decay is owned natively (`RemoteTiltController`) and is
tick-based, so JS only sends the intent (`value`, `durationMs`). A duration
shorter than one tick snaps straight to neutral.

Do not confuse this with **Board Move**. Board Move drives motor output while
the board is disengaged/ready and has nothing to do with tilt — it is not used
for Remote Tilt.

There are two observed Refloat protocol generations:

- Refloat 1.0–1.2 uses `RC_MOVE` (`7`). Payload:
  `[direction, current, time, current + time]` after the package id and command.
  `direction = 1` moves one way and `0` flips current negative. `current` is
  tenths of amps and is clamped by firmware; `time` is `time * 100` control-loop
  steps, and that loop ticks at ~832 Hz, so one unit is only ~120 ms — not the
  second it reads like. Firmware also zeroes its move current and ramps back to
  the target on every request, so a re-send costs a short dip. A stop-ish command
  is `[1, 0, 1, 1]`.
- Refloat 1.3+ uses `REMOTE` (`15`). Payload is one signed byte after the
  package id and command. The firmware maps `-127..127` to `-1..1` remote input
  (`-128` is ignored). It then derives move speed from configured
  `remote.max_move_speed` (or defaults app remote control to 5 km/h when that
  value is 0).

Firmware-side safety differs by generation but both paths apply move output only
from the disengaged/ready state: 1.0–1.2 `cmd_rc_move` ignores commands unless
`state == STATE_READY`, and 1.3+ requests move torque only while
`state == STATE_READY`.

Moving the board forward/backward while disengaged is governed by the Remote
Throttle config fields:

| Field                          | Behavior                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `remote_throttle_current_max`  | Refloat 1.0–1.2 maximum current available for physical remote throttle when the board is disengaged. `RC_MOVE` carries its own current byte, but firmware still gates it to `STATE_READY`. Default is `0 A`; recommended values in the schema are `5..10 A`. |
| `remote.max_move_speed`        | Refloat 1.3+ maximum move speed for physical/app remote move. When set to `0`, app remote control defaults to 5 km/h.                                                                                                                                        |
| `remote_throttle_grace_period` | Delay after disengagement before physical remote throttle is allowed. Refloat 1.3+ app remote input uses a fixed 2 second disengage grace in `remote_command_input`. Default config value is `10 s`.                                                         |

Safety implication: this feature can spin the motor from the app. A production
implementation should require an explicit arming state, show a hazard warning,
rate-limit live writes, send neutral/stop on release and disconnect, and avoid
persisting `inputtilt_remote_type = 1` unless the user explicitly wants Remote
Tilt enabled after leaving the screen.

#### Board Move as shipped

The Board Settings drawer wires Board Move as a collapsible row: tapping it opens
two hold buttons plus a strength stepper. Holding a direction button streams
`±(127 × strength%)` and releasing sends a neutral stop. Strength is the
persisted `boardMoveStrengthPercent` setting (10–100%, default 60). `BoardMoveController` (both platforms) owns the
repeat tick — 100 ms for 1.3+ `REMOTE`, and 700 ms for 1.0–1.2 `RC_MOVE` (because `RC_MOVE` zeroes and
re-ramps current on every packet, so repeating inside its ~1 s duration avoids ten-times-per-second
stutter) — and the wire format is picked from the linked
`refloatBaseVersion` (`RC_MOVE` below 1.3, `REMOTE` from 1.3 up; unknown
versions assume `REMOTE`). The commands need a trusted link and stop with the
Board Session.

Safety is currently firmware-side only (ready-state gating, the 1.3+ 2s
disengage grace, and the board's own `remote.max_move_speed` /
`remote_throttle_current_max` clamps). There is no in-app arming state or hazard
warning yet.

### Version Compatibility

The decoder remains schema-driven, but Tune Profile reuse is Refloat-version-scoped:

- Read the board's custom config XML/schema before decoding raw config bytes.
- Use the schema serialization order for binary offsets.
- Use schema-provided field type, scale, label, unit, min, and max.
- Decode only known/allowlisted fields.
- If an allowlisted field is absent, omit it and report it as missing instead
  of guessing an offset.
- If the schema shape or field type is unsupported, fail closed instead of
  writing or displaying potentially wrong values.

The firmware version string is useful diagnostics, but it is not the primary decoder. A board can
expose a different schema on the same nominal firmware family, and the XML schema is the source of
truth for field order and encoding.

Tune Profiles are not migrated across Refloat major/minor versions. A profile created
under one base version is retained for that version and hidden from normal use when the board
reports a different base version. Suffixes and fork labels stay in the exact Refloat version used
for link integrity, but they do not split Tune Profile compatibility. If the board later returns to
the old base version, those profiles can be shown again. When no profile exists for the current
trusted base version, the rider explicitly creates one from the current board config.

Known version-sensitive field semantics:

| Area                      | Affected fields                        | Compatibility note                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High/low voltage pushback | `tiltback_hv`, `tiltback_lv`           | Refloat 1.2 with VESC firmware `6.05+` supports per-cell values below `10 V` while retaining total pack values. Older `6.02` setups use only total pack voltage, e.g. `4.3V * cell_count` for high voltage and `3.0V * cell_count` for low voltage. |
| I term limit              | `ki_limit`                             | Older firmware exposed this concept as `Deadzone`; the modern value is scaled up 10x. A previous `Deadzone = 3` corresponds to `ki_limit = 30A`.                                                                                                    |
| ATR strength              | `atr_strength_up`, `atr_strength_down` | Older `5.3 ATR` values are scaled 10x smaller. A previous ATR strength of `0.10` corresponds to modern `1.0`.                                                                                                                                       |
| BMS temperature alert     | BMS temperature threshold fields       | Some BMS-related options require VESC firmware `6.06+` and sufficiently recent BMS firmware.                                                                                                                                                        |
| Parking brake             | `parking_brake_mode`                   | Firmware `6.05+` applies parking brake by shorting motor phases; older behavior may differ.                                                                                                                                                         |
| Audible feedback          | haptic/audible feedback fields         | Some generated tones rely on `foc_play_tone` behavior from firmware `6.05`; other modes use current modulation instead.                                                                                                                             |

For our app, this means tune read/write support requires a trusted Board Link with known Refloat
package version. Writes are still gated by schema validation and field presence, but profile
visibility is gated by Refloat major/minor version; patch versions and suffixes share profiles. The app does not silently convert old tune values
to new Refloat versions.

### Basic and Detailed Asymmetry

Basic sliders recompute their displayed positions from underlying fields (`src/modules/tune/lib/sliderDefinitions.ts`).
Because **ATR intensity** displays `max(atr_strength_up, atr_strength_down)` and overwrites both fields on edit — and **Aggressiveness** overwrites five fields — moving a compound basic slider collapses custom detailed asymmetry back onto the basic formula. Treat basic sliders as compound controls, not harmless field aliases.

## Profile selector summary

The quick-settings Tune card summarizes the saved selected profile with five
segments per metric. Aggression uses the Basic Aggressiveness slider (`kp`), Turning uses
Basic Carve Tilt (`turntilt_strength`), and ATR uses Basic ATR intensity (the stronger of uphill
and downhill strength). Each existing Basic slider range is normalized to 0–5 and rounded to
the nearest segment; custom values are clamped to that range. Missing or non-finite sources
show an unavailable dash, distinct from a valid zero. These summarize configured strengths,
not measured handling or a simulated ride rating. Unsaved editor changes do not change the
saved profile summary.
