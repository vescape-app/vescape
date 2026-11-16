# Sealed telemetry lives in Telemetry Chunks

ADR 0044 defined a codec that packs one Board's samples for one minute into a blob. This decision
covers where those blobs live and how readers and writers treat them.

## Status

Accepted and implemented (#687, #688, #692). Schema 56 adds `telemetry_chunks`. New recordings are sealed on both
platforms, and the buffer drain seals rows recorded before schema 56 in the background.

## Decision

`telemetry_chunks` holds one row per Board key and wall-clock minute: `board_key` (`boards.key`,
NULL for unowned samples), `minute_start_ms`, `codec_version`, `sample_count`, `first_at_ms`,
`last_at_ms` and the codec `payload`. `telemetry_frames` becomes a **write buffer**. A sealed sample
lives only in a chunk and an unsealed one only in the buffer. There is no decode cache.

- **Sealing.** A minute is sealed once the wall clock is 10 s past its end and no pending frame
  targets it, on Stop Recording (the open minute included), and by the buffer drain. Every flush checks, empty ones included, and a delayed check is armed for
  the earliest unsealed minute, so a minute still closes when ingestion stops before its grace has
  passed. Disconnect and Idle Pause are not triggers. One write transaction, under a
  `DatabaseReplacementFence` ticket, does the seal:
  1. Replay the minute's buffer rows from the preceding full state into canonical samples.
  2. Merge them with the minute's existing chunk.
  3. Encode, decode, and compare the result with the canonical samples.
  4. Write the chunk.
  5. Delete exactly the sealed row ids.

  If the comparison fails, every row is kept and a `telemetry_seal_failed` Diagnostic Event is
  recorded. A Board id with no `boards` row is first minted as a Board Tombstone, the same rule the
  v55 migration and the Ride Track writer apply, so the chunk keeps its owner.

- **Buffer drain.** One routine seals every closed minute left in `telemetry_frames`: the pre-56
  backlog and any later leftover (a late sample, a failed seal, a process killed before its seal).
  The Telemetry storage Maintenance Job runs first, before Ride summaries, after launch and after
  Restore or Clear all. It works oldest first,
  30 minutes per write transaction, each under a fence ticket; a fenced batch is dropped. Before
  each batch it checks, in the batch's own transaction, for a ride that may still be recording, and
  returns Deferred if one is found; the runner retries one ride split gap later. A sample dated after now (a wrong
  clock) does not count as a recording ride, here or in the Diagnostic Event prune. The buffer is the only progress record, so a killed or fenced drain
  resumes on the next run, including on a restored database. A minute that already has a chunk
  merges into it. A minute that fails to seal before any write (verification mismatch, or a codec
  format error such as an unreadable existing chunk or more samples than the codec's 65,536) keeps
  its rows, is reported as a seal failure, and the rest of the batch commits; database errors abort
  the batch. An oversized minute is not split: no real recording comes near the limit, so it stays
  in the buffer, readable. Each run that found work records one `telemetry_drain` Diagnostic Event with the
  minutes found, minutes sealed, failures, whether it yielded, and its duration. The job uses `hasWork` / `begin` / `complete`. Its `maintenanceJob.telemetryStorage` completion
  value identifies the process launch and database fence generation. A bounded indexed existence
  check excludes the open minute. A completed run, including one with failed minutes, stays Done
  for that launch and generation; failed minutes and later leftovers retry on the next launch or
  database replacement. Restore and Clear all clear its state inside their fenced replacement.
  The obsolete `maintenanceJob.telemetryBacklogDrain` row is deleted during the job check and
  replacement preparation. There is no drain kill switch.
- **Chunks are replaceable.** A sample that arrives after its minute was sealed waits in the buffer
  until the next seal merges it. A range delete, a protected clear or delete-before decodes each
  chunk it cuts, filters out the deleted samples and re-encodes the chunk.
- **One stream for readers.** `TelemetryChunkStore` (Kotlin and Swift) merges chunks and buffer from
  one read snapshot. Results are trimmed to the requested range and ordered by
  `(captured_at_ms, ordinal)`. A chunk sample's ordinal is negative and unique per chunk and index.
  A buffer row's ordinal is its id. The ordinal is also the sample id sent over the bridge. Export
  pages on the same cursor. A decoded chunk sample reaches readers as a full keyframe row. The bridge
  payloads do not change.
- **Delta anchor.** Android's buffer deltas chain across minutes. After minute N is sealed, the
  first buffer row of minute N+1 is a delta against a deleted row. Readers replay from the latest
  full state before the range: a buffer keyframe or any chunk sample, whichever is later. A read
  limit counts only samples inside the requested range, never the anchor prefix. The writer keeps
  its in-memory last state.
- **Summaries and maintenance.** Sample count, first and last sample times, the active-ride search
  and sample existence checks all count chunk samples. Ride summaries rebuild from the merged
  stream. `RebuildState` now follows the masks too, so a rebuild matches the one from the unsealed
  rows.
- **Minute buckets are untouched.** Buckets aggregate every received sample at full rate. Only about
  2 Hz is stored, so buckets cannot be derived from chunks. Sealing never rewrites a bucket.

## Consequences

- Restore keeps `telemetry_chunks`, which is listed in both table allowlists. Archives carry chunks
  and buffer rows between Android and iOS unchanged.
- In SQLite, NULL values never collide in a unique index, so two unowned rows could share a minute.
  The sealer looks the chunk up with `board_key IS ?` inside the seal transaction and keeps one
  unowned chunk per minute itself. The partial unique index from the original plan was dropped:
  Room cannot declare one, so fresh and migrated databases would differ.
- A delete that removes a chunk sample does not change later chunk samples, which were reconstructed
  at seal time. Buffer deltas whose anchor was deleted behave as they did before chunks existed.
