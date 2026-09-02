---
status: accepted (extends ADR-0005)
---

# Ride History trims to a precomputed Moving Window

The Ride History timeline plots Telemetry Samples against wall-clock time, so a board left on but not moving (forgot to turn off, waited before riding, stood talking after a ride) draws long flat segments that are often longer than the ride itself. The Time stat is wall-clock (`endAtMs − startAtMs`) and counts all that idle, while Avg Speed is already moving-based — so the two disagree about what the ride was.

We introduce a **Moving Window**: the span of a Ride Recording from its first to its last _moving_ Telemetry Sample, where "moving" reuses the existing per-sample speed exclusion (`!excludedFromAvgSpeed`, i.e. above `movingSpeedThresholdKmh` and not free-spin). The window is **computed and persisted natively** per minute bucket as `first_moving_at_ms` / `last_moving_at_ms`, aggregated into a session's `movingStartAtMs` / `movingEndAtMs`. Both the history detail (chart x-range, seek bounds) and the Time stat read this one window, so list and detail can never disagree.

Trimming is **ends-only**: leading and trailing non-moving spans are cropped; internal stops (photos, cooldown, a chat mid-ride) stay inside the window and still count toward Time. The chart crops to the Moving Window **± 5s display padding** (clamped to session bounds) so the full stop→start transition stays visible; the padding is display-only and never enters the Time number.

A Ride Recording with **zero** moving samples (board on, never actually ridden) is **hidden everywhere** — the Ride History list, detail navigation, and profile `rideCount`. This reuses the existing `movingSpeedSampleCount` and needs no schema change: a genuinely empty ride aggregates to `avgSpeedSampleCount === 0`, distinct from a legacy ride whose count was never computed (`null`, which falls back to `sampleCount > 0` and stays visible). One native `groupRideSessions` implementation owns this predicate for both complete Ride pages and Profile Stats; JS no longer groups minute buckets.

## Considered Options

- **View-only trim in JS, Time left wall-clock.** Rejected: history reads a large sample stream and native owns durable truth; a JS-side scan duplicates the native moving classification, and leaving Time wall-clock while the chart is trimmed makes the same ride show two durations (list vs detail).
- **Redefine rides — split on long internal idle.** Rejected: internal stops are meaningful (photos, letting the motor cool), so they must stay part of the ride. Only the ends are noise.
- **Concatenate active spans, collapse internal idle to a marker.** Rejected for the same reason — and it adds splice/marker complexity for no rider benefit once ends are trimmed.
- **A separate min-moving-run duration to reject mid-conversation "touch" spikes.** Deferred: a touch is usually already caught by the low-speed/free-spin exclusion (and `toExcludedRanges` merges sub-2s blips), so the extra knob earns little. A real >threshold roll after a long idle will set the trim endpoint — accepted trade for simplicity.
- **Make Time pure moving time (exclude internal stops too).** Rejected: contradicts keeping stops visible; the Moving Window is a riding _span_ (ends trimmed), not pedaling time.

## Consequences

- New `MIGRATION_21_22` (DB version 22) adds two nullable bucket columns; the builder fills them off the existing `!excludedFromAvgSpeed` check (mirrors migration 9→10 for moving avg speed). Legacy buckets keep `null`.
- Legacy Ride Recordings (null Moving Window) fall back to their full wall-clock span and render untrimmed — consistent with ADR-0005's "existing history keeps older derived values," and no backfill is triggered on read.
- Time changes meaning from wall-clock to riding span; Distance (odometer) and Avg Speed (already moving-based) are unchanged, as are durable Telemetry Samples and the grey "Low speed" / "Free spin" chart coloring.
- Zero-movement rides disappear from history and `rideCount`. Edge case: a genuine ride where GPS dropped and free-spin over-excluded every sample reads as zero movement and is hidden — accepted as rare.
- The trim window and the hide rule are two independent slices: hiding needs no schema change; trimming + matching Time needs the two columns.
