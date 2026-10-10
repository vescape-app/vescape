# VESC Protocol

→ [index](./index.md) | [architecture](./architecture.md) | [refloatAlldata](./refloatAlldata.md)

## Packet framing

Short packet (payload ≤ 255 bytes):

```
[0x02] [len: 1B] [payload: N bytes] [crc_hi] [crc_lo] [0x03]
```

CRC: CRC-16/XMODEM, poly=0x1021, init=0x0000, big-endian.

The reassembler (`src/vesc/reassembler.ts`) handles packets split across multiple BLE MTU chunks.

## Command IDs (subset)

| Name                   | ID   | Notes                                                                                                                       |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `COMM_FW_VERSION`      | 0x00 | Handled by ESP32 locally. Use as connectivity ping — it generates a response.                                               |
| `COMM_GET_VALUES`      | 0x04 | Standard motor telemetry. Must be CAN-forwarded on ADV2.                                                                    |
| `COMM_ALIVE`           | 0x1E | Keepalive. **No response** — useless as a connectivity test.                                                                |
| `COMM_FORWARD_CAN`     | 0x22 | Prefix wrapper: `[0x22, canId, <actual command>]`                                                                           |
| `COMM_CUSTOM_APP_DATA` | 0x24 | Refloat package commands. Must be CAN-forwarded.                                                                            |
| `COMM_PING_CAN`        | 0x3E | ESP32 discovers CAN bus devices. Response: `[0x3E, id0, id1, ...]`                                                          |
| `COMM_BMS_GET_VALUES`  | 0x60 | Smart-BMS values (cell-group voltages, balancing, SoC). CAN-forwarded like other cmds. See [below](#bms-cell-group-values). |

## Problem: GET_VALUES never responded

**Symptom**: `COMM_GET_VALUES` (0x04) sent successfully (write-with-response confirmed), but zero notification packets received.

**Cause**: The ESP32 is a dumb BLE→CAN bridge. It only handles `COMM_FW_VERSION` locally. All other commands including `COMM_GET_VALUES` must be addressed to a specific CAN device ID and prefixed with `COMM_FORWARD_CAN`. Without the prefix the ESP32 has no motor controller CAN ID to forward to.

**Fix**:

1. Resolve the motor controller's CAN ID **once at setup** via Board Probe (`COMM_PING_CAN`), store it as the Board Transport
2. Wrap all motor commands with the stored transport: `[0x22, canId, <cmd>]`

```kotlin
// Setup only: BoardTransportDetector pings to discover responders.
sendPayload(byteArrayOf(COMM_PING_CAN.toByte()))

// Runtime: the stored Board Transport frames each poll — no discovery.
// BoardTransport.Can(canId).frame(cmd) prepends [FORWARD_CAN, canId].
sendPayload(byteArrayOf(
  COMM_FORWARD_CAN.toByte(),
  canId.toByte(),
  COMM_CUSTOM_APP_DATA.toByte(),
  REFLOAT_MAGIC.toByte(),
  REFLOAT_GET_ALLDATA.toByte(),
  2,
))
```

## Connect sequence

CAN id discovery is a setup-time **Board Probe** (`BoardTransportDetector`), not part of
runtime connect. At runtime the stored Board Transport is read and polling starts directly.

```
Board Probe (setup, once):
  connect → COMM_FW_VERSION → COMM_PING_CAN → probe each responder + Direct
  → confirm a transport on first valid telemetry sample → store Board Transport

Runtime connect (every session, dumb):
1. nativeConnect(deviceId)                  — GATT connect, MTU 517, CCCD writes
2. seed direct/CAN mode from stored Board Transport
3. poll every 500ms (no discovery probes):
   direct: send [CUSTOM_APP_DATA, 101, GET_ALLDATA, 2]
   CAN:    send [FORWARD_CAN, canId, CUSTOM_APP_DATA, 101, GET_ALLDATA, 2]
```

## BLE write serialization

Android accepts only one GATT characteristic write at a time. The native
transport queues every framed packet and sends the next only after the previous
write callback. This prevents remote-control repeats and telemetry polling from
causing `writeCharacteristic` busy failures and silently losing commands.

Note: `COMM_ALIVE` (0x1E) was tried as the first ping — it generates no response, so it cannot confirm the notification path. `COMM_FW_VERSION` must be used instead.

## BMS cell-group values

A smart BMS (e.g. Smart BMS / ANT / JBD over CAN) reports per-cell-group voltages. We read
them with `COMM_BMS_GET_VALUES` (0x60) — the standard VESC BMS command, **not** anything from
the Refloat `GET_ALLDATA` stream (that only carries pack-level voltage).

### Capability detection (at probe and verified at runtime)

Smart-BMS presence and firmware identity are discovered during the **Board Probe** for each
candidate transport. While probing each transport for telemetry, `BoardTransportDetector` also
fires a `COMM_BMS_GET_VALUES` request and firmware identity requests (`COMM_FW_VERSION` and
Refloat `GET_INFO`) when available. The facts ride on the chosen `BoardCandidate` into the saved
`BoardLink` as `linkVersion: 4`. Native finalization accepts only a candidate from that probe,
then persists its complete Last Known Board Config Values before returning the saveable link.

Runtime connect still starts telemetry from the saved Board Transport without rediscovering CAN.
After telemetry startup, a background Link Integrity Check lightly re-probes saved facts for the
selected transport.
If saved facts mismatch or expected BMS stops being observed for a debounce window, the link is
treated as mismatched for that Board Session: telemetry can continue, but firmware-dependent
commands are blocked until the rider re-links.

BMS is polled only when the saved or freshly verified link says one is present. Unknown legacy
links need a re-probe or successful Link Integrity Check before cell data and firmware-dependent
capabilities are trusted.

### Polling

`PollingLoop` interleaves a BMS poll into the normal telemetry loop at **1/8** of the
telemetry rate (`BMS_POLL_STRIDE`). Cell voltages change slowly and the reply is large, so a
slower cadence avoids crowding the BLE link. The poll reuses the session transport, so it is
CAN-forwarded (`[0x22, canId, 0x60]`) or sent direct exactly like the Refloat poll. The reply
arrives unwrapped at the top level as `[0x60, ...]` (the ESP32 strips the CAN-forward wrapper
on responses), with a nested `[0x22, ?, 0x60, ...]` form also handled defensively.

The loop sends the BMS poll **only** when `link.hasBms === true`; otherwise it is skipped
entirely — no wasted frames, and `BmsCellVoltages` shows a definitive "No smart-BMS detected"
instead of an open-ended "waiting".

### Payload layout (`parseBmsValues` in `VescProtocol.kt`)

VESC packs **scaled big-endian integers**, not IEEE floats: a `float32` field is `int32 / scale`
and a `float16` field is `int16 / scale`. Layout mirrors `commands.c`:

```
[0]      id = 0x60
float32  v_tot      (÷1e6)   pack voltage
float32  v_charge   (÷1e6)
float32  i_in       (÷1e6)   pack current
float32  i_in_ic    (÷1e6)
float32  ah_cnt     (÷1e3)
float32  wh_cnt     (÷1e3)
u8       cell_num
float16  v_cell[cell_num] (÷1e3)   ← the per-group voltages we surface
u8       bal_state[cell_num]       ← balancing flag per group
u8       temp_adc_num
float16  temps_adc[temp_adc_num] (÷1e2)
float16  temp_ic, temp_hum, hum, temp_max_cell (÷1e2)
u8       soc (×255 → 0–1), soh, can_id, ...
```

Only the stable prefix (voltages + balancing) is required. `soc` is best-effort: parsed by
walking past the variable-length temp block with bounds checks, so firmware variants with
different trailing fields still yield cell data. Sanity guards reject `cell_num` outside 1–60
and payloads too short for the claimed cell count.

### Flow to UI

`handleBmsPayload` → emit `onBms` → `bleStore.latestBms` → `summarizeBms` (min/max/spread/avg,
extreme tagging) → `BmsCellVoltages` grid on the battery control screen. iOS BMS parsing waits
for the CoreBluetooth protocol port and must use real board packets, not synthetic values.
