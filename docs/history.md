# Ride History

Ride History is the persisted view of board riding after live operation ends or moves out of the current live window. It combines two independent durable streams — Telemetry Samples and the Ride Track — plus history markers and derived summaries.

## Two streams, one timeline

Position is not a column on a Telemetry Sample. The **Ride Track** is its own stream on the GPS clock, and it can outlive telemetry: a Board that drops at 20 km of a 30 km ride leaves 30 km of route and 20 km of graphs. Every read path answers that with one rule each:

- **Route** draws the whole Ride Track, including spans with no telemetry at all.
- **Graphs** stay telemetry-bound. A telemetry-less stretch is a gap, never an interpolated or carried-forward Board reading.
- **Distance** is board-odometer-based and stays that way. A longer track never grows Distance, and GPS distance is never blended into a telemetry gap. Average and top speed likewise stay board-telemetry-based, with their existing aggregation and sanitizer rules.
- **Scrubber / seek** spans the combined **Moving Window**: GPS movement extends it through GPS-only stretches, so the timeline covers the whole ride. Scrubbing into a telemetry-less stretch keeps moving the route pin and shows the graphs' gap — Board values are unavailable there, not zero.
- **Precision** is one shared read-side rule: reported horizontal accuracy of at most 20 m, identical on both platforms and independent of the Android provider. Poorer or unreported accuracy stays stored but never draws a route or evidences movement. Migrated fixes without a stored accuracy count as precise, because the old write-time gate is why they exist at all. Live GPS classification is separate and unchanged.
- **GPS movement** is the fix's own reported speed at or above the rider's movement threshold (default 3 km/h), checked after the accuracy rule. A fix with no reported speed is not movement evidence but is still a route point; movement is never derived from coordinate displacement.

All of this is precomputed natively per ADR-0005 — minute buckets carry the combined Moving Window, and a minute holding only Ride Track fixes produces its own bucket. Reads never reconstruct it. See [ADR-0038](./adr/0038-ride-track-is-a-separate-durable-gps-stream.md) and [ADR-0004](./adr/0004-ride-history-route-from-telemetry.md).

## Ownership

Native owns durable history truth.

- JS asks native for summaries and ranges.
- Native persists board telemetry, the Ride Track, minute buckets, and markers in SQLite.
- JS renders selected history state and sends user intents such as selecting or deleting a ride.

Main files:

- Native repository: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt`
- Native Ride paging: `modules/vescape-core/{android,ios}/telemetry/RideHistoryRepository.*`
- Native DAO: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt`
- Native tables: `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt`
- JS store: `src/modules/history/store/historyStore.ts`
- Ride rendering types/helpers: `src/modules/history/lib/sessions.ts`
- Map rendering: `src/screens/main/MainMap.tsx`

## Persisted Data

`telemetry_frames` stores board telemetry samples, without position. Frames are delta encoded with periodic keyframes. Queries reconstruct full samples from nearest keyframe before requested range.

`ride_track_points` stores the Ride Track: every admitted GPS fix on its own clock, with the accuracy the platform reported. There is no recording identity table; ride boundaries are derived from the data (ADR-0041).

`telemetry_minute_buckets` stores minute-level summaries used by history lists, keyed on `(bucket_start_ms, board_id)`. Buckets include sample counts, GPS counts, distance, speed, battery/current summaries and the combined Moving Window. A minute with Ride Track fixes and no frame still gets a bucket. VESC faults live in separate Board-owned storage and are never counted or retained by Ride History.

`telemetry_markers` stores ride boundaries and abnormal events. Current marker types include:

- `connected`: board became ready or recording was enabled.
- `app_stop`: board session stopped intentionally.
- `recording_stop`: rider pressed Stop Recording. The only marker that splits a ride.
- `disconnected`: board session stopped after disconnect.
- `gap`: long persistence gap, currently more than `90_000ms`.
- `error`: explicit board/session error.

## Ride weather

