import Foundation
import GRDB

// Telemetry Chunks (ADR 0045): sealed samples live in `telemetry_chunks`, unsealed ones in the
// `telemetry_frames` write buffer. Everything here runs inside the caller's transaction, so a read
// sees chunks and buffer from one snapshot and a write replaces both together.
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt

/// Wall-clock grace past a minute's end before it is sealed; above the 5 s recording flush delay.
internal let TELEMETRY_SEAL_GRACE_MS: Int64 = 10_000

/// Value columns in `changed_mask_1` bit order: the order of `TelemetrySample.values`.
internal let TELEMETRY_VALUE_COLUMN_NAMES = [
  "speed_centi_kmh", "battery_voltage_mv", "motor_current_ma", "battery_current_ma", "duty_permille",
  "pitch_centi_deg", "roll_centi_deg", "balance_pitch_centi_deg", "balance_current_ma", "erpm", "state",
  "switch_state", "adc1_milli", "adc2_milli", "odometer_cm", "temp_mosfet_deci_c", "temp_motor_deci_c",
]

/// One Board and wall-clock minute of telemetry; the unit a seal works on.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `TelemetryMinuteKey`
internal struct TelemetryMinuteKey: Hashable {
  let boardId: String?
  let minuteStartMs: Int64
}

internal struct TelemetrySealMismatch: Error, CustomStringConvertible {
  let key: TelemetryMinuteKey
  var description: String { "Telemetry Chunk verification failed for \(key.boardId ?? "unowned") at \(key.minuteStartMs)" }
}

internal func telemetryMinuteStart(_ atMs: Int64) -> Int64 {
  let q = atMs / TELEMETRY_BUCKET_SIZE_MS
  return (atMs % TELEMETRY_BUCKET_SIZE_MS != 0 && atMs < 0 ? q - 1 : q) * TELEMETRY_BUCKET_SIZE_MS
}

/// Read order position of the `index`th sample of chunk `chunkId`: negative, so it sorts before any
/// buffer row (positive id) at the same timestamp, and increasing with `index`. Unique across chunks,
/// it doubles as the sample id the bridge reports, exact in a JS number.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `chunkSampleOrdinal`
internal func chunkSampleOrdinal(chunkId: Int64, index: Int) -> Int64 {
  let max = Int64(TelemetryChunkCodec.maxSamples)
  return -(chunkId * max + (max - 1 - Int64(index)))
}

private let boardFilter = "(? OR board_key IS \(BOARD_KEY_OF_BOARD_ID))"
private func boardArguments(_ boardId: String?, _ allBoards: Bool) -> StatementArguments { [allBoards, boardId, boardId] }

private struct ChunkHeader {
  let id: Int64, boardId: String?, minuteStartMs: Int64, sampleCount: Int, firstAtMs: Int64, lastAtMs: Int64
}

/// Chunks holding any sample in `[fromMs, toMs]`, minute-ordered, payload left in the table.
private func chunkHeaders(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, allBoards: Bool) throws -> [ChunkHeader] {
  try Row.fetchAll(db, sql: """
    SELECT c.id, b.id AS board_id, c.minute_start_ms, c.sample_count, c.first_at_ms, c.last_at_ms
    FROM telemetry_chunks c LEFT JOIN boards b ON b.key = c.board_key
    WHERE c.minute_start_ms > ? AND c.minute_start_ms <= ? AND c.last_at_ms >= ? AND c.first_at_ms <= ?
      AND (? OR c.board_key IS \(BOARD_KEY_OF_BOARD_ID))
    ORDER BY c.minute_start_ms, c.board_key
    """, arguments: [fromMs > Int64.min + TELEMETRY_BUCKET_SIZE_MS ? fromMs - TELEMETRY_BUCKET_SIZE_MS : Int64.min,
                     toMs, fromMs, toMs] + boardArguments(boardId, allBoards)).map {
    ChunkHeader(id: $0["id"], boardId: $0["board_id"], minuteStartMs: $0["minute_start_ms"],
                sampleCount: $0["sample_count"], firstAtMs: $0["first_at_ms"], lastAtMs: $0["last_at_ms"])
  }
}

private func chunkSamples(_ db: Database, _ id: Int64) throws -> [TelemetrySample] {
  guard let payload = try Data.fetchOne(db, sql: "SELECT payload FROM telemetry_chunks WHERE id = ?", arguments: [id]) else { return [] }
  return try TelemetryChunkCodec.decode(payload)
}

