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

All formulas below use `x` as the rider-facing slider value.

Linear interpolation means:

```text
interpolate(x, [inputMin, inputMax], [outputMin, outputMax])
```

Display values are rounded after conversion to the underlying field value.

| Slider         | UI range | Step | Underlying behavior                               |
| -------------- | -------: | ---: | ------------------------------------------------- |
| Aggressiveness | `-5..10` |  `1` | Writes PID and Mahony filter values together.     |
| Nose stiffness |  `0..10` |  `1` | Writes acceleration torque tiltback strength.     |
| Tail stiffness |  `0..10` |  `1` | Writes regen/braking torque tiltback strength.    |
| Carve tilt     |  `0..15` |  `1` | Writes turn tiltback strength directly.           |
| Brake tilt     |   `0..5` |  `1` | Writes brake tiltback strength directly.          |
| ATR intensity  |  `0..15` |  `1` | Writes uphill and downhill ATR strength together. |

## Basic Slider Formulas

### Aggressiveness

The aggressiveness slider is a compound ride-feel control. It writes five
underlying fields:

| Field            | Formula                                             |
| ---------------- | --------------------------------------------------- |
| `kp`             | `round(interpolate(x, [-5, 10], [15, 30]), 0)`      |
| `kp2`            | `round(interpolate(x, [-5, 10], [0.4, 1.1]), 1)`    |
| `ki`             | `round(interpolate(x, [-5, 10], [0.015, 0.03]), 3)` |
| `mahony_kp`      | `round(interpolate(x, [-5, 10], [2.2, 1.5]), 1)`    |
| `mahony_kp_roll` | `round(interpolate(x, [-5, 10], [2.2, 1.5]), 1)`    |

The displayed slider value is derived from `kp - 20`, clamped to `[-5, 10]`.
That means `kp = 20` displays as neutral `0`, lower `kp` displays negative, and
higher `kp` displays positive.

Behaviorally:

- Higher `kp` increases angle proportional response.
- Higher `kp2` increases rate response and damping of quick nose-angle changes.
- Higher `ki` increases integral correction.
- Lower `mahony_kp` and `mahony_kp_roll` make the board feel snappier/stiffer;
  higher values make it feel looser and more lingering.

Because `mahony_kp` moves down while `kp`, `kp2`, and `ki` move up, this slider
is not just "more PID". It coordinates PID and IMU filter feel.

### Nose Stiffness

Nose stiffness writes acceleration torque tiltback:

```text
torquetilt_strength = round(x * 0.03, 2)
```

The displayed slider value is derived from:

```text
torquetilt_strength / 0.03
```

At the UI range endpoints:

| Slider | `torquetilt_strength` |
| -----: | --------------------: |
|    `0` |          `0.00 deg/A` |
|    `5` |          `0.15 deg/A` |
|   `10` |          `0.30 deg/A` |

Behaviorally, this applies nose lift based on positive output current. It can
increase acceleration and uphill aggressiveness even when ATR is absent or weak.

### Tail Stiffness

Tail stiffness writes regen torque tiltback:

```text
torquetilt_strength_regen = round(x * 0.03, 2)
```

The displayed slider value is derived from:

```text
torquetilt_strength_regen / 0.03
```

At the UI range endpoints:

| Slider | `torquetilt_strength_regen` |
| -----: | --------------------------: |
|    `0` |                `0.00 deg/A` |
|    `5` |                `0.15 deg/A` |
|   `10` |                `0.30 deg/A` |

Behaviorally, this applies nose lowering based on negative output current
regen. It can increase braking and downhill aggressiveness even when ATR is
absent or weak.

### ATR Intensity

ATR intensity writes both uphill and downhill ATR strengths to the same value:

```text
atr_strength_up = round(interpolate(x, [0, 15], [0, 2]), 1)
atr_strength_down = round(interpolate(x, [0, 15], [0, 2]), 1)
```

The displayed slider value is derived from the stronger of the two ATR fields:

```text
interpolate(max(atr_strength_up, atr_strength_down), [0, 2], [0, 15])
```

At useful points:

| Slider | `atr_strength_up` | `atr_strength_down` |
| -----: | ----------------: | ------------------: |
|    `0` |             `0.0` |               `0.0` |
|  `7.5` |             `1.0` |               `1.0` |
|   `15` |             `2.0` |               `2.0` |

