import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
struct TelemetryMaintenancePersistence {
  let writer: any DatabaseWriter

  func deleteBefore(_ beforeMs: Int64) throws -> Int {
    try writer.write { db in
      var count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [beforeMs]) ?? 0
      count += try trimTelemetryChunks(db, fromMs: Int64.min, toMs: beforeMs - 1, boardId: nil, allBoards: true)
      try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms < ?", arguments: [beforeMs])
      try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [beforeMs])
      try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms < ?", arguments: [beforeMs])
      try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms < ?", arguments: [beforeMs])
      try db.execute(sql: "DELETE FROM diagnostic_events WHERE occurred_at_ms < ?", arguments: [beforeMs])
      try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms < ?", arguments: [beforeMs])
      return count
    }
  }

  func deleteRanges(_ ranges: [TelemetryTimeRange], boardId: String?, allBoards: Bool) throws -> Int {
    try writer.write { db in try Self.deleteRanges(db, ranges, boardId: boardId, allBoards: allBoards) }
  }

  func deleteBoardRanges(_ rangesByBoard: [String?: [TelemetryTimeRange]]) throws -> Int {
    try writer.write { db in
      try rangesByBoard.reduce(0) { $0 + (try Self.deleteRanges(db, $1.value, boardId: $1.key, allBoards: false)) }
    }
  }

  private static func deleteRanges(_ db: Database, _ ranges: [TelemetryTimeRange], boardId: String?, allBoards: Bool) throws -> Int {
    var count = 0
    for range in ranges {
      if allBoards {
        count += try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs]) ?? 0
        try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ?", arguments: [range.startMs, range.endMs])
        try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs])
        count += try trimTelemetryChunks(db, fromMs: range.startMs, toMs: range.endMs, boardId: nil, allBoards: true)
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ?", arguments: [range.startMs, range.endMs])
        try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ?", arguments: [range.startMs, range.endMs])
      } else {
        count += try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId]) ?? 0
        try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND board_key IS \(BOARD_KEY_OF_BOARD_ID)", arguments: [range.startMs, range.endMs, boardId, boardId])
        try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
        count += try trimTelemetryChunks(db, fromMs: range.startMs, toMs: range.endMs, boardId: boardId, allBoards: false)
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ? AND board_id = ?", arguments: [range.startMs, range.endMs, boardId ?? UNKNOWN_TELEMETRY_BOARD_ID])
        try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
      }
      if allBoards {
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ?", arguments: [range.startMs, range.endMs])
      } else {
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
      }
    }
    return count
  }

  func clear(protectedRanges: [TelemetryTimeRange]) throws {
    if protectedRanges.isEmpty {
      try writer.write { db in
        try db.execute(sql: "DELETE FROM ride_track_points")
        try db.execute(sql: "DELETE FROM telemetry_frames")
        try db.execute(sql: "DELETE FROM telemetry_chunks")
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
        try db.execute(sql: "DELETE FROM telemetry_markers")
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges")
        try db.execute(sql: "DELETE FROM diagnostic_events")
        try db.execute(sql: "DELETE FROM weather_observations")
        try forgetTelemetryStorage(db)
      }
    } else {
      let ranges = subtractProtectedTelemetryRanges(
        deleteRange: .init(startMs: Int64.min, endMs: Int64.max), protectedRanges: protectedRanges
      )
      try writer.write { db in
        try db.execute(sql: "DELETE FROM diagnostic_events")
        try forgetTelemetryStorage(db)
        for range in ranges {
          try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try trimTelemetryChunks(db, fromMs: range.startMs, toMs: range.endMs, boardId: nil, allBoards: true)
          try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ?", arguments: [range.startMs, range.endMs])
        }
        let weatherProtected = protectedRanges.map {
          TelemetryTimeRange(startMs: weatherProtectionStart($0.startMs), endMs: $0.endMs)
        }
        for range in subtractProtectedTelemetryRanges(deleteRange: .init(startMs: Int64.min, endMs: Int64.max), protectedRanges: weatherProtected) {
          try db.execute(sql: "DELETE FROM weather_observations WHERE observed_at_ms >= ? AND observed_at_ms <= ?", arguments: [range.startMs, range.endMs])
        }
      }
    }
  }
}

