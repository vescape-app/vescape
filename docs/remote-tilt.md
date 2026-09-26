# Remote Tilt

Remote Tilt sends temporary Refloat remote input, with 128 neutral on the 0–255 scale.
Native owns the held value, lock, and return ramp. The displayed value describes the commanded
input, not measured board pitch.

The pad has explicit presentation ownership:

- Finger down: Gesture Handler updates shared values on the UI thread. Changed tilt intents reach
  native at most every 100ms while dragging. Native repeats its current input independently.
- Finger lifted: retain the release position until native acknowledges release or lock. The
  `Applying…` label belongs to this handoff, never to active finger tracking.
- Returning: one Reanimated progress value drives thumb position, percentage, and countdown.
  Repeated snapshots of the same decay do not restart the animation.
- A newer gesture invalidates older command acknowledgements and reads. Interrupted gestures
  cancel rather than lock. Disconnect/unmount drops unsent commands; unmount during touch cancels.

The mounted pad reads native control state directly, independently of telemetry publication.
Reads and tilt intents run on the main queue on Android and iOS, alongside controller ticks.
The command queue serializes bridge calls and coalesces unsent drag values. Release/cancel discards
unsent holds so an old held value cannot arrive after it. Cancel remains available after link trust
is lost, provided the active connection can still carry it.

The Board component showcase uses a simulated receiver, including optional 450ms command latency
and a counter of received drag commands. It never controls a connected Board. Regression tests cover
ownership, stale completions, countdown continuity, and command ordering under delayed responses.

## Wrist stick

The Watch Mirror's Tilt page (the first control page, before Board Move) drives the same manual
slot as the pad. It is a rate stick: vertical deflection from wherever the thumb lands sets how fast
the tilt changes (8 dp deadzone, quadratic up to the rider's `wearTiltRatePercent` per second at
60 dp), and releasing leaves the value in place.

- Every change is an absolute `TILT_LOCK` wrist command (`[4, value]`), at most every 100 ms plus
  one on release, relayed into `lockRemoteTilt`. Absolute values mean a lost tick costs a step of
  resolution, never a drifted angle. A reset never lands before an earlier lock: Wear OS coalesces
  lock and cancel into one latest-wins slot, and watchOS relies on WatchConnectivity's in-order
  delivery.
- **No dead-man, unlike Board Move (ADR-0033).** A lock is a setpoint the rider chose to leave, not
  motor output: it stays when the wrist sleeps, leaves the page or drops out of range, and ends only
  on a cancel, a Board Move, or the Board Session ending.
- Double tap resets with `TILT_CANCEL` (`[5, 0]`) into the ungated cancel, eased as above. The first
  tap only arms the reset for 700 ms, so a stray touch cannot drop a tilt being ridden on.
- The Watch Frame carries the commanded value and a `tiltControl` code (free, manual, sensor, move,
  blocked). The readout shows the phone's value, so a pad change shows on the wrist and seeds the
  next drag; the stick is read-only whenever the arbiter or link trust would refuse a manual command.
- A non-neutral tilt also shows on the gauges page, on the navigation distance's line, and the Move page warns that
  starting a Move clears it.

Fixture replay on an emulator echoes the wrist's locks into its frames, so the stick can be felt
without a phone; a replayed cancel snaps to neutral rather than easing.

## Command ownership

Refloat has one temporary remote input, and three things in this app want it: the rider's pad, Board
Move, and a calibrated ground-clearance Accessory. A single native arbiter owns that slot; nothing
reaches the tilt or move controllers around it. `remoteTilt.owner` reports the winner
(`none | manual | sensor | move`), derived from the streams themselves rather than remembered, so an
owner cannot outlive the stream that claimed the slot.

- **Sensor over manual.** While a configured ground-clearance Accessory is connected, manual tilt is
  refused natively and the pad renders as a read-only indicator of commanded tilt. Arming also
  cancels a tilt the rider was already holding — a lock never ends on its own and would hold the slot
  against the binding for the rest of the session.
- **Board Move over a pending release, never over a live correction.** Starting a Board Move drops
  any tilt stream still easing down to neutral in one write, because a pending decay interleaving its
  packets with move packets is the two of them fighting over one byte. A sensor that is _actively_
  correcting refuses the Move instead: a Board asking for ground-clearance correction is a Board
  being ridden, and jogging one is not a request this app passes on.
- **Cancel stays ungated.** It remains the rider's way out whoever owns the slot and whatever the
  link trust is. It is not an off switch for the binding: a sensor still holding valid readings takes
  the slot back on its next tick, ramped from where the cancel left it.
- **Sensor input never steps.** Sensor-driven commands ease toward their target at the same bounded
  rate a cancel eases at, so neither arming mid-ride nor a discontinuous reading — a pothole under the
  sensor is a full-range swing in one 20 Hz sample — can hand the firmware an instant angle error.
  Steady state still follows the readings exactly; only the rate of change is bounded.

The binding's own release conditions, Board-side and Accessory-side, are tabulated in
[native-api.md](./native-api.md#ground-clearance-tilt).

Native limitations remain: return durations are quantized to the existing 100ms controller tick and
the GATT write queue still lacks a write-completion watchdog. Neither the UI rework nor the ownership
arbiter claims to resolve those transport/controller concerns, and no part of the sensor binding has
been validated against a ridden board. Native bridge changes require rebuilding the development app
on each platform.