Behaviorally, ATR applies nose lift or lowering based on adaptive torque
response rather than raw current alone. It is meant to respond to the difference
between expected acceleration and measured acceleration, which makes uphill and
downhill response more rider-weight-aware than pure torque tiltback.

Field naming note: Refloat's canonical field IDs are the serialized struct
names from `<SerOrder>`, not the VESC Tool `cDefine` defaults. For ATR strength,
use `atr_strength_up` and `atr_strength_down`.

### Carve Tilt

Carve tilt writes turn tiltback strength directly:

```text
turntilt_strength = x
```

The slider range is `0..15`. This is a direct one-to-one basic control over the
turn tiltback strength field.

### Brake Tilt

Brake tilt writes brake tiltback strength directly:

```text
braketilt_strength = x
```

The slider range is `0..5`. This is a direct one-to-one basic control over the
brake tiltback strength field.

## Detailed Field Groups

A useful detailed tune screen groups fields by behavior rather than raw schema
order.

### General

| Field            | Label             | Notes                                                                                                                                |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `kp`             | Angle P           | Main proportional angle response. Higher values make the board respond more strongly to nose angle error.                            |
| `kp2`            | Rate P            | Responds to angular velocity. Acts like a damping/derivative component and is especially noticeable in fast or aggressive maneuvers. |
| `kp_brake`       | Angle P (Braking) | Multiplier for angle response while braking.                                                                                         |
| `kp2_brake`      | Rate P (Braking)  | Multiplier for rate response while braking.                                                                                          |
| `ki`             | Angle I           | Integral correction.                                                                                                                 |
| `ki_limit`       | I Term Limit      | Limits integral term authority.                                                                                                      |
| `mahony_kp`      | Pitch KP          | Pitch-axis Mahony filter accelerometer correction. Higher values feel looser and linger more; lower values feel snappier.            |
| `mahony_kp_roll` | Roll KP           | Roll-axis Mahony filter correction. Lower than pitch can help the nose hold up in turns and make tight carves feel stiffer.          |

Rate P and Angle P should be treated as related ride-feel values. If Angle P is
changed substantially, Rate P usually needs to move in a similar proportion to
preserve feel.

### ATR

| Field                  | Label                      | Notes                                          |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| `atr_strength_up`      | ATR Uphill Strength        | Nose lift applied from ATR response.           |
| `atr_strength_down`    | ATR Downhill Strength      | Nose lowering applied from ATR response.       |
| `atr_threshold_up`     | Threshold Angle Up         | Angle threshold for uphill ATR behavior.       |
| `atr_threshold_down`   | Threshold Angle Down       | Angle threshold for downhill ATR behavior.     |
| `atr_speed_boost`      | Speed Boost                | Boosts ATR response with speed.                |
| `atr_angle_limit`      | Tiltback Angle Limit       | Maximum ATR tiltback angle.                    |
| `atr_on_speed`         | Max Tiltback Speed         | Maximum speed for applying ATR tiltback.       |
| `atr_off_speed`        | Max Tiltback Release Speed | Maximum speed for releasing ATR tiltback.      |
| `atr_response_boost`   | Tiltback Response Boost    | Boost factor for tiltback response.            |
| `atr_transition_boost` | Tiltback Transition Boost  | Boost factor around response transitions.      |
| `atr_filter`           | Current Filter             | Current filter frequency.                      |
| `atr_amps_accel_ratio` | Amps to Acceleration Ratio | Ratio used for acceleration-side ATR behavior. |
| `atr_amps_decel_ratio` | Amps to Deceleration Ratio | Ratio used for deceleration-side ATR behavior. |

Common recommended strength range is around `1.0..2.5`, with `2.5` already
being aggressive. Older ATR strength values may appear 10x smaller in older
firmware discussions.

### Torque Tiltback

| Field                       | Label                      | Notes                                                                              |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `torquetilt_strength`       | Strength                   | Nose lift based on positive output current. Basic "Nose stiffness" writes this.    |
| `torquetilt_strength_regen` | Strength (Regen)           | Nose lowering based on negative regen current. Basic "Tail stiffness" writes this. |
| `torquetilt_start_current`  | Start Current Threshold    | Current threshold before torque tiltback starts.                                   |
| `torquetilt_angle_limit`    | Tiltback Angle Limit       | Maximum torque tiltback angle.                                                     |
| `torquetilt_on_speed`       | Max Tiltback Speed         | Maximum speed for applying torque tiltback.                                        |
| `torquetilt_off_speed`      | Max Tiltback Release Speed | Maximum speed for releasing torque tiltback.                                       |