internal let RIDE_SUMMARIES_CHUNK_MS: Int64 = 3_600_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `DIAGNOSTIC_EVENT_RETENTION_MS`
internal let DIAGNOSTIC_EVENT_RETENTION_MS: Int64 = 30 * 24 * 60 * 60 * 1000
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `DIAGNOSTIC_EVENT_PRUNE_BATCH`
internal let DIAGNOSTIC_EVENT_PRUNE_BATCH = 5_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `DiagnosticEventPruneResult`
struct DiagnosticEventPruneResult {
  let deleted: Int
  let yielded: Bool
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `pruneDiagnosticEvents`
@discardableResult
internal func pruneDiagnosticEvents(_ scope: MaintenanceJobScope, gapMs: Int64, batch: Int = DIAGNOSTIC_EVENT_PRUNE_BATCH) throws -> DiagnosticEventPruneResult {
  let beforeMs = scope.nowMs() - DIAGNOSTIC_EVENT_RETENTION_MS
  var deleted = 0
  while true {
    let count: Int? = try scope.chunk { db in
      if try activeRideStartMs(db, nowMs: scope.nowMs(), gapMs: gapMs) != nil { return nil }
      try db.execute(
        sql: "DELETE FROM diagnostic_events WHERE id IN (SELECT id FROM diagnostic_events WHERE occurred_at_ms < ? LIMIT ?)",
        arguments: [beforeMs, batch]
      )
      return db.changesCount
    }
    guard let count else { return DiagnosticEventPruneResult(deleted: deleted, yielded: true) }
    deleted += count
    scope.progress(deleted, deleted)
    if count < batch { return DiagnosticEventPruneResult(deleted: deleted, yielded: false) }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `RideSummariesContext`
final class RideSummariesContext {
  fileprivate(set) var previousTrack: RideTrackPoint?
  fileprivate(set) var freeSpin = FreeSpinCarry()
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `RideSummariesChunkResult`
enum RideSummariesChunkResult: Equatable {
  case rebuilt(toMs: Int64, endMs: Int64)
  case finished
  case activeRide(retryAtMs: Int64)
}

private func floorTo(_ ms: Int64, _ size: Int64) -> Int64 {
  let q = ms / size
  return (ms % size != 0 && ms < 0 ? q - 1 : q) * size
}

private func floorMinute(_ ms: Int64) -> Int64 { floorTo(ms, TELEMETRY_BUCKET_SIZE_MS) }
private func floorChunk(_ ms: Int64) -> Int64 { floorTo(ms, RIDE_SUMMARIES_CHUNK_MS) }

internal func lastSampleAt(_ db: Database) throws -> Int64? {
  [try lastTelemetrySampleAt(db),
   try Int64.fetchOne(db, sql: "SELECT MAX(fix_at_ms) FROM ride_track_points")].compactMap { $0 }.max()
}

internal func rideSummariesStartMs(_ db: Database) throws -> Int64? {
  [try firstTelemetrySampleAt(db),
   try Int64.fetchOne(db, sql: "SELECT MIN(fix_at_ms) FROM ride_track_points")].compactMap { $0 }.min().map(floorChunk)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `lastSampleAtOrBefore`
internal func lastSampleAtOrBefore(_ db: Database, nowMs: Int64) throws -> Int64? {
  try Int64.fetchOne(db, sql: """
    SELECT MAX(at) FROM (
      SELECT MAX(captured_at_ms) AS at FROM telemetry_frames WHERE captured_at_ms <= :nowMs
      UNION ALL SELECT MAX(MIN(last_at_ms, :nowMs)) FROM telemetry_chunks WHERE first_at_ms <= :nowMs
      UNION ALL SELECT MAX(fix_at_ms) FROM ride_track_points WHERE fix_at_ms <= :nowMs
    )
    """, arguments: ["nowMs": nowMs])
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `activeRideStartMs`
internal func activeRideStartMs(_ db: Database, nowMs: Int64, gapMs: Int64) throws -> Int64? {
  guard let last = try lastSampleAtOrBefore(db, nowMs: nowMs), nowMs - last < gapMs else { return nil }
  var start = last
  while true {
    let earlier = [
      try firstTelemetrySampleAtOrAfter(db, start - gapMs),
      try Int64.fetchOne(db, sql: "SELECT MIN(fix_at_ms) FROM ride_track_points WHERE fix_at_ms >= ?", arguments: [start - gapMs]),
    ].compactMap { $0 }.min()
    guard let earlier, earlier < start else { return start }
    start = earlier
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `rebuildRideSummariesChunkImpl`
internal func rebuildRideSummariesChunk(
  _ db: Database,
  fromMs: Int64,
  context: RideSummariesContext,
  config: MetricSanitizerConfig,
  gapMs: Int64,
  nowMs: Int64
) throws -> RideSummariesChunkResult {
  guard let last = try lastSampleAt(db) else { return .finished }
  let active = try activeRideStartMs(db, nowMs: nowMs, gapMs: gapMs)
  let dataEnd = floorMinute(last) + TELEMETRY_BUCKET_SIZE_MS
  let end = active.map { min(floorMinute($0), dataEnd) } ?? dataEnd
  guard fromMs < end else { return active != nil ? .activeRide(retryAtMs: last + gapMs) : .finished }
  let toMs = min(floorChunk(fromMs) + RIDE_SUMMARIES_CHUNK_MS, end)

  if let previous = context.previousTrack,
     try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM ride_track_points WHERE fix_at_ms = ? AND board_key IS \(BOARD_KEY_OF_BOARD_ID))", arguments: [previous.fixAtMs, previous.boardId, previous.boardId]) != true {
    context.previousTrack = nil
  }
  context.freeSpin.boards = try context.freeSpin.boards.filter { _, state in
    guard let previous = state.previous else { return true }
    return try telemetrySampleExists(db, atMs: previous.capturedAtMs, boardId: previous.boardId)
  }

  try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms >= ? AND bucket_start_ms < ?", arguments: [fromMs, toMs])
  try trimExclusions(db, fromMs: fromMs, toMs: toMs)

  var points = try telemetryFrameRows(db, fromMs: fromMs, toMs: toMs - 1, boardId: nil, allBoards: true).compactMap(bucketPoint)
  let track = try fetchRideTrackForAggregation(db, fromMs: fromMs, toMs: toMs - 1, boardId: nil).map(rideTrackPoint)
  let locations = rideTrackBucketPoints(track, previous: context.previousTrack, movingThresholdCentiKmh: config.movingSpeedThresholdCentiKmh)
  context.previousTrack = track.last(where: rideTrackFixIsPrecise) ?? context.previousTrack
  let sanitization = sanitizeTelemetrySamples(points, config: config, freeSpinCarry: context.freeSpin)
  context.freeSpin = sanitization.freeSpinCarry
  for i in points.indices {
    points[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
    points[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
    points[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
  }
  for range in sanitization.exclusions { try insertExclusion(db, range) }
  for bucket in buildTelemetryBuckets(points, locationPoints: locations) {
    try upsertBucket(db, bucket)
    try refreshBucketRoutePreview(db, bucketStartMs: bucket.bucketStartMs, boardId: bucket.boardId)
  }
  return .rebuilt(toMs: toMs, endMs: end)
}

private func trimExclusions(_ db: Database, fromMs: Int64, toMs: Int64) throws {
  let rows = try Row.fetchAll(db, sql: "SELECT * FROM metric_exclusion_ranges WHERE start_ms <= ? AND end_ms >= ?", arguments: [toMs - 1, fromMs])
  for row in rows {
    let startMs: Int64 = row["start_ms"], endMs: Int64 = row["end_ms"], count: Int = row["sample_count"]
    try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE id = ?", arguments: [row["id"] as Int64])
    let span = Double(endMs - startMs + 1)
    func part(_ start: Int64, _ end: Int64) -> MetricExclusionRange {
      MetricExclusionRange(boardId: row["board_id"], reason: row["reason"], startMs: start, endMs: end,
                           sampleCount: max(1, Int((Double(count) * Double(end - start + 1) / span).rounded())))
    }
    if startMs < fromMs { try insertExclusion(db, part(startMs, fromMs - 1)) }
    if endMs >= toMs { try insertExclusion(db, part(toMs, endMs)) }
  }
}

internal func upsertBucket(_ db: Database, _ bucket: TelemetryBucket) throws {
  try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
}

internal func insertExclusion(_ db: Database, _ range: MetricExclusionRange) throws {
  try db.execute(
    sql: "INSERT INTO metric_exclusion_ranges (board_id, reason, start_ms, end_ms, sample_count) VALUES (?, ?, ?, ?, ?)",
    arguments: [range.boardId, range.reason, range.startMs, range.endMs, range.sampleCount]
  )
}

internal func insertMarker(_ db: Database, _ marker: [String: Any?]) throws {
  try db.execute(
    sql: "INSERT INTO telemetry_markers (occurred_at_ms, elapsed_realtime_ms, type, board_id, message, gap_ms) VALUES (?, ?, ?, ?, ?, ?)",
    arguments: [telemetryLong(marker["occurredAtMs"] ?? nil) ?? telemetryNowMs(),
                telemetryLong(marker["elapsedRealtimeMs"] ?? nil) ?? 0,
                marker["type"] as? String ?? "event", marker["boardId"] as? String,
                marker["message"] as? String, telemetryLong(marker["gapMs"] ?? nil)]
  )
}

internal func bucketPoint(_ row: Row) -> BucketTelemetryPoint? {
  BucketTelemetryPoint(
    capturedAtMs: row["captured_at_ms"] as Int64,
    boardId: row["board_id"] as String?,
    speedCentiKmh: row["speed_centi_kmh"] as Int? ?? 0,
    batteryVoltageMv: row["battery_voltage_mv"] as Int? ?? 0,
    motorCurrentMa: row["motor_current_ma"] as Int? ?? 0,
    batteryCurrentMa: row["battery_current_ma"] as Int? ?? 0,
    dutyPermille: row["duty_permille"] as Int? ?? 0,
    odometerCm: row["odometer_cm"] as Int64?,
    tempMosfetDeciC: row["temp_mosfet_deci_c"] as Int?,
    tempMotorDeciC: row["temp_motor_deci_c"] as Int?
  )
}
