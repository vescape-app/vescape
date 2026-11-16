# Sealed telemetry lives in Telemetry Chunks

ADR 0044 defined a codec that packs one Board's samples for one minute into a blob. This decision
covers where those blobs live and how readers and writers treat them.

## Status

Accepted (#687). Schema 56 adds `telemetry_chunks`. New recordings are sealed on both platforms.
Rows recorded before schema 56 stay in the buffer until the backlog drain (#688) seals them.

## Decision

`telemetry_chunks` holds one row per Board key and wall-clock minute: `board_key` (`boards.key`,
NULL for unowned samples), `minute_start_ms`, `codec_version`, `sample_count`, `first_at_ms`,
`last_at_ms` and the codec `payload`. `telemetry_frames` becomes a **write buffer**. A sealed sample
lives only in a chunk and an unsealed one only in the buffer. There is no decode cache.

- **Sealing.** A minute is sealed once the wall clock is 10 s past its end and no pending frame
  targets it, on Stop Recording (the open minute included), and at startup for closed minutes newer
  than the newest chunk. Disconnect and Idle Pause are not triggers. One write transaction, under a
  `DatabaseReplacementFence` ticket, does the seal:
  1. Replay the minute's buffer rows from the preceding full state into canonical samples.
  2. Merge them with the minute's existing chunk.
  3. Encode, decode, and compare the result with the canonical samples.
  4. Write the chunk.
  5. Delete exactly the sealed row ids.

  If the comparison fails, every row is kept and a `telemetry_seal_failed` Diagnostic Event is
  recorded.

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
  full state before the range: a buffer keyframe or any chunk sample, whichever is later. The writer
  keeps its in-memory last state.
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
