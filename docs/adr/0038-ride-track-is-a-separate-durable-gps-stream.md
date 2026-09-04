# Ride Track is a separate durable GPS stream

A **Ride Track** — every **GPS Fix** the phone produced during a **Ride Recording**, stored on its own
clock with its reported accuracy — becomes the durable home for ride position. The complete recorded GPS fix moves out of the telemetry frame: coordinates, reported accuracy,
GPS speed, raw bearing, altitude, and fix timestamp live in Ride Track, and a **Ride Recording**
no longer ends when its **Board Link** does: it continues on GPS alone and telemetry resumes into the
same recording if the Board comes back.

## Status

Accepted. Supersedes the storage half of ADR-0004.

ADR-0004 bundled two decisions. The first — _store GPS only with telemetry_ — is reversed here. The
second — _standalone GPS does not create a Ride Recording_ — still stands: a Board still starts a ride,
rides are still keyed on `board_id` (ADR-0028), and `CONTEXT.md`'s example dialogue is unchanged. Only
the storage shape and the ride's lifetime change.

## Context

Under ADR-0004 a fix was kept only if a telemetry frame arrived within the age gate
(`TELEMETRY_LOCATION_MAX_AGE_MS`, 10s) and the fix passed the precision gate (20m). Miss either and the
fix was discarded permanently. There was no row a fix could occupy on its own — position lived in three
nullable columns on `telemetry_frames`.

