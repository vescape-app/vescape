# Safety Warnings & Thresholds

→ [index](./index.md) | [tune](./tune.md)

Refloat / VESC firmware runs the real-time safety loop on the controller — pushbacks, faults,
and voltage cutoffs — independent of the app. This is a reference for those warnings and their
default thresholds.

## Pushbacks (nose lifts to warn the rider)

| Warning           | Param           | Default      | Meaning                                                                                                 |
| ----------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| Duty-cycle push   | `tiltback_duty` | `0.80` (80%) | Approaching duty limit. **Max VESC duty is 95%, not 100%** — pushing past 95% nosedives.                |
| High-voltage push | `tiltback_hv`   | `64.5 V`     | Overcharge / regen (braking or downhill on a full pack). Rule of thumb: `4.3 V × cells` (15s → 64.5 V). |
| Low-voltage push  | `tiltback_lv`   | `45.0 V`     | Battery low — stop riding. Rule of thumb: `3.0 V × cells` (15s → 45 V). Always respect it.              |

Each pushback has an `_angle` (nose-up target) and `_speed` (how fast the nose lifts). Fast
pushback is itself hazardous — keep `_speed` conservative (HV/LV default `1 °/s`, duty `3 °/s`).

**Low-voltage ordering:** the motor-config Voltage Cutoff Start/End should sit _below_
`tiltback_lv`. LV pushback is the "stop now" notice; the voltage cutoffs are last-resort battery
protection. If the cutoffs rise above LV pushback, the warning is defeated.

**Voltage units (firmware-dependent):** since Refloat 1.2 on VESC **6.05+**, `tiltback_lv` /
`tiltback_hv` are stored **per cell** (defaults `3.0` / `4.3`). On **6.02** they are a **pack total**
(e.g. `3.0 × 15 = 45 V`). The config-safety detector (`ConfigSafetyDetector`) resolves the mode from
the firmware version: per-cell → compare the raw value against `3.0` / `4.3`; pack → compare against
`3.0 × series` / `4.3 × series` (needs the configured series count). When the firmware version is
unknown/unparseable, or pack mode has no series count, the LV/HV rules are skipped rather than guessed.

## Fault disengagement (board turns off)

| Fault                 | Param                       | Default | Trigger                                                             |
| --------------------- | --------------------------- | ------- | ------------------------------------------------------------------- |
| Pitch fault           | `fault_pitch`               | `20°`   | Nose tips past this angle.                                          |
| Roll fault            | `fault_roll`                | `45°`   | Excessive roll.                                                     |
| Footpad switch fault  | `fault_adc1` / `fault_adc2` | `2.0 V` | Sensor zone reads below this → "foot off". `0` disables the switch. |
| Half-state fault ERPM | `fault_adc_half_erpm`       | `~200`  | Speed above which a single footpad off counts as a fault.           |

App note: the footpad UI resolves engagement from `fault_adc1` / `fault_adc2` through **Board Config
Values**. `fault_adc_half_erpm` is decoded and available there but deliberately not surfaced yet — one
footpad off below that speed is tolerated by the board, and the app does not distinguish that case.

`fault_delay_*` params add debounce — keep them small. `fault_moving_fault_disabled` and
`fault_darkride_enabled` weaken fault protection and need correct speed calibration; default off.

## Advanced / expert-only

| Feature         | Param                         | Default | Notes                                                                        |
| --------------- | ----------------------------- | ------- | ---------------------------------------------------------------------------- |
| Surge           | `surge_angle`                 | `0`     | Off by default. Riding near the duty limit is dangerous — not for beginners. |
| Surge start     | `surge_duty_start`            | `0.88`  | Only when surge enabled; higher = riskier.                                   |
| Remote throttle | `remote_throttle_current_max` | `0` A   | Off by default. An idling remote must sit at 0% or it drains the pack.       |

## Live remote-tilt clamp

The remote-tilt (nose Move) value is clamped to `20..80` before the command packet is built —
a transient runtime command, not a persistent config write.
</content>
