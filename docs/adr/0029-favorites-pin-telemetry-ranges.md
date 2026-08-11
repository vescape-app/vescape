# Favorites pin telemetry ranges

A Favorite is a durable, optionally named time range `[startMs, endMs]` over telemetry history, stored in a native table in the telemetry DB on both platforms. It is not a pointer to a ride: history sessions are derived on read (ADR 0004/0005) and have no stable identity, while a time range survives regrouping and allows multiple Favorites per ride, including trimmed sub-ranges selected on the ride timeline.

## Contract

- Favorites live in a native table (`@parity` iOS/Android) so telemetry deletion paths can see them.
- A Favorite has a native-minted stable UUID plus native-owned `created_at` and `updated_at`; JS cannot supply them.
- Re-trimming or renaming updates the existing Favorite row in place. Its UUID, `created_at`, Board ownership, and Favorite Media remain stable; native mints a new `updated_at`.
- `deleteTelemetryRange` and `clearTelemetryHistory` protect every minute bucket touched by a favorited range. Both the precomputed bucket and all its raw samples stay together; only buckets and telemetry wholly outside those bucket-aligned protected ranges are deleted. Deleting a ride around a Favorite leaves the protected buckets as a short standalone ride.
- Rides containing a favorited range are marked in history as not fully deletable.
- Removing a Favorite only unpins: its telemetry stays and becomes deletable like any ride. Its Favorite Media is deleted with it.
- Summary stats (mirroring history session summary fields) are computed from raw samples whenever the range is created or updated and denormalized onto the row (ADR 0005 style); the route preview is derived on read from pinned samples.

## Considered Options

- **Favorite references a session id.** Rejected: session ids are synthesized by grouping and unstable.
- **Cascade delete favorites with their ride.** Rejected: starring means "keep this"; deletion silently destroying favorites betrays that intent.
- **JS-side favorite store passing protected ranges into native deletes.** Rejected: native truth would depend on JS remembering to send it.
- **Delete pinned telemetry when its Favorite is removed.** Rejected: unfavoriting silently destroying telemetry is surprising; unpin-only keeps one rule.

## Consequences

- Delete paths subtract bucket-aligned protected ranges. This deliberately keeps up to 59 seconds of telemetry beyond each exact Favorite edge so bucket summaries stay truthful without rebuilding the full telemetry database; the Favorite's own range and denormalized summary remain exact.
- Favorited telemetry is exempt from any future retention pruning.
- Orphan favorite islands appear in History after surrounding-ride deletion; this is accepted as honest.