/// A decoded chunk sample as a `telemetry_frames` row: a full keyframe, so every reader treats it as
/// its own anchor.
private func frameRow(_ sample: TelemetrySample, id: Int64, boardId: String?) -> Row {
  var columns: [String: (any DatabaseValueConvertible)?] = [
    "id": id, "captured_at_ms": sample.capturedAtMs, "elapsed_realtime_ms": sample.elapsedRealtimeMs,
    "board_id": boardId, "can_id": sample.canId.map { Int64($0) }, "flags": Int64(sample.flags) | Int64(TELEMETRY_FLAG_KEYFRAME),
    "changed_mask_1": Int64((1 << TELEMETRY_CHUNK_VALUE_COLUMNS) - 1), "changed_mask_2": Int64(0),
  ]
  for (i, name) in TELEMETRY_VALUE_COLUMN_NAMES.enumerated() { columns[name] = sample.values[i] }
  return Row(columns)
}

/// One sample of the merged stream: a buffer row, or a decoded chunk sample with its original flags.
private struct StreamItem {
  let row: Row
  let capturedAtMs: Int64
  let ordinal: Int64
  let sample: TelemetrySample?
}

/// Chunks and buffer in `[fromMs, toMs]` merged in `(captured_at_ms, ordinal)` order, after the
/// cursor and at most `limit`. `allBoards` ignores `boardId`; otherwise nil `boardId` means the
/// unowned samples. Chunks are decoded only as far as the page needs.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `telemetryStream`
private func telemetryStream(
  _ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, allBoards: Bool,
  afterMs: Int64 = Int64.min, afterId: Int64 = Int64.min, limit: Int = Int.max
) throws -> [StreamItem] {
  var items = try Row.fetchAll(db, sql: """
    SELECT * FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?
      AND (? OR board_id IS ?)
      AND (captured_at_ms > ? OR (captured_at_ms = ? AND id > ?))
    ORDER BY captured_at_ms, id LIMIT ?
    """, arguments: [fromMs, toMs, allBoards, boardId, afterMs, afterMs, afterId, Int64(clamping: limit)]).map {
    StreamItem(row: $0, capturedAtMs: $0["captured_at_ms"], ordinal: $0["id"], sample: nil)
  }
  var fromChunks = 0
  var lastMinute: Int64?
  for header in try chunkHeaders(db, fromMs: max(fromMs, afterMs), toMs: toMs, boardId: boardId, allBoards: allBoards) {
    // Later minutes cannot reach a page already filled by earlier ones.
    if fromChunks >= limit && header.minuteStartMs != lastMinute { break }
    lastMinute = header.minuteStartMs
    for (index, sample) in try chunkSamples(db, header.id).enumerated() {
      let t = sample.capturedAtMs
      let id = chunkSampleOrdinal(chunkId: header.id, index: index)
      if t < fromMs || t > toMs || t < afterMs || (t == afterMs && id <= afterId) { continue }
      items.append(StreamItem(row: frameRow(sample, id: id, boardId: header.boardId), capturedAtMs: t, ordinal: id, sample: sample))
      fromChunks += 1
    }
  }
  items.sort { ($0.capturedAtMs, $0.ordinal) < ($1.capturedAtMs, $1.ordinal) }
  return items.count > limit ? Array(items.prefix(limit)) : items
}

/// Samples as `telemetry_frames` rows, chunks and buffer merged; see `telemetryStream`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `readTelemetryFramesImpl`
internal func telemetryFrameRows(
  _ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, allBoards: Bool,
  afterMs: Int64 = Int64.min, afterId: Int64 = Int64.min, limit: Int = Int.max
) throws -> [Row] {
  try telemetryStream(db, fromMs: fromMs, toMs: toMs, boardId: boardId, allBoards: allBoards,
                      afterMs: afterMs, afterId: afterId, limit: limit).map(\.row)
}

/// Start of the latest full state strictly before `beforeMs`: a buffer keyframe or any chunk sample.
/// Replaying from here reconstructs every later buffer delta, across a seal boundary included.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `telemetryAnchorMs`
internal func telemetryAnchorMs(_ db: Database, beforeMs: Int64, boardId: String?, allBoards: Bool) throws -> Int64? {
  let buffer = try Int64.fetchOne(db, sql: """
    SELECT MAX(captured_at_ms) FROM telemetry_frames WHERE captured_at_ms < ?
      AND (? OR board_id IS ?) AND (flags & 1) != 0
    """, arguments: [beforeMs, allBoards, boardId])
  let chunk = try Int64.fetchOne(db, sql: """
    SELECT first_at_ms FROM telemetry_chunks WHERE minute_start_ms < ? AND first_at_ms < ? AND \(boardFilter)
    ORDER BY minute_start_ms DESC LIMIT 1
    """, arguments: [beforeMs, beforeMs] + boardArguments(boardId, allBoards))
  return [buffer, chunk].compactMap { $0 }.max()
}