Each ride and Favorite carries the weather it was ridden in, so range can be compared against
conditions. It is an add-on, not ride data: missing or approximate weather is expected.

**Storage.** `weather_observations` holds one row per stored observation of current conditions,
keyed on the Open-Meteo `current.time` (epoch ms): whole `temperature_c`, WMO `weather_code`,
`gust_kmh` rounded to 5 km/h (null when the response omits it) and `is_day`. Rows carry no Board,
ride or coordinates, so Privacy Zones never apply. `WeatherCoordinator` stays the only source; every
successful refresh, Board connected or not, offers its conditions to the process-wide
`WeatherObservationRecorder`, which writes off the main thread:

- the first successful refresh after process launch writes a row;
- later refreshes write only when the normalized conditions (temperature, code, gust, day/night)
  differ from the newest stored row at or before them, or when that row is at least 24 h older;
- an observation timestamp already stored is the same observation and is never written again, so a
  cached API answer does not renew freshness; a failed fetch writes nothing.

Restore and Clear all go through `DatabaseReplacementFence`: a write whose observation landed before
the fence is dropped rather than reaching the replacement database. Clear all removes observations
except those a Favorite reads (inside it, or up to 24 h before its start). Backups carry the table
like any other.

**Read.** A ride's weather is the last row at or before its start plus every row inside it. The
History page reads the rows spanning the whole page once and assigns them in memory; Favorites read
their own range. Native folds the rows into `weather` on the ride/Favorite payload, each row in
effect until the next row or the ride end:

- `icon`: the native `weatherIcon()` slug with the most time in the ride; the night form when most of
  that time had `is_day = 0`. Five minutes of rain in a two-hour sunny ride shows sun.
- `minTemperatureC`/`maxTemperatureC`, `maxGustKmh`, and `rainMinutes` (time under a rain, drizzle
  or storm code).

A start row older than 24 h does not apply; with no other row inside the ride, `weather` is null.

**Display.** The ride card date line and the list row show the icon and temperature, one value when
the spread is under 3 °C (`14°C`) and a range otherwise (`8–20°C`). The ride stats bar adds
temperature, max gust and rain minutes (when above zero). Units follow the rider's unit setting.
Nothing renders without weather.

## Recording Rules

A Ride Recording is started by a Board, and captures both streams: board telemetry while the Board is connected, and the Ride Track for as long as the recording is open.

Standalone GPS may update live map state but should not create a Ride Recording.

## History Loading

`historyStore.loadInitial()` loads:

- summary from `getTelemetrySummary()`
- latest live-detail buckets from `getTelemetryHistory({ limit: 100 })`
- ten complete rides from `getRideHistoryPage({ limit: 10 })`

Older pages use native's opaque `nextCursorBeforeMs`. A page boundary is always before a complete
Ride, never through an arbitrary minute bucket. Native concatenates the precomputed bucket route
segments for list thumbnails, so JS neither groups buckets nor loads raw tracks per row.

### Maintenance Jobs

History reads stay precomputed (ADR-0005). Bringing old summaries up to date with the current app is
the job of **Maintenance Jobs**, which native runs by itself. There is no Rebuild history button.

- **Declaration.** `MAINTENANCE_JOBS` in `MaintenanceJobs.kt` and `maintenanceJobs` in
  `MaintenanceJobs.swift` list every job in run order. A job declares a `version`, the setting keys
  its output depends on (`inputKeys`, normalized by `inputs`), and `requiresNetwork`.
- **Done state.** A job is done when the `app_settings` row `maintenanceJob.<id>` holds its
  fingerprint `version|inputs`, e.g. `1|moving=300|freeSpinDelta=1200|freeSpinCap=1500`. Anything
  else is stale. A done job costs one row read. Fingerprints travel with backups, so restoring an
  older backup makes its jobs stale again. There is no progress cursor and no pending-work state: a
  run that stops early restarts from zero, and the missing fingerprint is the only obligation. A job
  may own its done state instead (`hasWork`, `begin`, `complete`); Ride weather does, with a
  watermark.
