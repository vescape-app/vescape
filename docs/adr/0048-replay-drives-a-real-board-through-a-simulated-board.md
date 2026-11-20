# Replay drives a real Board through a Simulated Board

Supersedes ADR 0024. Its transport seam stays; what sits behind the seam and what sits around the
session changes.

## Status

Accepted.

## Context

ADR 0024 played a Debug Recording through the real session stack, but around a session that was not
real: a synthetic `replay:` board id with no row, Ride Recording off, auto-reconnect off, and every
write swallowed. Each feature keyed on the Board or the session needed its own replay exception, and
the features without one silently did nothing. Alert Rules are scoped per Board, so alerts never
fired. Group Ride presence was switched off. Config reads, Link Integrity, lights and tuning got
replies on the recording's schedule instead of answers to what the app asked. A fast-running
Session Clock existed only to warm up the live charts, and every timestamp crossing the session
boundary had to be restamped against it.

Replay is the way to exercise the app without a board, mostly on an Android emulator that has no
Bluetooth. It has to behave like riding.

## Decision

### The replay is a Board Session of a real Board

A replay starts for an existing Board the rider chooses (the selected one by default). It is an
ordinary Board Session for that Board: Alert Rules, Legal Mode, pack config, Ride Recording per
the rider's setting, Board Warnings, VESC Fault Occurrences, Group Ride and Public Ride presence,
saved Board Config Values, analytics and diagnostics all behave as they would on a ride. Nothing is
tagged as replayed. Debug Recording capture stays off so a replay never records itself.

**The recording is the hardware.** Transport (direct or CAN-forwarded), Link Identity (VESC
firmware, Refloat version, BMS presence) and poll interval come from the recording's own frames,
not from the Board row. Link Integrity then judges the recorded board on its own answers and
reaches `trusted` exactly as the recorded session did. The Board row's identity is never rewritten.

### A Simulated Board answers the app

`SimulatedBoard` implements `SessionTransport` in place of the GATT client:

- **Timeline.** Telemetry and BMS replies, any frame nothing asked for, and GPS fixes play at their
  recorded offsets. The app's own telemetry polls are swallowed while it plays.
- **Reply book.** Every other reply describes itself in its header, so the recording's replies are
  indexed by kind, not paired with the requests that produced them: firmware version, Refloat info,
  motor config, the config XML (reassembled once and sliced to whatever offset and length the app
  asks for) and config snapshots in time order. A request is answered from the book; a request for
  something the recording never answered gets no reply, exactly like a board that ignores it.
- **The board's own state.** Config writes are acknowledged and held, so the read-back verifies and
  later reads return them. Lights commands are echoed. Remote Tilt and Board Move are accepted.
  A config write recorded during the ride is applied at its offset, so a mid-ride config change
  replays too.
- **Controls.** Pause freezes the timeline and answers polls with the latest recorded state, so the
  link stays up. Loop restarts at the end. Drop link simulates a lost link: the ordinary dropout and
  reconnect path runs, and reconnecting resumes where playback stopped. The end of a recording
  without loop is the board powering off on purpose: the session ends like a stop.

Recordings without `tx` lines replay fully, because nothing depends on pairing requests.

### Replay Warmup prefills instead of running time fast

A caller that wants the live charts full from the start asks for a **Replay Warmup**. The warmup
span of the recording is decoded up front and stamped backwards from the moment playback starts,
then fed into live display state only: live telemetry points, the BMS series, the Battery SoC
Estimate window and the trail. It raises no alerts and records nothing. Playback then continues at
1× from the end of the warmup.

The Session Clock is removed. Every session reads wall time.

### Starting a replay

From the Debug Recordings screen, the dev menu, or the `vescape://dev/replay` deep link (recording,
Board, warmup, loop), which E2E flows and screenshot runs drive.

## Considered Options

- **Keep a synthetic Board and copy rules, pack and settings onto it.** Rejected: every new
  Board-scoped feature would need copying again, and the session would still not be one a rider can
  have.
- **Pair recorded requests with their replies.** Rejected: the app asks at different moments than
  the recorded session did (the config read starts before the recorded one), XML chunks must match
  the requested offset, CAN-wrapped requests come back unwrapped, and thinned fixtures carry no
  `tx` at all.
- **Keep the fast Session Clock for warmup.** Rejected: one dev feature made every timestamp in the
  session a question of which clock it came from, and leaked restamping into Group Ride. Prefill
  gives the same filled charts with display-only data.
- **An external BLE peripheral playing the recording.** Rejected for now: needs extra hardware and
  does not run on an emulator or in CI.

## Consequences

- Replaying onto a rider's real Board writes into its history and its saved config like a ride
  would. The next real connect re-reads config and may show a config change once. Use a Board from
  a restored backup when that matters.
- The Simulated Board is a dev tool, not a firmware model: it answers what the recording knows and
  what it can hold (config, lights). Anything else stays silent and times out as a real board that
  ignores a command would.
- Unit replay harnesses keep feeding decoded frames straight to detectors with recorded `t`; they
  never needed a session.
