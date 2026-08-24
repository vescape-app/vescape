# VESC Motor Config (MCCONF) binary layout

→ [index](./index.md) | [vescProtocol](./vescProtocol.md) | [ADR 0035](./adr/0035-board-config-is-exclusively-owned-while-connected.md)

`COMM_GET_MCCONF` (packet id 14) returns the motor configuration as a flat serialized blob.
Unlike Refloat config, **the board serves no schema for it** — there is no XML to walk, so offsets
must come from a layout the app carries. This document records how that layout is obtained, what it
looks like, and which parts of it are safe across firmware versions.

Status: **verified against hardware.** A one-shot probe read the blob off a Floatwheel ADV2 on
2026-08-24 and every decoded value matched VESC Tool. No production MCCONF read is implemented yet.

## The blob is self-versioning

The blob's first four bytes are `MCCONF_SIGNATURE`, a `uint32` that VESC Tool's code generator
derives from the parameter set. Any change to a field's name, type, or position produces a new
signature. Firmware's own reader (`confgenerator_deserialize_mcconf`) refuses to decode on mismatch:

```c
uint32_t signature = buffer_get_uint32(buffer, &ind);
if (signature != MCCONF_SIGNATURE) {
    return false;
}
```

So the signature — **not** the `FW_VERSION` string — is the correct key for resolving a layout.
Firmware version is unreliable: the same `FW 6.05` string ships different layouts across hardware
variants and vendor forks, while the signature tracks the actual wire format. Match the signature
exactly or decode nothing; there is no useful fallback.

Signatures observed in `vedderb/bldc` (`confgenerator.h`, read 2026-08-24):

| Branch         | `MCCONF_SIGNATURE` | hex          | fields | total bytes |
| -------------- | ------------------ | ------------ | ------ | ----------- |
| `release_6_02` | 776184161          | `0x2E43A161` | 190    | 481         |
| `release_6_05` | 1065524471         | `0x3F829CF7` | 197    | 477         |
| `release_6_06` | 788332866          | `0x2EFD0142` | 201    | 483         |
| `release_7_00` | 1470992211         | `0x57AD8F53` | 203    | 488         |
| `master`       | 3154770096         | `0xBC09F8B0` | 203    | 488         |

`master` is FW 7.01 test 1 and is **not** what riders are on. Use the release branch matching the
target board, not `master`.

Firmware source is on branches, not tags: `release_6_05`, `release_6_06`, `release_7_00`. There is
no `6.05` tag in the repo.

## Confirmed against a real board

A Floatwheel ADV2 answered `COMM_GET_MCCONF` **directly, not CAN-forwarded**, with a 477-byte body:

```
signature = 1065524471 (0x3F829CF7)   -> release_6_05, exact match
body      = 477 bytes                 -> matches release_6_05 total
```

Decoding the version-invariant prefix against the 6.05 layout reproduced VESC Tool's Motor Cfg →
Temperature page exactly — `l_temp_fet_start` 70 °C, `l_temp_fet_end` 80 °C, `l_temp_motor_start`
80 °C, `l_temp_motor_end` 90 °C, `l_temp_accel_dec` 0. Surrounding fields decoded to plausible values
too (160 A phase, 70 A battery, −45 A regen, 240 A abs max, ±18000 erpm, 38–97 V, 54/50 V cutoff),
so the offsets are right across the whole prefix, not just at the fields we were checking.

This settles the open risk that a vendor board would report an unknown signature. It does not: the
ADV2 runs stock-layout 6.05 despite its ESP32 BLE bridge.

## Two traps that make hand-derivation mandatory

**1. VESC Tool's parameter XML does not describe the wire type.** For `l_temp_fet_start` the XML
metadata says `type: 1, vTx: 7, vTxDoubleScale: 10` — a scaled `float16`. Firmware writes a single
byte:

```c
buffer[ind++] = (uint8_t)conf->l_temp_fet_start;
```

The XML fields are _editor_ metadata (decimals, min/max, suffix), not transmission format. A decoder
built the way `RefloatConfigSchema.parseVescValueType` builds one — deriving wire type from
`type`/`vTx` — would read these fields wrong. MCCONF layout must come from `confgenerator.c`, never
from the XML.

**2. A field can keep its offset while changing its type.** `l_temp_fet_start` sits at byte 63 in
both 6.02 and 6.05, but 6.02 encodes it as `f16/10` (2 bytes) and 6.05 as `u8` (1 byte). An
offset-only check passes and the value is silently garbage. This is exactly the failure mode ADR 0035
forbids, and it is why the signature gate is not optional.

## Version-invariant prefix (6.05 → master)

The first 36 fields — bytes 0–86 — are byte-identical in name, offset, and type across
`release_6_05`, `release_6_06`, `release_7_00`, and `master`. Everything from byte 87 onward
diverges (6.05/6.06 continue with `sl_min_erpm`; 7.00/master insert `l_additional_faults` there).