/// Samples stored, chunks and buffer together.
internal func telemetrySampleCount(_ db: Database) throws -> Int {
  try Int.fetchOne(db, sql: "SELECT (SELECT COUNT(*) FROM telemetry_frames) + (SELECT IFNULL(SUM(sample_count), 0) FROM telemetry_chunks)") ?? 0
}

internal func firstTelemetrySampleAt(_ db: Database) throws -> Int64? {
  try Int64.fetchOne(db, sql: "SELECT MIN(at) FROM (SELECT MIN(captured_at_ms) AS at FROM telemetry_frames UNION ALL SELECT MIN(first_at_ms) FROM telemetry_chunks)")
}

internal func lastTelemetrySampleAt(_ db: Database) throws -> Int64? {
  try Int64.fetchOne(db, sql: "SELECT MAX(at) FROM (SELECT MAX(captured_at_ms) AS at FROM telemetry_frames UNION ALL SELECT MAX(last_at_ms) FROM telemetry_chunks)")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `firstTelemetrySampleAtOrAfter`
internal func firstTelemetrySampleAtOrAfter(_ db: Database, _ fromMs: Int64) throws -> Int64? {
  let minute = telemetryMinuteStart(fromMs)
  // Only chunks of fromMs's own minute can straddle it; every later chunk starts after it.
  let straddling = try chunkHeaders(db, fromMs: fromMs, toMs: minute + TELEMETRY_BUCKET_SIZE_MS - 1, boardId: nil, allBoards: true)
    .compactMap { try chunkSamples(db, $0.id).first { $0.capturedAtMs >= fromMs }?.capturedAtMs }
  let buffer = try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames WHERE captured_at_ms >= ?", arguments: [fromMs])
  let later = try Int64.fetchOne(db, sql: """
    SELECT MIN(first_at_ms) FROM telemetry_chunks WHERE minute_start_ms =
      (SELECT MIN(minute_start_ms) FROM telemetry_chunks WHERE minute_start_ms > ?)
    """, arguments: [minute])
  return (straddling + [buffer, later].compactMap { $0 }).min()
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `telemetrySampleExists`
internal func telemetrySampleExists(_ db: Database, atMs: Int64, boardId: String?) throws -> Bool {
  if try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM telemetry_frames WHERE captured_at_ms = ? AND board_id IS ?)", arguments: [atMs, boardId]) == true {
    return true
  }
  return try chunkHeaders(db, fromMs: atMs, toMs: atMs, boardId: boardId, allBoards: false).contains { header in
    try chunkSamples(db, header.id).contains { $0.capturedAtMs == atMs }
  }
}

private func writeChunk(_ db: Database, id: Int64, samples: [TelemetrySample], payload: Data) throws {
  try db.execute(sql: """
    UPDATE telemetry_chunks SET codec_version = ?, sample_count = ?, first_at_ms = ?, last_at_ms = ?, payload = ? WHERE id = ?
    """, arguments: [Int64(TelemetryChunkCodec.version), samples.count, samples.first!.capturedAtMs, samples.last!.capturedAtMs, payload, id])
}

/// Remove the samples in `[fromMs, toMs]` from every matching chunk, re-encoding a chunk that keeps
/// any. Returns the samples removed. The buffer side is the caller's plain range delete.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `trimTelemetryChunks`
@discardableResult
internal func trimTelemetryChunks(_ db: Database, fromMs: Int64, toMs: Int64, boardId: String?, allBoards: Bool) throws -> Int {
  var removed = 0
  for header in try chunkHeaders(db, fromMs: fromMs, toMs: toMs, boardId: boardId, allBoards: allBoards) {
    if header.firstAtMs >= fromMs && header.lastAtMs <= toMs {
      try db.execute(sql: "DELETE FROM telemetry_chunks WHERE id = ?", arguments: [header.id])
      removed += header.sampleCount
      continue
    }
    let samples = try chunkSamples(db, header.id)
    let kept = samples.filter { $0.capturedAtMs < fromMs || $0.capturedAtMs > toMs }
    removed += samples.count - kept.count
    if kept.isEmpty {
      try db.execute(sql: "DELETE FROM telemetry_chunks WHERE id = ?", arguments: [header.id])
    } else if kept.count != samples.count {
      try writeChunk(db, id: header.id, samples: kept, payload: try TelemetryChunkCodec.encode(kept))
    }
  }
  return removed
}

