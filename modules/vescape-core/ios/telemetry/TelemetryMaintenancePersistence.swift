import GRDB

/// Production telemetry maintenance transactions. The app and macOS host contract execute this
/// same orchestration so statement coverage cannot hide ordering or rollback defects.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
struct TelemetryMaintenancePersistence {
  let writer: any DatabaseWriter

  func deleteBefore(_ beforeMs: Int64) throws -> Int {
    try writer.write { db in
      let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [beforeMs]) ?? 0
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
    try writer.write { db in
      var count = 0
      for range in ranges {
        if allBoards {
          count += try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs]) ?? 0
          try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ?", arguments: [range.startMs, range.endMs])
        } else {
          count += try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId]) ?? 0
          try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
          try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
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
  }

  func clear(protectedRanges: [TelemetryTimeRange]) throws {
    if protectedRanges.isEmpty {
      try writer.write { db in
        try db.execute(sql: "DELETE FROM ride_track_points")
        try db.execute(sql: "DELETE FROM telemetry_frames")
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
        try db.execute(sql: "DELETE FROM telemetry_markers")
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges")
        try db.execute(sql: "DELETE FROM diagnostic_events")
        try db.execute(sql: "DELETE FROM weather_observations")
      }
    } else {
      let ranges = subtractProtectedTelemetryRanges(
        deleteRange: .init(startMs: Int64.min, endMs: Int64.max), protectedRanges: protectedRanges
      )
      try writer.write { db in
        try db.execute(sql: "DELETE FROM diagnostic_events")
        for range in ranges {
          try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms >= ? AND fix_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ?", arguments: [range.startMs, range.endMs])
          try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ?", arguments: [range.startMs, range.endMs])
        }
        // A Favorite keeps the rows its weather reads: every row inside it, and an applicable start row.
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

/// Read-only state one Ride summaries chunk hands the next: the last precise Ride Track fix. It
/// shapes the next chunk's output but is never written as it, and every chunk re-checks it against
/// the database, so a ride deleted between chunks cannot leak into the rebuild.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `RideSummariesContext`
final class RideSummariesContext {
  fileprivate(set) var previousTrack: RideTrackPoint?
}

/// What one Ride summaries chunk did. Owned ranges are half-open `[from, to)` on whole minutes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `RideSummariesChunkResult`
enum RideSummariesChunkResult: Equatable {
  /// Rebuilt `[fromMs, toMs)`; `endMs` is where this run currently stops.
  case rebuilt(toMs: Int64, endMs: Int64)
  /// Nothing left to rebuild: every old-generation minute is replaced.
  case finished
  /// The rest belongs to a potentially active ride; check again at `retryAtMs`.
  case activeRide(retryAtMs: Int64)
}

private func floorTo(_ ms: Int64, _ size: Int64) -> Int64 {
  let q = ms / size
  return (ms % size != 0 && ms < 0 ? q - 1 : q) * size
}

private func floorMinute(_ ms: Int64) -> Int64 { floorTo(ms, TELEMETRY_BUCKET_SIZE_MS) }
private func floorChunk(_ ms: Int64) -> Int64 { floorTo(ms, RIDE_SUMMARIES_CHUNK_MS) }

internal func lastSampleAt(_ db: Database) throws -> Int64? {
  [try Int64.fetchOne(db, sql: "SELECT MAX(captured_at_ms) FROM telemetry_frames"),
   try Int64.fetchOne(db, sql: "SELECT MAX(fix_at_ms) FROM ride_track_points")].compactMap { $0 }.max()
}

/// First owned chunk start, or nil for a database with no frames and no Ride Track.
internal func rideSummariesStartMs(_ db: Database) throws -> Int64? {
  [try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames"),
   try Int64.fetchOne(db, sql: "SELECT MIN(fix_at_ms) FROM ride_track_points")].compactMap { $0 }.min().map(floorChunk)
}

/// Start of the derived ride that may still be recording (ADR 0041), or nil when the newest sample
/// is a full split gap old. Every Board and both streams count, and a Stop Recording is ignored, so
/// the cutoff can only be earlier than the real ride start, never later.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt `activeRideStartMs`
internal func activeRideStartMs(_ db: Database, nowMs: Int64, gapMs: Int64) throws -> Int64? {
  guard let last = try lastSampleAt(db), nowMs - last < gapMs else { return nil }
  var start = last
  while true {
    let earlier = [
      try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames WHERE captured_at_ms >= ?", arguments: [start - gapMs]),
      try Int64.fetchOne(db, sql: "SELECT MIN(fix_at_ms) FROM ride_track_points WHERE fix_at_ms >= ?", arguments: [start - gapMs]),
    ].compactMap { $0 }.min()
    guard let earlier, earlier < start else { return start }
    start = earlier
  }
}

/// Replace the complete minute buckets and exclusion portions in one owned chunk starting at
/// `fromMs`, reading frames, Ride Track and boundary context in the same transaction. Live additive
/// upserts never meet a rebuilt bucket: the potentially active ride is never owned.
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

  // Context that a deletion removed since the last chunk no longer exists to carry.
  if let previous = context.previousTrack,
     try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM ride_track_points WHERE fix_at_ms = ? AND board_id IS ?)", arguments: [previous.fixAtMs, previous.boardId]) != true {
    context.previousTrack = nil
  }

  try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms >= ? AND bucket_start_ms < ?", arguments: [fromMs, toMs])
  try trimExclusions(db, fromMs: fromMs, toMs: toMs)

  var points = try Row.fetchAll(db, sql: "SELECT * FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms < ? ORDER BY captured_at_ms ASC", arguments: [fromMs, toMs]).compactMap(bucketPoint)
  let track = try fetchRideTrackForAggregation(db, fromMs: fromMs, toMs: toMs - 1, boardId: nil).map(rideTrackPoint)
  // Free spin reads the nearest fix, which may sit just outside the owned span.
  let sanitizerTrack = try fetchRideTrackForAggregation(
    db, fromMs: fromMs - FREE_SPIN_NEAREST_GPS_MAX_AGE_MS, toMs: toMs - 1 + FREE_SPIN_NEAREST_GPS_MAX_AGE_MS, boardId: nil
  ).map(rideTrackPoint)
  let locations = rideTrackBucketPoints(track, previous: context.previousTrack, movingThresholdCentiKmh: config.movingSpeedThresholdCentiKmh)
  context.previousTrack = track.last(where: rideTrackFixIsPrecise) ?? context.previousTrack
  let sanitization = sanitizeTelemetrySamples(points, track: sanitizerTrack, config: config)
  for i in points.indices {
    points[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
    points[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
    points[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
  }
  // Plain inserts: merging into a neighbouring range would rewrite another chunk's output.
  for range in sanitization.exclusions { try insertExclusion(db, range) }
  for bucket in buildTelemetryBuckets(points, locationPoints: locations) {
    try upsertBucket(db, bucket)
    try refreshBucketRoutePreview(db, bucketStartMs: bucket.bucketStartMs, boardId: bucket.boardId)
  }
  return .rebuilt(toMs: toMs, endMs: end)
}

/// Remove the `[fromMs, toMs)` portion of every exclusion range, keeping what lies outside it.
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
