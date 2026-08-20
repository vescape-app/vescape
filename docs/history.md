# Ride History

Ride History is the persisted view of board riding after live operation ends or moves out of the current live window. It combines board telemetry, telemetry-associated precise GPS fixes, history markers, and derived summaries.

## Ownership

Native owns durable history truth.

- JS asks native for summaries and ranges.
- Native persists board telemetry with telemetry-associated GPS fixes, minute buckets, and markers in SQLite.
- JS renders selected history state and sends user intents such as selecting or deleting a ride.

Main files:

- Native repository: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt`
- Native DAO: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt`
- Native tables: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt`
- JS store: `src/modules/history/store/historyStore.ts`
- Session grouping: `src/history/sessions.ts`
- Map rendering: `src/screens/main/MainMap.tsx`

## Persisted Data

`telemetry_frames` stores board telemetry samples and any precise GPS fix attached to those telemetry samples. Frames are delta encoded with periodic keyframes. Queries reconstruct full samples from nearest keyframe before requested range.

`telemetry_minute_buckets` stores minute-level summaries used by history lists. Buckets include sample counts, GPS counts, distance, speed, fault count, and battery/current summaries.

`telemetry_markers` stores ride boundaries and abnormal events. Current marker types include:

- `connected`: board became ready or recording was enabled.
- `app_stop`: recording or board session stopped intentionally.
- `disconnected`: board session stopped after disconnect.
- `gap`: long persistence gap, currently more than `90_000ms`.
- `error`: explicit board/session error.

## Recording Rules

A Ride Recording should represent board telemetry captured while a Board is connected, plus precise GPS fixes captured alongside that telemetry.

Standalone GPS may update live map state but should not create a Ride Recording.

## History Loading

`historyStore.loadInitial()` loads:

- summary from `getTelemetrySummary()`
- latest minute buckets from `getTelemetryHistory({ limit: 100 })`
- grouped sessions from `groupHistorySessions(blocks)`

`historyStore.selectSession(session)` loads:

- board samples from `getHistoryRange({ fromMs, toMs, deviceId, limit: 10000 })`
- GPS samples derived from telemetry samples in the same range
- markers from same range

Selected history is rendered from `sessionSamples`, `sessionGpsSamples`, and `sessionMarkers`.

## Ride Summary Notifications

A finalized Ride Recording that Ride History keeps also sends one silent summary notification
(distance, duration, final valid Battery SoC Estimate). Its dedup markers live in
`ride_summary_notifications` (`ride_id` primary key = `deviceId:firstSampleAtMs:lastSampleAtMs`,
`notified_at_ms`), alongside the ride tables in `vescape.db`. See `docs/connectionState.md` →
_Ride summaries_ for the full rule, the claim ordering, and the deep link.

## Media History

Media History is an optional, local-only view of phone photos and videos captured during the selected Ride Recording. It is off by default and requests photo-library permission only when the user enables it.

The OS photo library remains durable media truth. Ride Recording storage remains durable ride truth. The app does not copy or persist assets, thumbnails, media-to-ride links, media metadata, or routes, and does not upload or publish media or routes.

### Qualification And Placement

For each selected-ride Media History read:

1. Query currently accessible OS photo-library assets whose capture time falls inside the selected ride's inclusive `[startAtMs, endAtMs]` range.
2. Use the OS photo-library asset creation timestamp as capture time. Treat it as playback start time for videos. Exclude assets without a valid creation timestamp; do not substitute file modification time.
3. Ignore all asset GPS metadata.
4. Find the nearest GPS fix in `sessionGpsSamples`.
5. Show the asset only when that recording-backed GPS fix is at most `30_000ms` from capture time and belongs to the same continuous recording-backed GPS span.

A continuous recording-backed GPS span contains adjacent GPS fixes no more than `30_000ms` apart. Explicit `gap` markers and ride-boundary markers (`disconnected`, `app_stop`, or `error`) always split spans. Span coverage begins at its first GPS fix and ends at its last GPS fix; matching tolerance does not extend it.

No valid nearby recording-backed GPS fix means no map pin. This excludes media captured during unsupported route spans, including GPS outages and Privacy Zone or Ride History gaps. Media cannot match into or across a gap even when a fix on its other side is within `30_000ms`.

Matching is recomputed from current photo-library access and selected Ride History data whenever Media History is read for a selected ride. Results may live in memory for that active read only; changing ride, disabling Media History, changing permission, or refreshing discards them.

### Permission And Missing Assets

- Full photo-library permission: show all qualifying accessible assets.
- Limited permission: show only qualifying assets exposed by the OS and explain that results are partial.
- Denied or restricted permission: show no media and leave selected Ride History usable.
- Deleted, unavailable, unreadable, or permission-revoked assets: omit them without changing the Ride Recording.

Permission states should expose the relevant OS action for changing access. Asset load or playback failure affects that asset only.

See ADR 0014 for the ownership and matching decision.

## Session Grouping

`groupHistorySessions(...)` groups minute buckets oldest-first.

Session breaks happen when:

- device id changes
- gap between adjacent buckets is more than `10 minutes`
- bucket `boundaryBefore` is one of `disconnected`, `app_stop`, or `error`

Important limitation: grouping only sees `boundaryBefore` attached near bucket start. A marker inside a minute bucket does not necessarily split a session.

## Map Rendering

History route comes from `sessionGpsSamples`.

- Route line: all selected GPS samples as one `LineString`.
- Start pin: first GPS sample, green.
- End pin: last GPS sample, error color.
- Seek pin: current playback sample, yellow GPS marker color.
- Marker pins: each `sessionMarker` is mapped to nearest GPS sample by timestamp.

Current marker rendering paints every non-error marker yellow. This means `connected` and `app_stop` can look like important trail points even when they are only lifecycle markers.

## Known Edge Case

Previously observed Android history entry from `2026-05-06` before standalone history GPS was removed:

- Selected range: `13:31:17` to `13:35:27`.
- GPS rows existed only from `13:31:17` to `13:33:36`.
- standalone history GPS had `276` precise rows and no duplicate `(location_timestamp_ms, latitude_e7, longitude_e7)` rows.
- Markers in range were `gap`, `connected`, `app_stop`, `connected`, `connected`.

User-visible symptom: apparent double trail and four yellow points.

Cause: yellow points were marker pins, not duplicate GPS points. Quick stop/start or reconnect markers stayed in one selected session, and `MainMap` painted non-error markers yellow. Standalone history GPS has since been removed from Ride History; routes now come from telemetry-associated GPS only.

## Investigation Checklist

When history map looks wrong:

1. Pull `vescape.db`, `vescape.db-wal`, and `vescape.db-shm` from device.
2. Check selected range in `telemetry_minute_buckets`.
3. Check `telemetry_markers` inside selected range.
4. Compare telemetry sample range against telemetry-associated GPS range.
5. Verify whether pins are route endpoints, seek pin, or marker pins.

## Improvement Candidates

- Render only actionable marker types (`gap`, `error`) on history map.
- Style lifecycle markers (`connected`, `app_stop`) differently or hide them by default.
- Split history sessions using markers inside buckets, not only `boundaryBefore`.