The consequence ADR-0004 accepted ("a GPS outage during a ride leaves telemetry samples without route
points") turned out to run the other way round far more often: a _board_ outage leaves the rider's own
position unrecorded, even though the phone knew exactly where it was the whole time. On iOS this
compounds — the Board Session teardown stops the GPS monitor outright, so a board drop lengthens the
hole rather than merely starting it.

The product direction is that telemetry stops being load-bearing: speed and distance should be
derivable from the phone when no VESC is present. That is impossible while position is a decoration on
a telemetry row.

## Considered Options

- **Keep stamping fixes on frames and additionally write a Ride Track.** Rejected: this is genuinely
  the two-timelines problem ADR-0004 feared. The same fix persisted twice, in two places, free to
  disagree after any change to either filter.
- **Mint a placeholder Board so boardless rides have something to key on.** Deferred, not rejected.
  ADR-0028's migration already used this trick for unresolvable rows, so it works — but it stops working
  the moment a rider owns two non-VESC boards or objects to a fabricated Board in their Board list.
  Boardless rides are a separate decision; this ADR does not need it.
- **Discard poor fixes on write, as today.** Rejected. Write-time discard is unrecoverable and encodes
  one consumer's threshold as everyone's. Route drawing wants a strict threshold; a future GPS-derived
  speed may want a looser one. Store the accuracy, decide on read.

## Consequences

- Fixes are kept with their reported accuracy, including poor ones. The precision rule moves to read
  time, which also dissolves the Android/iOS `isPreciseGpsFix` mismatch (Android additionally requires
  `GPS_PROVIDER`; iOS has no provider concept) — it stops being a durable-data difference and becomes
  one shared read-side rule.
- Route and graphs no longer share one timeline. Every read path that renders a ride must decide what
  it does when the track is longer than the telemetry — the scrubber, distance, summary and graphs.
  This is the real cost, and it lands squarely in ADR-0005's precomputed read paths.
- Migration moves all existing frames' raw GPS fields into Ride Track and drops those columns. Rides recorded
  before the migration gain no new points; their tracks stay exactly as sparse as their telemetry was.
- Unexpected BLE loss preserves the rider's recording intent while reconnect attempts continue.
  Recording ends on explicit rider stop or Disconnect, not an elapsed-time limit.
- Privacy Zones (ADR-0009) must drop Ride Track points, not only telemetry samples. Under ADR-0004 a
  suppressed sample took its position with it; a separate stream will leak position through a zone
  unless it is filtered on its own.

## Recording gates

Ride Track persistence follows the Ride Recording state: Idle Pause pauses both streams, and resumption enables both together. Enabled Privacy Zones use the existing reported-coordinate geometry, without expansion by GPS accuracy. Keeping poor fixes does not override either gate.

Privacy Zones keep the current drop-on-write behavior for this release. Reuse existing reader gap checks without adding continuity flags, segment identities, privacy markers, or new privacy-specific gap detection. Short filtered spans retain the existing continuity limitations. Recording inside zones, sharing prevention/warnings, and Group Ride invisibility belong to a future Privacy Zone rework, outside #452. See the interim scope in ADR-0009.

## Recording identity and history boundaries

New Ride Recordings have a durable identity and explicit start/end boundaries, independent of their Board Sessions and sample arrival. `board_id` remains Board attribution; it does not distinguish two recordings of the same Board. Both streams and their precomputed summaries must remain attributable to the recording that captured them.

One new recording produces at most one history entry, subject to the existing movement visibility rule. Unexpected disconnect, Idle Pause, process interruption, and even an hour with neither telemetry nor GPS do not split an open recording. Reconnection and supported restoration recover the same recording identity. Explicit Stop Recording or Disconnect ends it; starting again creates a separate recording even within the same minute. Minute aggregation must not merge those recordings.

Gap-based grouping was rejected for new recordings because it can split a capture the Rider never stopped. `rideSplitGapMinutes` applies only to legacy history without durable recording boundaries. Migration preserves that existing grouping behavior rather than inventing old recording identities from sparse samples. The setting's UI must explain its legacy-only scope.

Missing samples remain missing. When movement is evidenced before and after a gap in the same recording, the gap remains inside the Moving Window and counts toward Time. This does not imply uninterrupted capture, interpolate either stream, or change Board-based distance and speed statistics.

#448 owns the durable identity/boundary storage contract and stream attribution, #449 reads that contract for grouping and precomputed summaries, and #450 preserves or ends it through recording lifecycle transitions. Agree this shared contract before implementing the storage migration; the three issues still ship together in #452.

## History distance

Ride History Distance remains board-odometer-based. A longer Ride Track does not switch Distance to GPS or add GPS-derived distance to the odometer result. The route and the Distance metric can therefore cover different spans when telemetry is unavailable.

GPS movement can extend the Moving Window, history timeline, and ride duration beyond telemetry coverage. Unavailable Board readings remain gaps while the GPS route continues. These bounds are precomputed natively as required by ADR-0005.

History uses one reported horizontal-accuracy limit of 20m on both platforms for route points and GPS movement evidence. Fixes with worse or unavailable accuracy remain stored but do not qualify for those reads. This rule does not depend on Android provider identity and does not change live GPS classification.

A qualifying GPS fix counts as movement when its reported speed meets the existing rider-configured movement threshold, default 3 km/h. Missing speed is not movement evidence, but does not disqualify an otherwise accurate route point. Do not infer movement speed from coordinate displacement for this rule.

Average and top speed remain board-telemetry-based. Preserve their existing aggregation and sanitizer rules; do not blend in GPS speed or recalculate average speed from Distance divided by the extended ride duration.

## Read composition

The two streams are joined on time at read, never at write, and never re-clocked onto each other.

- Telemetry Samples carry no position at all. The route is the Ride Track, read on its own clock;
  the seek pin, the preview route and media matching all read that one stream.
- Only fixes passing the shared precision rule cross the bridge, so the rule is applied once,
  natively, rather than by each consumer. Minute buckets still count every stored fix
  (`gps_point_count`) but derive only from qualifying ones: route anchor, step distance, and GPS
  movement evidence.
- Minute buckets stay keyed `(bucket_start_ms, board_id, recording_id)`, and a minute holding only
  Ride Track fixes creates its own bucket — a board dropout is exactly when the track matters most.
  Track-only buckets carry no Telemetry Samples, so they never move a sample-based statistic.
- The Metric Sanitizers read the Ride Track directly for the free-spin speed comparison, rather than
  a fix synthesised back onto a sample. Live sanitization uses the fixes the packets arrived with,
  which is the same rule against the live equivalent of the stream.

## Disconnect intent

Unexpected Board connection loss allows the active Ride Recording to continue on GPS. An explicit rider Disconnect ends Ride Recording, as does an explicit Stop Recording. Continuing across connection loss does not override a rider's stop intent.

An explicit Connect request for a different Board ends the previous Board Session and Ride Recording immediately, including when the previous Board is disconnected and reconnecting. A failed connection to the new Board does not reopen the old recording. Merely browsing or selecting another Board does not end it. Once the new Board connects, a new recording may start under the existing automatic/manual recording rules; GPS captured between the two recordings is not backfilled into either.

Admitted writes for the old recording are flushed with their original Board and recording identities. Late callbacks, reconnect attempts, or restoration for the old Board cannot revive that recording or contribute samples to the new one. Each Board change creates a separate capture boundary, even within one minute. Independent live GPS consumers keep their existing lifetimes.

While connected, the Board controls Idle Pause, even when the phone moves. Unexpected disconnection continues GPS recording without GPS-based Idle Pause; it remains active until the rider explicitly stops it.

The earlier mandatory hard-timeout proposal is rejected. A rider who lost BLE while riding expects capture to continue for the duration of reconnect attempts. Neither elapsed disconnection time nor GPS inactivity ends or pauses that capture. Platform process suspension or termination can still leave real gaps; never fabricate missing fixes.