Typical strength range for basic controls is `0.00..0.30 deg/A`; broader
advanced editors may allow up to `1.00 deg/A`.

### Turn Tiltback

| Field                     | Label                    | Notes                                            |
| ------------------------- | ------------------------ | ------------------------------------------------ |
| `turntilt_strength`       | Strength                 | Basic "Carve tilt" writes this directly.         |
| `turntilt_angle_limit`    | Tiltback Angle Limit     | Maximum turn tiltback angle.                     |
| `turntilt_start_angle`    | Turn Aggregate Threshold | Turn aggregate threshold before response starts. |
| `turntilt_start_erpm`     | ERPM Threshold           | Speed threshold before response starts.          |
| `turntilt_speed`          | Max Tiltback Speed       | Maximum speed for applying turn tiltback.        |
| `turntilt_erpm_boost`     | Speed Boost %            | Boost percentage based on ERPM.                  |
| `turntilt_erpm_boost_end` | Speed Boost Max ERPM     | ERPM where boost reaches its maximum.            |
| `turntilt_yaw_aggregate`  | Turn Aggregate Target    | Target accumulated yaw/turn value.               |

### Brake Tilt

| Field                 | Label                | Notes                                     |
| --------------------- | -------------------- | ----------------------------------------- |
| `braketilt_strength`  | Brake Tilt Strength  | Basic "Brake tilt" writes this directly.  |
| `braketilt_lingering` | Brake Tilt Lingering | Controls how brake tilt lingers/releases. |

### Tiltback

| Field                   | Label                    | Notes                              |
| ----------------------- | ------------------------ | ---------------------------------- |
| `tiltback_constant`     | Constant Tiltback        | Constant nose angle offset.        |
| `tiltback_variable`     | Variable Tiltback Rate   | Variable tiltback amount per ERPM. |
| `tiltback_variable_max` | Variable Tiltback Target | Maximum variable tiltback target.  |

## UI Behavior Notes

### Retrieval and Persistence Model

There are two related but different tuning paths:

- Custom config read/write: full persisted controller package configuration.
- Runtime tune commands: smaller Refloat package commands for live tune actions.

The safe default for this app is to build the tune screen on custom config
readback first, then add writes only after the persistence path is fully tested.

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
| `GET_INFO`         |  `33` | Read package/device info.                                                        |
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

| Category                 | Commands                                                                         | Can Change On The Fly                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime data reads       | `GET_INFO`, `GET_RTDATA`, `GET_ALL_DATA`, `PRINT_INFO`, `LIGHT_INFO`, `LCM_INFO` | Nothing persisted; reads package version, board state, angles, input tilt, throttle, speed/duty, and light/controller metadata.                                                                                 |
| Tune editing             | `SET_TUNE`, `SET_DEFAULT_TUNE`, `TUNE_OTHER`, `BOOSTER`                          | Live tune state and helper/advanced tune values. These affect behavior immediately but should be considered temporary until saved.                                                                              |
| Tune persistence actions | `SAVE_TUNE`, `RESTORE_TUNE`                                                      | Save current runtime tune state or restore saved tune state. These are actions, not field writes.                                                                                                               |
| Movement / tilt input    | `MOVE`, `LOCK`, `FLYWHEEL`                                                       | Live movement, Remote Tilt input, lock state, and flywheel-related action. Treat as immediate control input.                                                                                                    |
| Lighting                 | `LIGHT_CTRL`                                                                     | Headlight and status brightness. The observed control payload uses `headlightBrightness` and `statusBrightness`; headlight is scaled to roughly half before sending and status brightness has a minimum of `5`. |
| Sound / tones            | `TONE`                                                                           | Tone support/version, horn, play, and stop actions. Tone handler install is a separate script/LISP flow; playback control then uses the `TONE` runtime channel.                                                 |

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
so the app repeats the active value on a fixed ~40 ms tick. This is runtime
input only; it never writes configuration.