- **Runner.** `MaintenanceRunner` runs stale jobs one at a time, in declaration order, on one
  low-priority thread or queue. A failed or waiting job does not block the next. It checks after
  launch (10 s after startup), when the network comes back (network jobs only), 3 s after the last
  change to an input setting (a running pass is cancelled and restarted with the new values), when
  a skipped active ride closes, and after Restore or Clear all.
- **Restore and Clear all.** Every job write is a chunk under `DatabaseReplacementFence`. A fence
  waits for the in-flight chunk, and the next chunk of a run that started before it stops the run.
  The runner then checks again against the resulting database, also when the restore failed.
- **Active ride.** A job never touches the ride that may still be recording. Under ADR-0041 that is
  every sample, on any Board and either stream, chained back from the newest one by gaps shorter
  than `rideSplitGapMinutes`, while the newest is younger than that gap. A run that had to skip it
  returns without its fingerprint and the runner checks again once the gap has passed, or on the
  next launch.
- **State.** `getMaintenanceState()` and `onMaintenanceState` carry each job's status (`pending`,
  `running`, `done`, `waitingForNetwork`, `failed`), progress, last run, duration and last error,
  plus a `historyRevision` bumped at most every 3 s after committed chunks. JS re-reads open history
  pages and Favorites on a new revision. Failures are reported to Sentry; start, chunk, finish and
  cancel leave breadcrumbs and log lines.
- **UI.** A running job takes over the Settings button (database icon and progress ring, below
  update and backup) and replaces the drawer Storage cell's size with its progress. A failed job
  puts a warning dot on the Storage cell; waiting for network does not. The Database screen lists
  every job.

**Ride summaries** is the first job. Its inputs are the Metric Sanitizer settings. It rebuilds
minute buckets, exclusion ranges and route previews oldest first, one transaction per owned chunk:
whole minutes, half-open `[from, to)`, at most one clock hour. Inside the transaction it reads the
frames and Ride Track of the chunk, plus read-only context: each Board's delta chain and the last
precise fix from the previous chunk (dropped when a ride deletion removed them) and fixes up to 10 s
outside the chunk for the free-spin sanitizer. It then replaces the chunk's buckets and the chunk's
portion of every exclusion range, keeping portions outside it. Rebuilt ranges are plain inserts and
never merge across a chunk edge, so rebuilding twice gives identical rows. History stays complete
throughout: a mix of old and new hours, never a missing ride.

**Ride weather** (`rideWeather`, network) fills `weather_observations` for past ride days that
have no usable weather under the Ride weather read and 24-hour freshness rule: rides from before
weather was stored and rides recorded offline. Its `app_settings` row holds a watermark,
`version|doneThroughMs`, not a fingerprint. Rides ending at or before it are settled; every trigger
scans only closed rides after it, so a done job costs one bounded query and a version bump rescans
all history once.

- **Candidates.** Each UTC day a closed derived ride touches is a candidate when that part of the
  ride has no usable weather and has a precise Ride Track fix. Days without GPS never are. A
  midnight-crossing ride checks both days. Earlier same-day weather (an offline evening ride after
  a live morning refresh) is enough.
- **Fetch.** One representative fix per day (its first precise fix); days grouped by 0.1° area;
  one request per area and window of at most 14 days, one at a time. Hourly
  `temperature_2m`, `weather_code`, `wind_gusts_10m`, `is_day` as UTC unix time from the
  historical forecast API, or the ERA5 archive API for days before 2022. Days before 1940 are a
  permanent miss. Null samples are dropped, duplicates keep the first.
- **Write.** Each area's response is filtered to its own days and ride spans: the fresh hour at or
  before the ride start plus the hours inside it, change-only against the previous sample. One
  transaction per window rechecks eligibility first, so a live row committed during the request
  wins and live rows are never overwritten.
