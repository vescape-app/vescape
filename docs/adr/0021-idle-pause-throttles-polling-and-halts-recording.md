# Idle Pause throttles polling and halts recording when stationary

A board left connected and recording while parked keeps polling at full rate and keeps persisting Telemetry Samples. ADR-0017's Moving Window already trims that idle tail from the _display_ and from the Time stat, but the cost is still paid: the BLE radio polls full-rate (battery), the 2 Hz detail trace keeps writing frames (DB growth), and the full-rate bucket `sample_count` keeps climbing (the alarming "57k points" on a 35-min ride was ~26k of those from a 38-min parked tail). Trimming is a read-time concern; it does nothing for the write-time cost.

## Decision

Introduce an **Idle Pause**. While a Ride Recording is active and the Board Session is live, if the board produces no _moving_ Telemetry Sample (speed below `movingSpeedThresholdCentiKmh` — the same classification the Moving Window and sanitizers use) for a sustained interval (**30 s**, tunable), the recording enters Idle Pause:

- **Poll loop drops to ~1 Hz** via `PollingLoop.setPollIntervalMs` — the keepalive rate both saves battery and supplies the speed signal needed to detect resumption.
- **Sample persistence stops** — `BoardSessionController` stops calling `RecordingCoordinator.recordTelemetry`, which cuts _both_ the 2 Hz detail frames and the full-rate bucket aggregation in one place. No idle samples reach the DB and the `sample_count` stops climbing.
- A **Ride History Marker** (`type = "auto_pause"`) is recorded so the resulting gap is explained for debugging.
- The paused state is surfaced in Live State so JS can show a "Paused — idle" badge.

Resume is asymmetric and instant: the first poll with speed at or above the threshold restores the configured poll rate and resumes `recordTelemetry`. Slow-to-pause / instant-to-resume prevents flapping at traffic lights.

Detection lives **native**, in the `BoardSessionController` hot path that already sees each sample's speed and already owns the `setPollIntervalMs` call — consistent with CLAUDE.md ("native owns durable truth and long-lived work").

## Why pause is acceptable here when ADR-0009 rejected it

ADR-0009 (Privacy Zones) rejected "pause recording inside zones" because a recording-state change "could expose privacy-boundary timing in the UI" — a _privacy_ concern about leaking where a rider's home/work zone is. Idle-parked has no secret to leak, so making the pause visible is fine and even desirable UX. The rejection's reasoning is privacy-specific and does not transfer; this ADR records that distinction so the contradiction is not mistaken for an oversight.

## Considered Options

- **Throttle poll rate only, keep recording on.** Rejected: at 1 Hz the bucket `sample_count` still climbs and the rider gets no clear "why is it not recording" signal; an explicit Paused state is more legible.
- **Drop idle samples at the persistence boundary (Privacy Zone pattern), no throttle.** Rejected: kills DB growth and the counter but leaves the radio polling full-rate, so battery — an explicit goal — is untouched.
- **Auto-stop / disconnect the whole Board Session on prolonged idle.** Rejected: kills Group Ride presence and the Watch Mirror, and forces a full reconnect on resume. Too aggressive for a parked board the rider is about to ride again.
- **Remove the Moving Window now that idle data is sparse.** Rejected: orthogonal concerns. Idle Pause is write-cost; the Moving Window is read-semantics (ride boundaries, the Time stat, hiding zero-movement rides). Removing it reintroduces every bug ADR-0017 fixed — Time would count the idle span again regardless of how few samples it holds.

## Consequences

- Live display, Watch Mirror, and Rider Presence are unaffected — they run off the cold-path emit / SharedValues path (ADR-0013), which keeps publishing at the 1 Hz keepalive rate. Alerts still evaluate per poll (latency degrades to ~1 s while parked, acceptable).
- A mid-ride stop longer than the threshold now produces a clean **gap** instead of a flat low-speed line. Because the gap sits between two moving spans, it stays **inside** the Moving Window and still counts toward Time — consistent with ADR-0017's "internal stops stay in the ride."
- A pause longer than `GAP_BOUNDARY_MS` (90 s) also trips the existing automatic `"gap"` marker on resume; the `"auto_pause"` marker adds the _reason_.
- Scoped to recording-active for v1. A board connected and parked but **not** recording still polls full-rate; idle-throttling the Board Session independent of recording (a larger battery win) is deferred until that case proves to matter.

## Ride Track amendment

Idle Pause pauses Telemetry Sample and Ride Track persistence together, and resumption enables both streams together. Keeping GPS writes active while the UI reports recording paused would retain the rider's movements during the pause. Live GPS consumers remain unaffected. #448 applies this shared persistence gate; #450 defines pause and resume detection when the Board Session is no longer live.

While connected, Board movement controls Idle Pause; phone movement cannot override a stationary Board. After unexpected Board disconnection, GPS recording continues without GPS-based Idle Pause. Disconnected recording continues until explicit rider stop, without an automatic timeout.
