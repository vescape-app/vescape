# BLE write chunking, urgent neutral ordering, and Refloat remote-input timing

VESC BLE links and Refloat remote inputs drive a self-balancing vehicle (see `docs/vescProtocol.md` for the ADV2 `6e400002` NUS quirk and `docs/remote-tilt.md` for `RemoteInputArbiter` ownership rules).

- **Atomic `ATT MTU − 3` frame chunking (`VescWriteQueue`):** BLE modules like Floatwheel Atom drop the link on GATT long writes. Every frame larger than `ATT MTU − 3` (20 bytes until negotiated) MUST split into consecutive chunks with **no other write interleaved mid-frame** (a failed chunk drops the rest of its frame). On iOS, read the limit from `maximumWriteValueLength(for: .withoutResponse)` — `.withResponse` always returns 512 because CoreBluetooth performs long writes.
- **Urgent neutral/stop protection:** an urgent stop/neutral dispatches at the next frame boundary (never mid-frame), and routine remote ticks MUST NEVER overwrite an unsent urgent stop in the replaceable remote-input slot.
- **Distinguish app arbitration from firmware safety:** Refloat firmware owns the disengaged/parked gate for Board Move. The app arbiter refuses Board Move while a riding sensor is actively correcting and issues a neutral for displaced manual tilt/decay before starting Move, without verifying engagement or waiting for neutral delivery.
- **Bounded slew rate:** neither tilt cancel nor sensor drive may step straight to neutral/target — a sudden angle step makes a self-balancing controller surge and throw the rider.
- **Refloat 1.0–1.2 `RC_MOVE` repeat cadence:** `RC_MOVE` is a ~1 s duration packet that zeroes and re-ramps move current on every receipt; repeating at the 1.3+ 100 ms cadence restarts the ramp 10×/sec and stutters the motor. Repeat `RC_MOVE` at ~700 ms inside its ~1 s window.
