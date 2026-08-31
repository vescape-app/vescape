# Refloat COMMAND_GET_ALLDATA

→ [index](./index.md) | [vescProtocol](./vescProtocol.md)

Source: [`lukash/refloat`](https://github.com/lukash/refloat) `src/main.c` → `cmd_send_all_data()`

## Request

```
[FORWARD_CAN=0x22] [canId] [CUSTOM_APP_DATA=0x24] [magic=101] [GET_ALLDATA=10] [mode]
```

Modes: `1` = RT data only, `2` += odometer + temps, `3` += energy counters, `4` += charging.
We use mode 2. Mode 4 was tried for charging detection but reverted — see [chargingDetection.md](./chargingDetection.md).

## Response payload layout (mode = 2, normal — no fault)

Outer VESC frame is stripped by the time the payload reaches the JS handler.

| Offset | Size | Encoding      | Field                                                       |
| ------ | ---- | ------------- | ----------------------------------------------------------- |
| 0      | 1    | —             | `0x24` (CUSTOM_APP_DATA cmd byte)                           |
| 1      | 1    | —             | `101` (Refloat magic)                                       |
| 2      | 1    | —             | `10` (GET_ALLDATA)                                          |
| 3      | 1    | uint8         | mode (=2), **or `69`** if fault active                      |
| 4–5    | 2    | int16 ÷ 10    | balance_current (A)                                         |
| 6–7    | 2    | int16 ÷ 10    | balance_pitch (°)                                           |
| 8–9    | 2    | int16 ÷ 10    | roll (°)                                                    |
| 10     | 1    | uint8         | state: `bits[3:0]` = state_compat, `bits[7:4]` = sat_compat |
| 11     | 1    | uint8         | switch state (footpad + handtest + beep flags)              |
| 12     | 1    | uint8 ÷ 50    | adc1 (~0..1)                                                |
| 13     | 1    | uint8 ÷ 50    | adc2 (~0..1)                                                |
| 14     | 1    | (x−128) ÷ 5   | setpoint (°)                                                |
| 15     | 1    | (x−128) ÷ 5   | atr.setpoint                                                |
| 16     | 1    | (x−128) ÷ 5   | brake_tilt.setpoint                                         |
| 17     | 1    | (x−128) ÷ 5   | torque_tilt.setpoint                                        |
| 18     | 1    | (x−128) ÷ 5   | turn_tilt.setpoint                                          |
| 19     | 1    | (x−128) ÷ 5   | remote.setpoint                                             |
| 20–21  | 2    | int16 ÷ 10    | pitch (°)                                                   |
| 22     | 1    | (x−128)       | booster current (A)                                         |
| 23–24  | 2    | int16 ÷ 10    | battery_voltage (V)                                         |
| 25–26  | 2    | int16         | erpm                                                        |
| 27–28  | 2    | int16 ÷ 10    | speed in m/s → multiply × 3.6 for km/h                      |
| 29–30  | 2    | int16 ÷ 10    | motor_current (A)                                           |
| 31–32  | 2    | int16 ÷ 10    | battery_current (A)                                         |
| 33     | 1    | (x−128) ÷ 100 | duty_cycle (−1..1)                                          |
| 34     | 1    | uint8 ÷ 3     | foc_id (A); `222` = unavailable                             |
| 35–38  | 4    | float32_auto  | odometer absolute (metres) — **mode ≥ 2**                   |
| 39     | 1    | uint8 ÷ 2     | mosfet_temp (°C) — mode ≥ 2                                 |
| 40     | 1    | uint8 ÷ 2     | motor_temp (°C) — mode ≥ 2                                  |
| 41     | 1    | —             | reserved (0) — mode ≥ 2                                     |

## Fault response

When `payload[3] == 69` (FAULT_MODE_MARKER):

```
[0x24] [101] [10] [69] [mc_fault_code]
```

This is a fault observation, not a telemetry sample. Native passes the fault byte to the
Board-owned VESC Fault coordinator; it does not emit a zero-valued telemetry frame or persist
one in Ride History. The next normal `ALLDATA` response observes a clear. See
[ADR 0037](./adr/0037-vesc-faults-are-board-owned-evidence.md).

## float32_auto encoding

VESC custom 4-byte float (not IEEE 754). Decoding:

```typescript
function getFloat32Auto(view: DataView, offset: number): number {
  const res = view.getUint32(offset, false)
  const eRaw = (res >>> 23) & 0xff
  const sigI = res & 0x7fffff
  const neg = res >>> 31 !== 0
  if (eRaw === 0 && sigI === 0) return 0.0
  const sig = sigI / (8388608.0 * 2.0) + 0.5
  return (neg ? -1 : 1) * sig * 2 ** (eRaw - 126)
}
```

Source: `buffer_get_float32_auto()` in `lukash/refloat/src/conf/buffer.c`.

## state_compat values (lower nibble of byte 10)

| Value | Name            |
| ----- | --------------- |
| 0     | STARTUP         |
| 1     | RUNNING         |
| 2     | TILTBACK        |
| 3     | WHEELSLIP       |
| 4     | UPSIDEDOWN      |
| 5     | FLYWHEEL        |
| 6     | FAULT_PITCH     |
| 7     | FAULT_ROLL      |
| 8     | FAULT_SW_HALF   |
| 9     | FAULT_SW_FULL   |
| 11    | FAULT_STARTUP   |
| 12    | FAULT_REVERSE   |
| 13    | FAULT_QUICKSTOP |
| 14    | CHARGING        |
| 15    | DISABLED        |

## Other read commands

All Refloat read commands share the same outer frame: `[CUSTOM_APP_DATA=0x24] [magic=101] [command]`.

### GET_INFO (0) — Board identity + capabilities

Request: `[101] [0] [version]`

The tune config read sends version `1` for broad compatibility and displays the
returned Refloat package version in the Tune screen. The parser also accepts
version `2` responses when present.

Response version 1:

- Package version number (major × 10 + minor)
- Build number
- LED type

Response version 2:

- Protocol version byte (= 2)
- Flags (echoed from request)
- Package name (20 chars, e.g. `"refloat"`)
- `MAJOR_VERSION`, `MINOR_VERSION`, `PATCH_VERSION` (3 bytes)
- Version suffix string (20 chars)
- Git hash (uint32)
- System tick rate (uint32, Hz)
- Capabilities bitmask (uint32): bit 0 = LED present, bit 1 = external LED, bit 31 = data recorder
- Extra flags (uint8)

Useful for connection handshake — check board capabilities before enabling UI features.

### GET_RTDATA (1) — Full-precision runtime data

Same fields as `GET_ALLDATA` but encoded as **float32_auto** instead of packed float16/uint8.
Additional fields not in `GET_ALLDATA`:

| Field             | Description                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| all 6 setpoints   | ATR, brake_tilt, torque_tilt, turn_tilt, remote                                                 |
| atr.accel_diff    | ATR acceleration difference                                                                     |
| charge or booster | `charging.current`/`charging.voltage` if charging, else `booster.current` + `motor.dir_current` |
| remote.input      | Raw throttle input value (−1..1)                                                                |

~48 bytes, float32 precision. Better for debugging/diagnostics than production polling.

### REALTIME_DATA (31) + REALTIME_DATA_IDS (32) — High-resolution telemetry

The richest data channel. Header:

| Field       | Encoding | Description                                                                 |
| ----------- | -------- | --------------------------------------------------------------------------- |
| mask        | uint8    | bit 0 = running, bit 1 = charging, bit 2 = alerts                           |
| extra_flags | uint8    | bit 0 = recording, bit 1 = autostart, bit 2 = autostop, bit 3 = fatal_error |
| timestamp   | uint32   | Board time (ticks)                                                          |
| mode/state  | uint8    | `mode << 4 \| state`                                                        |
| flags       | uint8    | `footpad_state << 6 \| charging << 5 \| darkride << 1 \| wheelslip`         |
| sat/stop    | uint8    | `sat << 4 \| stop_condition`                                                |
| beep_reason | uint8    | Active beep reason                                                          |

Always-sent fields (all float16_auto):

```
main_frequency, main_recalcs, main_fltr_freq, imu_dt, imu_frequency,
imu_recalcs, imu_fltr_freq, speed, erpm, current, dir_current,
filt_current, duty_cycle, batt_voltage, batt_current, mosfet_temp,
motor_temp, pitch, balance_pitch, roll, adc1, adc2, remote.input
```

Runtime-only fields (only when the board is running, STATE_RUNNING):

```
setpoint, atr.setpoint, brake_tilt.setpoint, torque_tilt.setpoint,
turn_tilt.setpoint, remote.setpoint, balance_current, atr.accel_diff,
atr.speed_boost, booster.current
```

Footer:

- Active alert mask (uint32)
- Extra flags (uint32, reserved)
- FW fault code (uint8)

`REALTIME_DATA_IDS` returns the string field names for all items so clients can discover the schema dynamically without hardcoding the field order.

### LIGHTS_CONTROL (20) — Refloat's own lights

Request: `[CUSTOM_APP_DATA=0x24] [101] [20] [mask uint32 BE] [value]`. `mask` names which switches
to apply — bit 0 the lights as a whole, bit 1 the headlights — and `value` carries their new state
in the same bit positions. Firmware touches only the switches the mask names, so writing
`mask = 3, value = 3` turns both on and `value = 0` turns both off.

Firmware discards the whole request unless the mask's **low byte** is non-zero (`mask & 0xff`); a
mask whose set bits are all above bit 7 is a silent no-op and `value` is never even read.

The board answers with `[101] [20] [headlights_enabled << 1 | enabled]`, its runtime status after
the write.

Nothing is persisted, but the write is sticky for the rest of the power cycle: firmware flags the
runtime value as overriding the configured one, and from then on stops re-applying the configured
lights setting. So a later config write of that setting appears to do nothing until reboot.

A board with its LEDs configured off still accepts the command and echoes back `enabled` — the
runtime flag flips, there is just nothing to light up. `GET_INFO` capabilities bit 0 is how a client
knows not to offer the switch at all.

### LCM reads — Lighting controller

| Command         |  ID | Returns                                                                                                                                                                          |
| --------------- | --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LCM_LIGHT_INFO  |  25 | Light config: enabled, brightness, idle brightness, status brightness, lights-off-when-lifted, LCM name, payload                                                                 |
| LCM_LIGHT_CTRL  |  26 | Write for external light modules: `[brightness] [brightness_idle] [status_brightness]` (each 0–100), plus an optional LCM-specific payload tail. Ignored when no LCM is enabled. |
| LCM_DEVICE_INFO |  27 | LCM hardware/firmware info                                                                                                                                                       |
| LCM_GET_BATTERY |  29 | Battery info from external light module                                                                                                                                          |

### Board Move commands

Refloat has changed the app-driven move command across protocol generations:

| Generation      | Command |  ID | Payload                                                                                                    |
| --------------- | ------- | --: | ---------------------------------------------------------------------------------------------------------- |
| Refloat 1.0–1.2 | RC_MOVE |   7 | `[direction, current, time, current + time]`; firmware accepts only while disengaged/ready (`STATE_READY`) |
| Refloat 1.3+    | REMOTE  |  15 | `[signedInput]`; `-127..127` maps to `-1..1`, `-128` is ignored; move torque is requested only in ready    |

### ALERTS_LIST (35)

Returns the currently configured alert thresholds from the board's alert tracker.