- **Outcomes.** Fetched rows, or a validated 4xx, settle the day. A transport failure, 408, 429,
  5xx, an unparseable body, or no data for a day under 7 days old is temporary: the watermark stops
  before that ride (later rides may still be filled), the run backs off (1 min doubling to 1 h, at
  least `Retry-After`; a 429 stops the run) and retries while online, and network-back retries as
  well. Offline it shows waiting for network, without a warning.
- **Fencing.** The watermark only advances inside fenced chunks, and the HTTP call is cancelled
  with the run, so Restore or Clear all mid-fetch leaves no late rows or watermark.

Open-Meteo's free API is for non-commercial use; the licensing position must be confirmed before
this ships.

Retired one-shot jobs and their keys may be removed once the Release Policy minimum supported version
is past the version that shipped them. Ride summaries is not one-shot: sanitizer changes must keep
rebuilding history.

### Bucket route previews

Favorite cards use the same simplified geometry as ride cards. Fully selected minutes read their
stored previews; partially selected edge minutes simplify original fixes inside the exact Favorite
range. Full minutes without a generated preview retain coarse anchors until the Ride summaries Maintenance
Job regenerates them. Reads are scoped to the
Favorite's board and preserve GPS/recording gaps. An empty native route stays empty in JS.

Schema 49 adds nullable `telemetry_minute_buckets.route_preview`. Each value is a JSON array of
segments `[firstFixMs, lastFixMs, encodedPolyline]`. Coordinates use signed delta-varint polyline
encoding at **E7** precision, not the common E5 precision. Each segment is simplified with
Ramer–Douglas–Peucker at 5 m tolerance in a local geographic projection, keeping its first and last
qualifying fix. A gap greater than 30 seconds between qualifying fixes starts another segment.
`NULL` means the preview has not been generated; `[]` means it has no qualifying GPS fixes.

On each recording flush, native inserts the raw fixes and replaces the affected minutes' previews
inside the same transaction. It reads only that minute's original fixes, scoped to its Board and
Ride Recording, through the indexed time range. It never simplifies an already simplified preview.
This also handles late fixes and a restarted process without a second persistent cache. A failed
preview write rolls back the entire recording batch. Telemetry-only flushes preserve the geometry.
The full Ride Track remains unchanged.

Both platforms flush at 25 buffered telemetry samples or GPS fixes. Android schedules a flush after
5 seconds; iOS now has the same 5-second deadline for sparse batches, cancelled by threshold or
explicit flushes. A minute bucket is updated repeatedly, rather than waiting for the minute to end.

History reads decode and join the saved segments, using their endpoint times to preserve gaps across
minute boundaries. `RideRoutePoint.breakBefore` starts a new thumbnail subpath. Thumbnail fitting
uses Web Mercator and one uniform scale for both axes, centred in its frame, never tighter than
300 m across. It does not smooth corners.

Thumbnails draw a dark street map behind the route. Native `MapTiles` downloads 512 px JPEG tiles of
a Mapbox-hosted style from the Static Tiles API and keeps them in the app's cache directory with no
expiry; concurrent requests share one download and a failed one stores nothing. The style is the
One Dark ground layers without labels, icons or boundaries, published to the app's Mapbox account
with `bun run map:publish-thumbnail-style` (needs `MAPBOX_SECRET_TOKEN` with `styles:list`,
`styles:read` and `styles:write`). Its `owner/styleId` is a native constant and part of the cache
path. Republishing under the same ID leaves cached tiles as they were. A thumbnail shows its map only
once every tile it needs is on disk; until then, and offline, it shows the plain route. The map
ignores Privacy Zones, so it is for on-device display only. The 30-second gap rule shares the existing limitation around short
Privacy Zone spans: no explicit privacy-break metadata is stored.

Older buckets keep their first-coordinate fallback until the Ride summaries Maintenance Job runs. It
regenerates previews from retained Ride Track fixes, alongside the other summaries. Schema migration
and ordinary reads never scan historical tracks or mutate them. Backups preserve the preview column
across platforms.

