# VESC PIN Lock (upstream research)

**Status: not implemented in Vescape.** This documents an upstream firmware feature we may adopt.
Nothing in `modules/vescape-core/` or `src/` speaks these commands today.

## What it is

A write-lock on the VESC: with a PIN set, the controller answers reads normally but ignores every
configuration write until unlocked. Intended to stop other people (or yourself, on the wrong board)
from changing your tune — not theft protection.

Not in mainline `vedderb/bldc`. Lives in surfdado's fork:

- Branch: <https://github.com/surfdado/bldc/tree/v65_pinlock_v2>
- Builds: <https://github.com/surfdado/bldc/releases>
- Feature description: <https://pev.dev/t/feature-description-pin-locking/815>

## Why not the existing `pairing` flag

`app_conf.pairing_done` is **not enforced by firmware**. `COMM_FW_VERSION` ships it as one byte
(`bldc/comm/commands.c`), and the check lives entirely in VESC Tool
(`vescinterface.cpp`, `if (params.isPaired && !hasPairedUuid(mUuidStr))` — a local QSettings list).
Any third-party client, Vescape included, ignores the byte and connects. It also keys on UUID, so
you cannot grant a friend access from memory.

BLE encryption on VESC Express is the opposite problem: it locks out unauthorized clients
completely, so a friend borrowing the board cannot even read speed.

## PIN semantics

- 4 digits, `1`–`9999`. `0` means no lock.
- Stored in EEPROM, like the odometer.
- Not in AppCFG XML, not in backup/restore.
- **Cleared by a firmware upgrade** — must be set again.
- Survives loading a new Float/Refloat package (loading a package requires unlocking first).
- Write-only over the wire; tools cannot read it back (see dev-build caveat below).
- USB is always writable by design — physical access implies ST-Link access anyway.

`lock_on_boot` makes the board come up locked after every power cycle. So lock _state_ is per
session; lock _capability_ is per firmware.

## Commands

Ids from `datatypes.h` on the fork branch:

| Id  | Command                 |
| --- | ----------------------- |
| 153 | `COMM_LOCK_SETPIN`      |
| 154 | `COMM_WRITE_LOCK`       |
| 155 | `COMM_LOCK_STATUS`      |
| 157 | `COMM_WRITE_UNLOCK_CMD` |

### `COMM_LOCK_STATUS` (155)

Request, magic byte then PIN as big-endian `uint16`:

```
[155][magic=169][pin_hi][pin_lo]
```

Reply:

```
[155][169][writelock][pin_matches][pin_is_set][lock_on_boot][pin_hi][pin_lo]
```

Detection is a **probe plus timeout** — there is no capability flag in `COMM_FW_VERSION`, and stock
firmware silently drops unknown packet ids. A reply carrying magic `169` means pinlock firmware.

⚠️ The last two reply bytes are the stored PIN in cleartext, marked in-source as development-only
and unsafe. Do not build on them; they will be removed.

### `COMM_WRITE_UNLOCK_CMD` (157)

Pass-thru envelope: unlocks for exactly one inner packet, then re-locks.

```
[157][pin_hi][pin_lo][ ...inner packet... ]
```

The inner command's reply comes back through the same `reply_func` unchanged, so response decoding
needs no changes — only the encoder wraps. Preferred over "unlock, write, re-lock": no window where
a second BLE link (internal + external BLE boards) can slip a write in.

**Failure is silence.** A wrong PIN produces no reply at all. A wrapped write therefore needs a
timeout followed by a `COMM_LOCK_STATUS` call to tell a bad PIN from a dropped packet.

### Bruteforce cooldown

Each failed PIN attempt doubles `writelock_pin_attempt_cooldown` and stamps
`writelock_last_failed_pin_attempt`. During cooldown `pin_matches` returns `0` even for the correct
PIN. The cooldown only resets on success. Consequences:

- Blind retry of a failed write keeps doubling the cooldown — never retry a `157` blindly.
- A capability probe with PIN `0` against a board that has a PIN counts as a failed attempt.
  `pin_is_set` and the magic byte are returned regardless of cooldown, so a probe can read those
  and ignore `pin_matches`.

### Odometer back door

`bldc/comm/commands.c` in the fork clears the writelock, with no PIN, when `COMM_SET_ODOMETER`
writes a value within 2000 m of the current odometer. It exists so older VESC Tools can unlock.
It also means anyone who can read the odometer off the display can unlock the board.

## What is blocked while locked

Outer allowlist (everything else is dropped): `COMM_FW_VERSION`, `COMM_GET_MCCONF`,
`COMM_GET_APPCONF`, the `COMM_GET_VALUES*` family, `COMM_GET_DECODED_BALANCE`, `COMM_GET_STATS`,
`COMM_RESET_STATS`, `COMM_SET_ODOMETER`, `COMM_GET_CUSTOM_CONFIG`, `COMM_CUSTOM_APP_DATA`,
`COMM_LOCK_STATUS`, `COMM_GET_QML_UI_*`, `COMM_BMS_GET_VALUES`, `COMM_CUSTOM_HW_DATA`,
`COMM_WRITE_LOCK`, `COMM_TERMINAL_CMD*`, `COMM_WRITE_UNLOCK_CMD`.

`COMM_CUSTOM_APP_DATA` passes the outer gate then gets filtered by float command:

```c
if ((magicnr == 101) && (floatcmd > 1)
    && (floatcmd != 10)   // GET_ALLDATA
    && (floatcmd != 24)   // LCM_POLL
    && (floatcmd != 28))  // CHARGESTATE
    return;               // rejected
```

`101` is our `REFLOAT_MAGIC` (`modules/vescape-core/ios/protocol/VescProtocol.swift`). So on a
locked board **telemetry polling is unaffected and Refloat tune writes are silently dropped**, with
no error reply.

## Flashing the fork

Possible over BLE with VESC Tool mobile (Firmware tab, custom file). Requires a bootloader and a
`.bin` matching the exact hardware target. An interrupted transfer can leave the controller without
valid firmware, recoverable only over USB or ST-Link.

Vescape does not implement flashing. The commands are `COMM_JUMP_TO_BOOTLOADER` (1),
`COMM_ERASE_NEW_APP` (2), `COMM_WRITE_NEW_APP_DATA` (3), plus `_LZO` (81) and `_ALL_CAN` variants.

After any flash: PIN is cleared, config needs backup/restore, package may need reloading.

## Tradeoff

Adopting this means leaving mainline firmware for a community fork on a board you ride.