The UI is a 2D pad rather than a 1D slider. The horizontal axis is the tilt
value above; the vertical axis sets a release decay time (bottom = instant snap,
up to `60 s`). The top band of the pad is a **lock** zone: releasing there holds
the tilt indefinitely (the live hold stream just keeps running) until the user
cancels. While the finger is down the app streams the held tilt live. On a
normal release it hands off to a linear ease: the held value is interpolated back
to `128` (neutral) over the chosen duration, one step per ~40 ms tick, then the
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
  tenths of amps and is clamped by firmware; `time` is in firmware steps of
  roughly one second (`time * 100` loop steps). A stop-ish command is
  `[1, 0, 1, 1]`.
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
repeat tick — 100 ms, because both firmware generations lapse the request after
about a second — and the wire format is picked from the linked
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

Tune Profiles are not migrated across normalized base Refloat package versions. A profile created
under one base version is retained for that version and hidden from normal use when the board
reports a different base version. Suffixes and fork labels stay in the exact Refloat version used
for link integrity, but they do not split Tune Profile compatibility. If the board later returns to
the old base version, those profiles can be shown again. When no profile exists for the current
trusted base version, the rider explicitly creates one from the current board config.

Known version-sensitive field semantics:

| Area                      | Affected fields                        | Compatibility note                                                                                                                                                                                      |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High/low voltage pushback | `tiltback_hv`, `tiltback_lv`           | Refloat 1.2 with VESC firmware `6.05+` supports per-cell voltage values. Older `6.02` setups use total pack voltage, e.g. `4.3V * cell_count` for high voltage and `3.0V * cell_count` for low voltage. |
| I term limit              | `ki_limit`                             | Older firmware exposed this concept as `Deadzone`; the modern value is scaled up 10x. A previous `Deadzone = 3` corresponds to `ki_limit = 30A`.                                                        |
| ATR strength              | `atr_strength_up`, `atr_strength_down` | Older `5.3 ATR` values are scaled 10x smaller. A previous ATR strength of `0.10` corresponds to modern `1.0`.                                                                                           |
| BMS temperature alert     | BMS temperature threshold fields       | Some BMS-related options require VESC firmware `6.06+` and sufficiently recent BMS firmware.                                                                                                            |
| Parking brake             | `parking_brake_mode`                   | Firmware `6.05+` applies parking brake by shorting motor phases; older behavior may differ.                                                                                                             |
| Audible feedback          | haptic/audible feedback fields         | Some generated tones rely on `foc_play_tone` behavior from firmware `6.05`; other modes use current modulation instead.                                                                                 |

For our app, this means tune read/write support requires a trusted Board Link with known Refloat
package version. Writes are still gated by schema validation and field presence, but profile
visibility is gated by Refloat package version. The app does not silently convert old tune values
to new Refloat versions.

### Basic and Advanced Values Must Stay in Sync

When detailed values change, the basic sliders should recompute their displayed
positions from the underlying fields:

- Aggressiveness displays from `kp - 20`.
- Nose stiffness displays from `torquetilt_strength / 0.03`.
- Tail stiffness displays from `torquetilt_strength_regen / 0.03`.
- ATR intensity displays from `max(atr_strength_up, atr_strength_down)` mapped
  from `[0, 2]` back to `[0, 15]`.
- Carve tilt displays from `turntilt_strength`.
- Brake tilt displays from `braketilt_strength`.

This means asymmetrical detailed ATR edits cannot be represented perfectly by
the one-dimensional ATR intensity slider. The basic slider intentionally shows
the stronger of uphill and downhill strength.

### Basic Edits Can Overwrite Detailed Asymmetry

Some basic sliders write multiple fields:

- Aggressiveness overwrites five fields.
- ATR intensity overwrites both uphill and downhill ATR strength.

If a rider customized those fields independently in detailed mode, moving the
basic slider collapses that custom shape back onto the basic formula. The UI
should make this interaction predictable by treating basic sliders as presets or
compound controls, not as harmless aliases.

### Save Semantics

Changing slider state should be treated separately from persisting to the board.
A safe UX has three distinct phases:

- Read current config from the controller.
- Apply edits to a local draft.
- Explicitly write and save the final draft.

The current app should keep read-only tune inspection separate from future write
paths until mutation commands, save behavior, and failure recovery are designed
and tested.

## Implementation Notes for This Repo

Current local read-only field groups live in:

```text
modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RefloatConfigModels.kt
```

Before implementing writes, keep field IDs aligned with the serialized struct
names returned by the board's `<SerOrder>`. Do not derive IDs from `cDefine`;
those defaults are VESC Tool names and can differ from Refloat's wire-format
field IDs, as with `atr_strength_up` / `atr_strength_down`.