`historyStore.selectSession(session)` loads:

- board samples from `getHistoryRange({ fromMs, toMs, boardId, limit: 10000 })`
- Ride Track fixes over the same range, already reduced natively to those passing the precision rule
- markers from same range

Selected history is rendered from `sessionSamples`, `sessionGpsSamples`, and `sessionMarkers`.

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

A continuous recording-backed GPS span contains adjacent GPS fixes no more than `30_000ms` apart that belong to the same Board. A `recording_stop` marker between them splits the span; BLE disconnects and telemetry gap/error markers do not. Span coverage begins at its first GPS fix and ends at its last GPS fix; matching tolerance does not extend it. Video telemetry overlays still respect telemetry gaps and disconnect markers.

No valid nearby recording-backed GPS fix means no map pin. Media cannot match into or across a gap detected by the span rules above, even when a fix on its other side is within `30_000ms`. Privacy Zone filtering stores no explicit break: a short filtered span below the time-gap threshold may still be treated as continuous. The Ride Track work in #448, #449, and #450 retains this limitation and does not introduce privacy-specific continuity metadata. See [ADR-0009](./adr/0009-privacy-zones-drop-ride-recording-samples.md).

Matching is recomputed from current photo-library access and selected Ride History data whenever Media History is read for a selected ride. Results may live in memory for that active read only; changing ride, disabling Media History, changing permission, or refreshing discards them.

### Permission And Missing Assets

- Full photo-library permission: show all qualifying accessible assets.
- Limited permission: show only qualifying assets exposed by the OS and explain that results are partial.
- Denied or restricted permission: show no media and leave selected Ride History usable.
- Deleted, unavailable, unreadable, or permission-revoked assets: omit them without changing the Ride Recording.

Permission states should expose the relevant OS action for changing access. Asset load or playback failure affects that asset only.

See ADR 0014 for the ownership and matching decision.

## Ride grouping

Ride boundaries are derived from recorded data only ([ADR-0041](./adr/0041-ride-boundaries-are-derived-from-recorded-data.md)).
`RideHistoryRepository` groups minute buckets oldest-first inside one database snapshot. The same
native grouping implementation feeds both Ride History pages and Profile Stats, for old and new rides
alike.

A ride is one Board's Telemetry Samples. A new ride starts when:

- the Board id changes
- the gap between the last Telemetry Sample bucket of the ride and the next one exceeds the rider's
  `rideSplitGapMinutes` setting ("Split rides after" in History settings, default 30)
- a `recording_stop` marker of that Board lies between them (explicit Stop Recording)

Idle Pause halts frame writes while the board is disengaged, so a long stop while connected splits
on the frame gap. Disconnect, app kill, auto close, BLE loss and process restart do not split.
`disconnected`, `app_stop`, `connection_lost` and `error` markers stay visible as Ride History
Markers and as `boundaryBefore`, but never split.

GPS-only buckets (Ride Track fixes, no Telemetry Sample) never start a ride and never move the
split baseline. They attach to the preceding ride of their Board when inside the split window and
before any Stop Recording — in practice the Ride Dropout Grace tail after the last frame — and
otherwise belong to no ride. Inside a ride they still widen the Moving Window and the route.

Boundaries have minute-bucket resolution: a Stop Recording and restart inside the same minute
cannot split. Boards without Refloat state record frames while standing, so a long stop while
connected stays one ride for them.

## Map Rendering

History route comes from `sessionGpsSamples`, which is the Ride Track — the route can extend past the last telemetry sample.

- Route line: all selected GPS samples as one `LineString`.
- Start pin: first GPS sample, green.
- End pin: last GPS sample, error color.
- Seek pin: the track fix nearest the scrub head, yellow GPS marker color. It keeps moving through telemetry-less stretches, where the graphs show a gap.
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

### Persistence integration

