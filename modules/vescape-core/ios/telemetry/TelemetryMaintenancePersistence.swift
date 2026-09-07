import GRDB

/// Production telemetry maintenance transactions. The app and macOS host contract execute this
/// same orchestration so statement coverage cannot hide ordering or rollback defects.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
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
      try pruneOrphanRideRecordings(db)
      return count
    }
  }

  func deleteRanges(_ ranges: [TelemetryTimeRange], boardId: String?, allBoards: Bool, recordingId: String? = nil) throws -> Int {
    try writer.write { db in
      var count = 0
      for range in ranges {
        if let recordingId {
          count += try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms BETWEEN ? AND ? AND recording_id = ?", arguments: [range.startMs, range.endMs, recordingId]) ?? 0
          try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms BETWEEN ? AND ? AND recording_id = ?", arguments: [range.startMs, range.endMs, recordingId])
          try db.execute(sql: "DELETE FROM ride_track_points WHERE fix_at_ms BETWEEN ? AND ? AND recording_id = ?", arguments: [range.startMs, range.endMs, recordingId])
          try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ? AND recording_id = ?", arguments: [range.startMs, range.endMs, recordingId])
          // Markers/exclusions have no recording identity. Keep them for overlapping recordings.
          continue
        }
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
      try pruneOrphanRideRecordings(db)
      return count
    }
  }

  func clear(protectedRanges: [TelemetryTimeRange]) throws {
    if protectedRanges.isEmpty {
      try writer.write { db in
        try db.execute(sql: "DELETE FROM ride_track_points")
        try db.execute(sql: "DELETE FROM ride_recordings")
        try db.execute(sql: "DELETE FROM telemetry_frames")
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
        try db.execute(sql: "DELETE FROM telemetry_markers")
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges")
        try db.execute(sql: "DELETE FROM diagnostic_events")
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
        try pruneOrphanRideRecordings(db)
      }
    }
  }

  func rebuild(config: MetricSanitizerConfig, onProgress: (Int, Int) -> Void) throws -> Int {
    try writer.write { db in
      let frameFirst = try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames")
      let frameLast = try Int64.fetchOne(db, sql: "SELECT MAX(captured_at_ms) FROM telemetry_frames")
      let trackFirst = try Int64.fetchOne(db, sql: "SELECT MIN(fix_at_ms) FROM ride_track_points")
      let trackLast = try Int64.fetchOne(db, sql: "SELECT MAX(fix_at_ms) FROM ride_track_points")
      guard let first = [frameFirst, trackFirst].compactMap({ $0 }).min(),
            let last = [frameLast, trackLast].compactMap({ $0 }).max()
      else { return 0 }
      try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
      try db.execute(sql: "DELETE FROM metric_exclusion_ranges")
      let chunkMs: Int64 = 3_600_000
      let chunks = Int((last - first) / chunkMs + 1)
      var rebuilt = 0
      var previousTrackPoint: RideTrackPoint?
      onProgress(0, chunks)
      for index in 0..<chunks {
        let from = first + Int64(index) * chunkMs
        let to = min(from + chunkMs - 1, last)
        var points = try Row.fetchAll(db, sql: "SELECT * FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? ORDER BY captured_at_ms ASC", arguments: [from, to]).compactMap(bucketPoint)
        let track = try fetchRideTrackForAggregation(db, fromMs: from, toMs: to, boardId: nil).map(rideTrackPoint)
        let sanitization = sanitizeTelemetrySamples(points, track: track, config: config)
        for i in points.indices {
          points[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
          points[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
          points[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
        }
        for range in sanitization.exclusions { try insertExclusion(db, range) }
        for bucket in buildTelemetryBuckets(points, locationPoints: rideTrackBucketPoints(track, previous: previousTrackPoint, movingThresholdCentiKmh: config.movingSpeedThresholdCentiKmh)) { try upsertBucket(db, bucket); rebuilt += 1 }
        previousTrackPoint = track.last(where: rideTrackFixIsPrecise) ?? previousTrackPoint
        onProgress(index + 1, chunks)
      }
      return rebuilt
    }
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
    recordingId: (row["recording_id"] as String?) ?? LEGACY_RIDE_RECORDING_ID,
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