| Offset | Size | Type      | Field                       |
| ------ | ---- | --------- | --------------------------- |
| 0      | 4    | uint32    | `MCCONF_SIGNATURE`          |
| 4      | 1    | u8        | `pwm_mode`                  |
| 5      | 1    | u8        | `comm_mode`                 |
| 6      | 1    | u8        | `motor_type`                |
| 7      | 1    | u8        | `sensor_mode`               |
| 8      | 4    | f32auto   | `l_current_max`             |
| 12     | 4    | f32auto   | `l_current_min`             |
| 16     | 4    | f32auto   | `l_in_current_max`          |
| 20     | 4    | f32auto   | `l_in_current_min`          |
| 24     | 2    | f16/10000 | `l_in_current_map_start`    |
| 26     | 2    | f16/10000 | `l_in_current_map_filter`   |
| 28     | 4    | f32auto   | `l_abs_current_max`         |
| 32     | 4    | f32auto   | `l_min_erpm`                |
| 36     | 4    | f32auto   | `l_max_erpm`                |
| 40     | 2    | f16/10000 | `l_erpm_start`              |
| 42     | 4    | f32auto   | `l_max_erpm_fbrake`         |
| 46     | 4    | f32auto   | `l_max_erpm_fbrake_cc`      |
| 50     | 2    | f16/10    | `l_min_vin`                 |
| 52     | 2    | f16/10    | `l_max_vin`                 |
| 54     | 2    | f16/10    | `l_battery_cut_start`       |
| 56     | 2    | f16/10    | `l_battery_cut_end`         |
| 58     | 2    | f16/10    | `l_battery_regen_cut_start` |
| 60     | 2    | f16/10    | `l_battery_regen_cut_end`   |
| 62     | 1    | u8        | `l_slow_abs_current`        |
| 63     | 1    | u8        | `l_temp_fet_start`          |
| 64     | 1    | u8        | `l_temp_fet_end`            |
| 65     | 1    | u8        | `l_temp_motor_start`        |
| 66     | 1    | u8        | `l_temp_motor_end`          |
| 67     | 2    | f16/10000 | `l_temp_accel_dec`          |
| 69     | 2    | f16/10000 | `l_min_duty`                |
| 71     | 2    | f16/10000 | `l_max_duty`                |
| 73     | 4    | f32auto   | `l_watt_max`                |
| 77     | 4    | f32auto   | `l_watt_min`                |
| 81     | 2    | f16/10000 | `l_current_max_scale`       |
| 83     | 2    | f16/10000 | `l_current_min_scale`       |
| 85     | 2    | f16/10000 | `l_duty_start`              |

This prefix is unusually well-stocked: every `l_*` limit the app would want to surface — phase and
battery current limits, erpm limits, voltage cutoffs, regen cutoffs, temperature cutoffs, duty
limits, watt limits — lives inside it. Fields beyond it (`m_ntc_motor_beta`,
`m_motor_temp_sens_type`, `si_*`, `bms.*`, all `foc_*`) are version-specific and need a per-signature
layout.

The 6.02 layout does **not** share this prefix. Supporting 6.02 means carrying a second layout, not
extending this one.

### Value encodings

- `u8` — raw byte. Temperature cutoffs are whole °C.
- `f16/N` — `int16` big-endian divided by `N`.
- `f32auto` — VESC's `buffer_append_float32_auto`, a packed sign/exponent/mantissa form, **not**
  IEEE-754. See `buffer.c` upstream. The Refloat decoder already implements this as `float32Auto`;
  reuse it.

## Regenerating a layout

Offsets are derived mechanically from the serializer, which is the authoritative definition:

```bash
curl -sO https://raw.githubusercontent.com/vedderb/bldc/release_6_05/confgenerator.c
bun run scripts/mcconf-layout.ts confgenerator.c
```

See [`scripts/mcconf-layout.ts`](../scripts/mcconf-layout.ts). It walks
`confgenerator_serialize_mcconf`, accumulating each `buffer_append_*` / `buffer[ind++]` into an
`(offset, type, size, name)` row. Any line it cannot parse is reported to stderr rather than silently
skipped — a silent skip would shift every subsequent offset.

Do not hand-edit layouts. Regenerate them.

## Design implications

- **Signature is the persistence key.** Where Refloat config keys Last Known Board Config Values by
  Refloat base version, MCCONF keys by `MCCONF_SIGNATURE`.
- **Unknown signature means no data, not a guess.** Report the signature alongside firmware version
  and hardware name so unseen signatures surface and a layout can be added.
- **MCCONF cannot be mandatory link state.** ADR 0035 makes Refloat config mandatory because the
  board always serves its own schema, so it is always decodable. MCCONF may legitimately be absent
  on an unknown signature, so it must not gate linking. That difference is principled — it follows
  from where the schema comes from — and needs its own ADR rather than a caveat on 0035.
- **Read-only.** Writing MCCONF is out of scope. A partial layout cannot back a write, and the
  consequences of a bad motor config write are severe.

## Sources

- `vedderb/bldc`, `confgenerator.c` and `confgenerator.h`, branches listed above. Read 2026-08-24.
- Floaty's bundled parameter dictionaries (`~/Workspace/floaty-reverse-engineering`) confirm the
  per-version bundling approach and were the source of the XML metadata compared above.