Ride Track uses schema generation 43 on both platforms. The production migration graph moves legacy
GPS fields into the independent stream; frames carry no GPS columns. Schema generation 52 removes
`ride_recordings` and every `recording_id` column again and folds minute buckets that two recordings
shared (ADR-0041).
GPS fixes and their minute buckets share the recording transaction and storage failure gate.

History entries are identified by Board and time range. Opening, exporting or deleting one passes
that Board and range to native queries, exactly as Favorites do.

`bun run test:persistence` checks real Room/GRDB storage and exchanges production archives in both
directions, including independent GPS fixes. Native lifecycle tests and
full app builds cover integration beyond the database hosts. Real-device background GPS behavior
still requires a device smoke test.

## Ride export

GPX and CSV exports are implemented on Android and iOS.

Decisions from the 2026-09-20 design discussion:

- Replace the Delete button with a three-dot menu containing **Export GPX**, **Export CSV**, and
  **Delete**, for both Ride History entries and Favorites. The two exports are direct menu items;
  there is no intermediate format picker.
- Export a history entry's full stored range, scoped to its Board. Export a Favorite's exact saved Board/time range. Chart zoom and playback position do
  not change the export range.
- Keep both export items enabled without querying data availability. Empty input may produce an
  empty export; do not add button-disable logic for missing GPS or telemetry.
- Native generates the temporary file in batches on both platforms. JS sends the export intent
  and opens the system share sheet. Read the complete stored range, independently of the chart
  reader's 20,000-sample cap; do not load a whole ride into JS to serialize it.
- CSV is for debugging. Include all stored board telemetry, including spikes and samples excluded
  from statistics. Do not sanitize, smooth, interpolate, or replace readings. Export retained data;
  do not claim to recover precision or fields that recording never stored.
- Both formats reuse the existing history GPS precision rule, including its legacy behavior.
  Fixes with reported accuracy above 20 m are excluded. The rider explicitly accepted this filter
  for debugging CSV too.
- Stay close to Floaty's export structure where straightforward. Keep its column names and units
  for matching fields, omit unsupported columns, and append additional stored telemetry fields
  such as `erpm` and `balanceCurrent`. External-app import testing belongs to the rider; exact
  importer compatibility is not yet verified. No VESC-specific CSV contract has been established.

### CSV mapping and merge

Floaty's reference CSV uses Unix timestamps in milliseconds, board speed in km/h, duty cycle as a
fraction, currents in amperes, temperatures in Celsius, distances in metres, and angles in degrees.
Map matching stored fields into those representations, independently of display-unit preferences.

| Floaty field             | Vescape source                              |
| ------------------------ | ------------------------------------------- |
| `timestamp`              | Stored telemetry capture time               |
| `speed`                  | Board speed                                 |
| `batteryVolts`           | Battery voltage                             |
| `motorTemp`              | Motor temperature                           |
| `controllerTemp`         | MOSFET temperature                          |
| `lifeDistance`           | Odometer                                    |
| `rollAngle`              | Roll                                        |
| `pitchAngle`             | Balance pitch                               |
| `truePitchAngle`         | Pitch                                       |
| `state`                  | Lower state bits of the stored packed state |
| `setpointAdjustmentType` | Upper state bits of the stored packed state |

Other matching fields include `dutyCycle`, `batteryCurrent`, `motorCurrent`, `switchState`, `adc1`,
and `adc2`; preserve their meaning when mapping the stored representation. Unsupported columns
are omitted, not populated with fabricated values. Specifically omit `inputTilt`, `throttle`,
`ampHours`, `wattHours`, `remainingDistance`, `batteryUtilization`, `phaseUtilization`, and
`faultCode`. Board-owned fault occurrences are not a per-sample fault column.

Also omit `tripDistance`: do not invent a trip counter by subtracting the initial odometer.
Omit `batteryPercent`: Vescape derives it when reading history using the Board's current battery
configuration; it is not stored telemetry.

