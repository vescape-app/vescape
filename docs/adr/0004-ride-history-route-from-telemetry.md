# Ride History routes come from Telemetry Samples

## Status

Storage and shared-timeline decisions superseded by ADR-0038. Ride Track supplies the route; GPS movement can extend the shared history seek bounds and Time while Board readings remain unavailable in telemetry gaps. Distance, average speed, and top speed remain Board-based. GPS alone still does not start a Ride Recording. The original decision below is retained as historical context.

Ride History derives routes from GPS fixes attached to Telemetry Samples. Standalone phone GPS updates remain part of Live State only and do not create or extend Ride Recordings.

## Considered Options

- **Persist a separate history GPS stream.** Rejected because it creates two durable timelines for one Ride Recording. Map routes can extend beyond board telemetry, while graphs and seek controls remain telemetry-bound.
- **Filter standalone GPS at render time.** Rejected because durable truth would still contain GPS-only Ride History data and every caller would need to remember the same filtering rule.
- **Store GPS only with telemetry.** Chosen because Ride Recording is board-owned: GPS enriches Telemetry Samples, but does not define the recording by itself.

## Consequences

- ~~Historical routes, graphs, summaries, and seek controls share the same telemetry-owned timeline.~~
  **Retired.** There is no single telemetry-owned timeline any more. Route and graphs are two streams
  joined on time, and the Ride Track can be longer than the telemetry, so each read path answers for
  itself: the route draws the whole track; graphs stay telemetry-bound and show honest gaps rather
  than interpolating; Distance, average speed and top speed stay board-based whatever the track does;
  and the scrubber spans one combined, natively precomputed Moving Window that GPS movement can
  extend past the last telemetry sample. One shared read-side precision rule (20m reported accuracy,
  both platforms, provider-independent) decides which stored fixes may draw or evidence movement.
  See ADR-0038 and `docs/history.md`.
- Existing GPS-only history rows are dropped by migration.
- Live map GPS behavior is unchanged; approximate and precise phone fixes can still update Live State without becoming Ride History.
- ~~A GPS outage during a ride leaves telemetry samples without route points for that span instead of creating a separate route stream.~~ Superseded by ADR-0038: the Ride Track is that separate stream, and a gap in either stream is now a gap in that stream alone.