/// Seal one Board's minute: replay its buffer rows from the preceding full state into canonical
/// samples, merge them with the minute's existing chunk, encode, verify the decode round-trips, write
/// the chunk and delete exactly the sealed rows. Returns the rows sealed; 0 when there is nothing to
/// seal or the Board has no key. Throws `TelemetrySealMismatch` before any write when verification
/// fails, so the caller's transaction keeps every row.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `sealTelemetryMinuteImpl`
@discardableResult
internal func sealTelemetryMinute(_ db: Database, _ key: TelemetryMinuteKey) throws -> Int {
  var boardKey: Int64?
  if let boardId = key.boardId {
    guard let found = try Int64.fetchOne(db, sql: "SELECT key FROM boards WHERE id = ?", arguments: [boardId]) else { return 0 }
    boardKey = found
  }
  let minuteEnd = key.minuteStartMs + TELEMETRY_BUCKET_SIZE_MS - 1
  let start = try telemetryAnchorMs(db, beforeMs: key.minuteStartMs, boardId: key.boardId, allBoards: false) ?? key.minuteStartMs
  var values = [Int64?](repeating: nil, count: TELEMETRY_CHUNK_VALUE_COLUMNS)
  var samples: [TelemetrySample] = []
  var sealed: [Int64] = []
  for item in try telemetryStream(db, fromMs: start, toMs: minuteEnd, boardId: key.boardId, allBoards: false) {
    let sample: TelemetrySample
    if let decoded = item.sample {
      sample = decoded
      values = decoded.values
    } else {
      let row = item.row
      let flags: Int = row["flags"]
      reconstructTelemetryValues(&values, flags: flags, changedMask1: row["changed_mask_1"],
                                 row: TELEMETRY_VALUE_COLUMN_NAMES.map { row[$0] as Int64? })
      sample = TelemetrySample(capturedAtMs: item.capturedAtMs, elapsedRealtimeMs: row["elapsed_realtime_ms"],
                               canId: row["can_id"], flags: Int32(flags), values: values)
    }
    guard item.capturedAtMs >= key.minuteStartMs else { continue }
    samples.append(sample)
    if item.sample == nil { sealed.append(item.ordinal) }
  }
  guard !sealed.isEmpty else { return 0 }
  let payload = try TelemetryChunkCodec.encode(samples)
  guard try TelemetryChunkCodec.decode(payload) == samples else { throw TelemetrySealMismatch(key: key) }
  if let existing = try Int64.fetchOne(db, sql: "SELECT id FROM telemetry_chunks WHERE board_key IS ? AND minute_start_ms = ?", arguments: [boardKey, key.minuteStartMs]) {
    try writeChunk(db, id: existing, samples: samples, payload: payload)
  } else {
    try db.execute(sql: """
      INSERT INTO telemetry_chunks (board_key, minute_start_ms, codec_version, sample_count, first_at_ms, last_at_ms, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      """, arguments: [boardKey, key.minuteStartMs, Int64(TelemetryChunkCodec.version), samples.count,
                       samples.first!.capturedAtMs, samples.last!.capturedAtMs, payload])
  }
  for batch in stride(from: 0, to: sealed.count, by: 500) {
    let ids = sealed[batch..<min(batch + 500, sealed.count)]
    try db.execute(sql: "DELETE FROM telemetry_frames WHERE id IN (\(ids.map { _ in "?" }.joined(separator: ",")))", arguments: StatementArguments(Array(ids)))
  }
  return sealed.count
}

/// Closed minutes of buffer rows newer than the newest chunk: what a previous process recorded but
/// never sealed. Older rows are the pre-chunk backlog, drained separately.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `leftoverTelemetryMinutes`
internal func leftoverTelemetryMinutes(_ db: Database, beforeMs: Int64) throws -> [TelemetryMinuteKey] {
  try Row.fetchAll(db, sql: """
    SELECT DISTINCT board_id, (captured_at_ms / 60000) * 60000 AS minute_start_ms FROM telemetry_frames
    WHERE captured_at_ms > (SELECT MAX(last_at_ms) FROM telemetry_chunks) AND captured_at_ms < ?
    """, arguments: [beforeMs]).map { TelemetryMinuteKey(boardId: $0["board_id"], minuteStartMs: $0["minute_start_ms"]) }
}

/// Seal what a previous process recorded but never sealed: closed minutes newer than the newest
/// chunk, one fenced transaction each. A minute that fails verification keeps its rows and is
/// reported through `onFailure`. Throws `MaintenanceRunFenced` once Restore or Clear all replaced
/// the database.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryChunkStore.kt `sealLeftoverTelemetry`
@discardableResult
internal func sealLeftoverTelemetry(_ scope: MaintenanceJobScope, onFailure: (TelemetryMinuteKey, Error) -> Void) throws -> Int {
  let beforeMs = telemetryMinuteStart(scope.nowMs() - TELEMETRY_SEAL_GRACE_MS)
  let keys = try scope.chunk { try leftoverTelemetryMinutes($0, beforeMs: beforeMs) }
  var sealed = 0
  for key in keys {
    do {
      sealed += try scope.chunk { try sealTelemetryMinute($0, key) }
    } catch let failure as TelemetrySealMismatch {
      onFailure(key, failure)
    }
  }
  return sealed
}