Produce one CSV row per telemetry sample. Match Floaty's GPS merge over chronological data:

- Attach the latest accepted GPS fix at or before the telemetry timestamp.
- Before the first accepted fix, use that first fix; after the final fix, keep the final fix.
- Retain the telemetry timestamp and expose the GPS fix's own `gpsTimestamp` and `gpsSpeed`,
  alongside its coordinates, altitude, and accuracy.
- With no accepted GPS fixes, preserve telemetry rows with empty GPS fields.

This merge repeats GPS observations; it does not interpolate coordinates or create new GPS fixes.

### Reference evidence

The supplied research is `~/Workspace/floaty-reverse-engineering/EXPORT.md`, based on static
inspection of Floaty Android 3.0.0, versionCode 379. Further inspection in this discussion found
the `session_logs` and `session_locations` column definitions near line 339650 of
`hermes-pseudocode.js`, the packed state and pitch decoder near line 463380, and the Garmin GPX
builder near line 1761550. Floaty's GPX is GPX 1.1 with GPS speed in a Garmin TrackPointExtension
v2. These are reference findings, not proof of a successful import into an external app.

### GPX implementation

Ride and Favorite detail offer Export GPX, Export CSV, Export Floaty, and Delete in their three-dot
menu. Favorite editing
and unpinning retain their existing behavior. Export uses the selected entry's full stored range,
or the Favorite's exact saved range, independently of movement, chart zoom, and playback.

`exportRideGpx` accepts `RideExportOptions` and returns a closed `RideExportFile`. Native reads
raw Ride Track fixes in pages of 1,000 ordered by `(fix_at_ms, id)` inside one database snapshot.
The cursor advances past the last raw fix, even when an entire page fails precision filtering.
Board attribution is exact, including an unassigned Board. Every export uses Board/time scope.

The writer emits UTF-8 GPX 1.1, escaped track names, coordinates in degrees, optional altitude
in metres, UTC timestamps with millisecond precision, and optional GPS speed in metres per second
under Garmin TrackPointExtension v2. GPS-only spans need no telemetry. Empty input produces a valid
empty track. No smoothing, movement trimming, or chart cap applies.

A UUID filename under native temporary/cache storage keeps rider names out of paths. Failed writes
remove their partial file; successful files remain available for share consumers and OS cache
reclamation. JS waits for the menu's native dismissal before invoking system sharing on iOS.
Generation and sharing errors appear through the existing information modal. There is no
data-availability preflight.

Room and GRDB host contracts share a 23,005-fix fixture definition covering rejected raw pages,
equal timestamps, exact range/Board/recording scope, legacy accuracy, escaping, optional fields,
and empty XML. JS tests cover ride versus Favorite export intent. Device share-sheet behavior
and external-app imports remain rider-led verification, not observed compatibility guarantees.

### CSV implementation

`exportRideCsv` shares GPX's intent, temporary-file lifecycle, snapshot, and system-share flow.
UTF-8 CSV uses explicit headers and CRLF rows; cells containing commas, quotes, or newlines are
quoted, with embedded quotes doubled. Missing readings stay empty. An empty telemetry range
produces the header alone, even when the range contains GPS fixes.

The stable column order is:

```text
timestamp,speed,dutyCycle,batteryVolts,batteryCurrent,motorCurrent,motorTemp,controllerTemp,lifeDistance,rollAngle,pitchAngle,truePitchAngle,state,switchState,setpointAdjustmentType,adc1,adc2,altitude,latitude,longitude,accuracy,gpsSpeed,gpsTimestamp,erpm,balanceCurrent,rawSwitchState
```

The matching Floaty columns retain their relative order. `adc1` and `adc2` are volts. GPS altitude
and accuracy are metres, coordinates are degrees, `gpsSpeed` is metres per second, and both
timestamps are Unix milliseconds. `erpm` is stored electrical RPM; `balanceCurrent` is amperes.
These values do not follow display-unit preferences.

