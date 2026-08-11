# Debug Recording replay drives the real session stack through the transport seam

We need to test Board Warning detectors (and eventually most of the live-session stack) against real
board data without a board present: committed clean recordings guard against false positives, and a
dev-mode UI replay reproduces field behavior almost end-to-end. A Debug Recording already captures
every raw BLE `rx` chunk with relative timestamps, so everything the session stack ever sees is
replayable.

## Decision

Replay injects recorded chunks at the **transport seam** (`VescGattListener` / iOS peer): a
`ReplayTransport` fakes the connect/ready callbacks, emits recorded `rx` chunks, GPS fixes and phone
sensor readings at their recorded `t` on one merged timeline, and swallows writes. Playback is 1×
real time unless a caller asks for a warmup (below), and the recording owns position and heading for
the whole session. Everything above the seam — packet reassembly, telemetry pipeline, BMS pipe,
warning detectors, recording, live state, JS UI — runs unmodified and cannot tell replay from a live
board.

Two consumers share the chunk-decode core:

- **Unit replay harness** (test source, both platforms, `@parity` pair): fixture `.jsonl` →
  reassembler → `parseBmsValues` → detector under test, with recorded `t` as the clock (instant, no
  wall-clock wait). Fault scenarios are decode-level transform lambdas `(bms, t) -> bms` on top of a
  committed clean fixture in `shared/fixtures/` (ADR 0012 copy pipeline) — never byte mutation.
- **UI replay** (dev mode): started from the Debug Recordings screen, runs a real session under a
  synthetic `replay:<name>` board id so durable writes (warnings, ride recordings) stay separated
  from real boards and are deletable in one shot. Visible REPLAY badge; stop = normal disconnect.

iOS gains Debug Recording capture (removing the `@platform-diff` in `RecordingCoordinator.swift`)
so both platforms record and replay.

## Considered Options

- **Byte-level fault fixtures** (mutate BMS payloads + CRC into a second `.jsonl`). Rejected:
  needs a BMS re-encoder that exists nowhere else, produces an unreadable/undiffable artifact, and
  the clean run already exercises the byte→decode path end-to-end.
- **Detector-level mock feeding only** (no transport seam, hand-built frames). Rejected as the only
  mechanism: it cannot validate against real noise/timing, which is the whole false-positive story.
  It survives as the transform-lambda layer on top of replayed real frames.
- **Fast-forward replay with no clock injection.** Rejected: live series bucket samples by the
  timestamp each carries, so playing fast against wall time compresses a window's worth of ride into
  seconds of chart instead of filling it. Superseded by the Session Clock below, which runs time
  faster rather than compressing what is stamped onto it.
- **Dispatching the warmup as fast as it decodes**, with no rate. Rejected: an unbounded burst whose
  size depends on the device, and — with no speed to divide by — nothing downstream can adapt its own
  cadence to it. A Replay Speed makes the load predictable and the emit-rate fix a division.
- **Deriving a replay's compass from its GPS course.** Rejected: the ease curve turning a 1 Hz
  bearing into smooth rotation is invented motion, presented as if measured. Recording the compass
  costs one more line kind and replays what the phone actually read. Fixtures predating the line kind
  are backfilled from their own GPS bearings by `scripts/backfill-replay-heading.ts` — a built prop
  in a fixture file, which is a different thing from runtime code fabricating a sensor.
- **Full-real board id for UI replay.** Rejected: pollutes Ride History and warning stores of real
  boards; synthetic id keeps end-to-end write paths exercised while staying cleanable.

### Session Clock and Replay Speed

The session reads time through a **Session Clock** (`@parity` pair) instead of the system clock: a
real session gets wall time unchanged, and a replay gets one whose **Replay Speed** can run faster
than real time. Every timestamp a session stamps and every comparison against those timestamps goes
through it, so the timeline a session writes always agrees with the code reading it. The original
objection — that the controller reads wall clock in many places — is what the clock addresses rather
than works around. Unit replay harnesses are unaffected; they still pass recorded `t` directly.

A replay is 1× by default, so the Replay UI reproduces a ride exactly as it happened. A caller that
needs the live charts populated up front — the screenshot run, an E2E flow — passes a warmup window
and a speed: the clock starts one window in the past, runs at that speed until session time reaches
the present, then drops to 1× for the rest of playback. Samples land stamped across the span they
actually cover, so the window is genuinely full the moment the warmup ends.

Speed is deliberately readable rather than internal to pacing. Wall-clock throttles that guard a
resource stay on wall time, but ones whose _rate_ should track the data feeding them — the
`LiveSeriesEmitter` bridge throttles — divide their interval by it. Without that, a warmup hands JS
a minute of ride in a couple of enormous batches and the charts jump instead of fast-forwarding.

### Replayed phone sensors

A recording captures what the board sent, but a ride also has state only the phone can see, and the
phone replaying it is usually lying still on a desk. Each such signal follows the same four steps:

1. **Recorder** — a new `kind` line (`location`, `phone-heading`).
2. **Decoder** — a parallel decode function on the shared decode core.
3. **Transport** — a `ReplayEvent` case, merged into the one ordered timeline.
4. **Delivery** — applied natively where native owns the signal (GPS fixes go through
   `onLocationUpdated`), or emitted to JS where JS does (the compass is read via `expo-sensors`, so
   native can only store and replay it; JS re-encodes it at the sensor boundary through a
   `PhoneHeadingAdapter`).

Step 4 is the one that varies, and it follows ownership: the replay stands in wherever the real
signal enters the app, so everything downstream runs its production code path.

## Consequences

- `BoardSessionController` needs transport injection (today it constructs `VescGattClient`
  internally) — a factory/interface seam on both platforms.
- Request/response FSMs (config read, Link Integrity probe) receive replies on the recording's
  schedule, not theirs; usually aligned since the original session issued the same requests, but
  occasional timeouts during replay are accepted dev-tool behavior.
- Committed clean fixtures make real-ride false positives CI failures: a detector change that fires
  on a healthy recorded ride must be investigated, not snapshotted away.
- Config-scoped detection is replayable too (the v1 "telemetry-only" cut was lifted): a harness
  drives the **real** `ConfigRW` controller/FSM with the recording's reassembled `rx` packets to
  reconstruct the Refloat config read, then feeds the decoded `ConfigSafetyValues` to
  `ConfigSafetyDetector`. No FSM re-implementation — the same schema parser and config decoder the
  live session uses run in the harness; only request sending and side effects are stubbed. Fault
  scenarios transform the decoded config values (never bytes). The one real-recording caveat: the
  fixture must contain a completed config read (Thor301 does).
