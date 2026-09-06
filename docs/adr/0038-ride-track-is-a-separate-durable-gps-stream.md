# Ride Track is a separate durable GPS stream

A **Ride Track** — every **GPS Fix** the phone produced during a **Ride Recording**, stored on its own
clock with its reported accuracy — becomes the durable home for ride position. GPS is no longer written
as `latitude_e7` / `longitude_e7` / `accuracy_cm` columns on a telemetry frame, and a **Ride Recording**
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
- Migration moves existing frames' position columns into the Ride Track and drops them. Rides recorded
  before the migration gain no new points; their tracks stay exactly as sparse as their telemetry was.
- A ride outliving its Board needs an ending rule that does not depend on the Board. Idle Pause
  (ADR-0021) is the existing pattern. Getting this wrong drains the phone: on iOS the active location
  manager is what keeps the process alive at all (ADR-0034), so a ride that never ends is a ride that
  never stops consuming GPS. A hard timeout is required, not optional.
- Privacy Zones (ADR-0009) must drop Ride Track points, not only telemetry samples. Under ADR-0004 a
  suppressed sample took its position with it; a separate stream will leak position through a zone
  unless it is filtered on its own.
- Ride Track is not covered by the server backup contract, which accepts frames and buckets keyed on
  `boardId`. Until that is extended, a restored app has telemetry and no route.
