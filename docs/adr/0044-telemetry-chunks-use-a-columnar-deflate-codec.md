# Telemetry Chunks use a columnar deflate codec

Raw telemetry is one `telemetry_frames` row per sample at about 2 Hz. A 97-ride-hour emulator
database held 645k rows, about 103 MB with indexes. A prototype that packed one Board's samples for
one minute into a columnar, delta-encoded, deflated blob stored the same data in 11.4 MB (about
2.3 KB per minute).

## Status

Accepted. Codec only (#685); the chunk table, sealing and the write path come later.

## Canonical sample model

A stored frame is sparse: `changed_mask_1` bit _i_ marks value column _i_ (speed .. motor
temperature, `TELEMETRY_MASK_*` order) as written by this row. **Masks are authoritative**:

- A keyframe (`flags & 1`) clears every column, then counts as all bits set.
- A set bit replaces the column with the row's value. NULL with a set bit is an explicit clear.
- A clear bit keeps the previous value, whatever the row holds.

`reconstructTelemetryValues` (Kotlin and Swift, `TelemetryChunkCodec`) is the one implementation;
Ride Export replays chains through it. Android's `FullTelemetryState.applyFrame` used to coalesce
NULL as "unchanged", so an odometer or temperature that went missing kept its old value; it now
follows the masks. `RebuildState.apply` (bucket rebuild) follows them too since ADR 0045.

The codec stores **reconstructed full samples**, never sparse rows.

## Binary contract v1

```
blob   = version:u8 (=1) count:uvarint base:svarint deflate(body)
body   = col(captured_at_ms, from base) col(elapsed_realtime_ms) col(flags)
         ncol(can_id) ncol(value 0) .. ncol(value 16)
col    = count × svarint delta
ncol   = presence bitmap (ceil(count/8) bytes, LSB first, 1 = present)
         then svarint delta for each present value only
```

- `uvarint` is unsigned LEB128, at most 10 bytes (the tenth may only be 0 or 1). `svarint` is a
  zigzag-encoded `uvarint`.
- Each delta is against the column's previous value (previous present value in an `ncol`),
  starting from `base` for `captured_at_ms` and 0 for every other column. Deltas use wrapping
  64-bit arithmetic.
- Declared widths: `captured_at_ms`, `elapsed_realtime_ms` and `odometer_cm` are 64-bit; `flags`,
  `can_id` and every other value column are 32-bit. The encoder rejects a value outside its width,
  and so does the decoder.
- `base` is the first sample's `captured_at_ms` (0 for an empty chunk). `count` is at most 65,536.
- Samples keep the order they were given: `(captured_at_ms, original insert order)`. Duplicate
  timestamps and clock reversals are preserved. A sample's identity in a chunk is its ordinal.
- `deflate` is raw deflate (RFC 1951, no zlib header or checksum), level 6 where the encoder takes
  one: Android `Deflater(6, true)` / `Inflater(true)`, iOS `COMPRESSION_ZLIB` (fixed level), server
  `zlib.deflateRawSync` / `inflateRawSync`.
- Decoders reject an unknown version, a count over the limit, a truncated or corrupt deflate stream,
  a body longer than `count × 213 + 16` bytes (bounded inflate), and a body with bytes left over.
  Bytes after the final deflate block are ignored: Apple's decoder does not report them.
- Every chunk decodes on its own.

The cross-platform contract is **decode equivalence**, not identical encoder bytes. The golden
blobs in `modules/vescape-core/shared/telemetry-chunk-codec-contract.json` come from both
encoders, and both platforms must decode every one of them to the same samples.

## Compression

Measured on the prototype (4,993 minutes): the columnar layout takes 103 MB to 21 MB, and every
algorithm then lands within about 5% (deflate 6: 11.4 MB, 0.6 ms per ride hour; zstd 19: 11.3 MB;
zstd 19 with a trained dictionary: 10.9 MB; xz: 11.0 MB but about 8× slower to decode). Deflate is
built into Android, iOS and the server, so it needs no native library and no shipped dictionary.
Level 9 gains nothing over 6. If space matters later, improve the layout (column scaling,
per-column delta order), not the algorithm.
