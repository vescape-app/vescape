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

Native limitations remain: return durations are quantized to the existing 100ms controller tick;
the GATT write queue still lacks a write-completion watchdog; Board Move shares its remote-input
slot. This UI rework does not claim to resolve those transport/controller concerns or validate riding
behavior. Native bridge changes require rebuilding the development app on each platform.