`state` is the packed state's low nibble; `setpointAdjustmentType` is its high nibble.
`switchState` uses Floaty's enum: 0 off, 1 ADC1, 2 ADC2, 3 both. The stored switch byte's low
nibble is 0 off, 1 half, 2 full. Half chooses ADC1 when its stored voltage exceeds ADC2, otherwise
ADC2, matching the reference decoder. Unknown low nibbles, or a half state without both ADC
readings, yield an empty cell. Upper flag bits never become a footpad state. Appended
`rawSwitchState` preserves the complete stored byte, including handtest and beep flags.

Telemetry reads use `(captured_at_ms, id)` keyset pages of 1,000, replaying the predecessor
keyframe before emitting the selected range. Reconstruction carries values across pages,
honors explicit NULL changes, and resets on keyframes or recording changes. iOS applies the
same decoder to imported Android delta rows. No statistics, exclusions, battery configuration,
chart smoothing, or chart sample limit participates. Each retained row appears once, even
when incomplete retained data leaves empty cells.

GPS uses the same raw paged reader and precision rule as GPX. The merge retains two accepted
fixes and one page, attaches the latest fix at or before each telemetry row, uses the first fix
before it, and keeps the final fix afterward. Equal-time fixes resolve by row id. No accepted GPS
leaves GPS cells empty; GPS-only stretches add no rows. Both streams stay bounded in native
memory and only the finished file URI crosses the bridge.

Shared Room/GRDB fixtures cover 23,005 telemetry samples, equal-time rows, negative spikes,
mid-chain range starts beyond one page, optional NULL transitions, keyframe resets, state and
switch decoding, rejected GPS pages, legacy precision, first/previous/final GPS matching,
missing GPS, exact Board scope, empty telemetry, and escaping. External imports and device
share sheets remain rider-led tests.

### Floaty JSON implementation

`exportRideFloaty` writes a Floaty 3 session JSON (`schemaVersion: 2`), the only per-ride format
Floaty imports (Sessions → ⋮ → Import session). It shares the CSV's intent, snapshot, frame
decoder, and GPS reader, and returns `application/json` / `public.json`. Unlike the CSV, Floaty
requires a number in every log and location field, so this format fills the columns that the CSV
leaves out:

- `logs`: one per stored frame. A repeated millisecond keeps only its first frame, because Floaty
  keys logs by `(sessionId, timestamp)`. Missing readings and unsupported columns are 0. `speed`
  is km/h, `dutyCycle` and `batteryPercent` are 0–1 fractions, and `lifeDistance` and
  `tripDistance` are km. `tripDistance` is the odometer minus the ride's first odometer reading.
  `batteryPercent` is the Board's current battery configuration applied to each frame's voltage
  and current, without smoothing. `ampHours` and `wattHours` accumulate battery current and power
  between consecutive frames, so regen subtracts. They are not accumulated across gaps over 5 s.
- `locations`: one per precise fix, with unique timestamps. `speed` is km/h, and altitude and
  accuracy are metres.
- Session: `id` is a UUID v3 of Board and range, so importing the same ride again does not
  duplicate it. `distance` is the final `tripDistance`. `polyline` (Google encoding, 1e-5°) and
  the bounding box come from the locations; they are null when there are none.

Logs, then locations, then the session totals are streamed in one pass. Numbers are exact decimals
of the stored integers, which keeps the output identical across platforms. The Room and GRDB
contracts compare a fixture export byte for byte against
`modules/vescape-core/shared/ride-export-floaty-expected.json`.

### Live telemetry CSV

The telemetry panel's **Export CSV** writes the live telemetry window instead of stored history:
every frame native holds in memory for the configured live telemetry length, at the full packet
rate, oldest first. `exportLiveTelemetryCsv` takes no options and returns the same closed
`RideExportFile`. The file uses the ride CSV's columns and decoders; live frames carry no GPS fix,
so the location columns stay empty. An empty window rejects instead of producing a header-only file.
