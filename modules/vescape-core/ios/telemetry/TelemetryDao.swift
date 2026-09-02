import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
internal func insertFrame(_ db: Database, _ state: FullTelemetryState) throws {
  let t = state.t
  let loc = state.location
  try db.execute(
    sql: """
      INSERT INTO telemetry_frames (
        captured_at_ms, elapsed_realtime_ms, board_id, can_id, flags, changed_mask_1, changed_mask_2,
        speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, duty_permille,
        pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state,
        switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c,
        latitude_e7, longitude_e7, gps_speed_centi_mps, bearing_centi_deg, accuracy_cm,
        altitude_cm, location_timestamp_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
    arguments: [
      state.capturedAtMs, state.elapsedRealtimeMs, state.boardId, state.capture.canId,
      TELEMETRY_FLAG_KEYFRAME | (loc == nil ? 0 : TELEMETRY_FLAG_HAS_LOCATION),
      Int.max, 1,
      telemetryCenti(t.speed), telemetryMilli(t.batteryVoltage), telemetryMilli(t.motorCurrent), telemetryMilli(t.batteryCurrent), telemetryMilli(t.dutyCycle),
      telemetryCenti(t.pitch), telemetryCenti(t.roll), telemetryCenti(t.balancePitch), telemetryMilli(t.balanceCurrent), t.erpm, t.state,
      t.switchState, telemetryMilli(t.adc1), telemetryMilli(t.adc2), t.odometer.map { Int64(($0 * 100.0).rounded()) },
      t.tempMosfet.map { telemetryDeci($0) }, t.tempMotor.map { telemetryDeci($0) },
      loc.map { Int64(($0.latitude * 10_000_000.0).rounded()) },
      loc.map { Int64(($0.longitude * 10_000_000.0).rounded()) },
      loc?.speedMps.map { telemetryCenti($0) }, loc?.bearingDeg.map { telemetryCenti($0) },
      loc?.accuracyM.map { telemetryCenti($0) }, loc?.altitudeM.map { telemetryCenti($0) }, loc?.timestamp,
    ]
  )
}

/// Table names carrying a `sync_seq`, and the keys their counters use in `sync_sequences`.
internal let syncSeqBoards = "boards"
internal let syncSeqAlerts = "alerts"
internal let syncSeqMinuteBuckets = "telemetry_minute_buckets"
internal let syncSeqAppSettings = "app_settings"
internal let syncSeqBoardSettings = "board_settings"
internal let syncSeqBoardWarnings = "board_warnings"
internal let syncSeqPrivacyZones = "privacy_zones"
internal let syncSeqTuneProfiles = "tune_profiles"
internal let syncSeqFavorites = "favorites"
internal let syncSeqVescFaultOccurrences = "vesc_fault_occurrences"
internal let syncSeqVescFaultCaptures = "vesc_fault_captures"

/// The three tables the `v44_sync_seq` migration gave a `sync_seq`, frozen at the set that existed
/// then. A migration iterates the tables it actually shipped with, never the current
/// [syncSeqTables] — growing that list must not retroactively change an older migration step.
internal let syncSeqTablesV44 = [syncSeqBoards, syncSeqAlerts, syncSeqMinuteBuckets]

/// The six remaining mutable tables, given a `sync_seq` by `v45_sync_seq_remaining` (#281).
internal let syncSeqTablesV45 = [
  syncSeqAppSettings,
  syncSeqBoardSettings,
  syncSeqBoardWarnings,
  syncSeqPrivacyZones,
  syncSeqTuneProfiles,
  syncSeqFavorites,
]

/// The two mutable VESC Fault Evidence tables, given a `sync_seq` by `v48_fault_sync` (#430).
/// `vesc_fault_capture_samples` is deliberately absent: it is append-only on an `AUTOINCREMENT` key.
internal let syncSeqTablesV48 = [syncSeqVescFaultOccurrences, syncSeqVescFaultCaptures]

/// Every table carrying a `sync_seq`. Append-only tables are deliberately absent: they declare
/// `INTEGER PRIMARY KEY AUTOINCREMENT`, which SQLite guarantees monotonic and never reused, so their
/// key already *is* their cursor.
internal let syncSeqTables = syncSeqTablesV44 + syncSeqTablesV45 + syncSeqTablesV48

/// The Sync Cursor counter table. Idempotent, and called both from the migration that introduced it
/// and from the store-level `createTables` seams tests build their schema from — a table whose write
/// path allocates a cursor cannot be created without it.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `SyncSequenceEntity`
internal func createSyncSequencesTable(_ db: Database) throws {
  try db.execute(
    sql: """
      CREATE TABLE IF NOT EXISTS sync_sequences (
        name TEXT NOT NULL PRIMARY KEY,
        last_value INTEGER NOT NULL
      )
      """
  )
}

/// Hands out the next Sync Cursor position for [name].
///
/// The Sync Cursor is the phone's own record of how far it has uploaded and never crosses the wire,
/// which is what lets the upload scan run on a counter instead of a clock: a device clock that steps
/// backwards makes an `updated_at >= watermark` scan skip the write entirely, because the row lands
/// below a cursor the phone already passed. A counter cannot regress.
///
/// Bump-then-read rather than read-then-bump so two writes racing inside the same database can never
/// be handed the same number; both statements run in the caller's transaction. The counter lives in
/// its own table rather than being derived as `MAX(sync_seq) + 1`, which would hand the same number
/// out twice after the highest row is deleted. Seeded on demand because a database created fresh
/// never runs the migration that inserts the row.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `nextSyncSeq`
internal func nextSyncSeq(_ db: Database, _ name: String) throws -> Int64 {
  try db.execute(
    sql: "INSERT OR IGNORE INTO sync_sequences (name, last_value) VALUES (?, 0)",
    arguments: [name]
  )
  try db.execute(
    sql: "UPDATE sync_sequences SET last_value = last_value + 1 WHERE name = ?",
    arguments: [name]
  )
  return try Int64.fetchOne(db, sql: "SELECT last_value FROM sync_sequences WHERE name = ?", arguments: [name]) ?? 0
}

/// The write-time fold behind `updated_at` on `boards` and `alerts`: never below the value already
/// stored, and strictly above it whenever the clock fails to be.
///
/// `+ 1` rather than a plain `max` because the server keeps the stored row unless the incoming stamp
/// is strictly newer — freezing at the old value would satisfy the scan and still lose the edit. Per
/// row, so the inflation is bounded by the rewind and disappears once the wall clock passes it.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `ratchetUpdatedAt`
internal func ratchetUpdatedAt(_ previous: Int64?, _ now: Int64) -> Int64 {
  guard let previous else { return now }
  return max(previous + 1, now)
}

/// Stamps `updated_at` and `sync_seq` on a row that `INSERT OR REPLACE` is about to rewrite.
///
/// Read-modify-write rather than an `ON CONFLICT` fold: `INSERT OR REPLACE` deletes the old row
/// before inserting, so the ratchet has no `excluded`-style handle on the value it replaces.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `upsertBoardSetting`
internal func stampSyncColumns(
  _ db: Database,
  table: String,
  sequence: String,
  whereClause: String,
  keys: StatementArguments,
  now: Int64
) throws -> (updatedAt: Int64, syncSeq: Int64) {
  let previous = try Int64.fetchOne(
    db,
    sql: "SELECT updated_at FROM \(table) WHERE \(whereClause)",
    arguments: keys
  )
  return (ratchetUpdatedAt(previous, now), try nextSyncSeq(db, sequence))
}

/// [now] is the last-write-wins timestamp stamped on the row, ratcheted on conflict exactly as
/// boards and alerts are: the server guards this table with `WHERE stored.updated_at <
/// EXCLUDED.updated_at` like every other mutable table, so a stamp frozen at the stored value would
/// satisfy the scan and still be dropped server-side.
///
/// Completeness is `sync_seq`'s job, and it moves on every write including a merge into a row the
/// scan may already have passed.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `toEntity`
internal func upsertBucket(_ db: Database, _ b: TelemetryBucket, now: Int64 = telemetryNowMs()) throws {
  let syncSeq = try nextSyncSeq(db, syncSeqMinuteBuckets)
  try db.execute(
    sql: """
      INSERT INTO telemetry_minute_buckets (
        bucket_start_ms, board_id, sample_count, first_sample_at_ms, last_sample_at_ms,
        sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh,
        max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma,
        max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, max_duty_abs_permille,
        first_odometer_cm, last_odometer_cm, gps_point_count, precise_gps_point_count,
        gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c, max_temp_motor_deci_c,
        first_latitude_e7, first_longitude_e7, first_moving_at_ms, last_moving_at_ms, updated_at,
        sync_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_start_ms, board_id) DO UPDATE SET
        sample_count=telemetry_minute_buckets.sample_count + excluded.sample_count,
        last_sample_at_ms=MAX(telemetry_minute_buckets.last_sample_at_ms, excluded.last_sample_at_ms),
        sum_abs_speed_centi_kmh=telemetry_minute_buckets.sum_abs_speed_centi_kmh + excluded.sum_abs_speed_centi_kmh,
        moving_speed_sample_count=telemetry_minute_buckets.moving_speed_sample_count + excluded.moving_speed_sample_count,
        sum_moving_abs_speed_centi_kmh=telemetry_minute_buckets.sum_moving_abs_speed_centi_kmh + excluded.sum_moving_abs_speed_centi_kmh,
        max_abs_speed_centi_kmh=MAX(telemetry_minute_buckets.max_abs_speed_centi_kmh, excluded.max_abs_speed_centi_kmh),
        min_battery_voltage_mv=MIN(telemetry_minute_buckets.min_battery_voltage_mv, excluded.min_battery_voltage_mv),
        max_motor_current_abs_ma=MAX(telemetry_minute_buckets.max_motor_current_abs_ma, excluded.max_motor_current_abs_ma),
        max_battery_current_abs_ma=MAX(telemetry_minute_buckets.max_battery_current_abs_ma, excluded.max_battery_current_abs_ma),
        battery_used_wh_milli=telemetry_minute_buckets.battery_used_wh_milli + excluded.battery_used_wh_milli,
        battery_regen_wh_milli=telemetry_minute_buckets.battery_regen_wh_milli + excluded.battery_regen_wh_milli,
        max_duty_abs_permille=MAX(telemetry_minute_buckets.max_duty_abs_permille, excluded.max_duty_abs_permille),
        last_odometer_cm=COALESCE(excluded.last_odometer_cm, telemetry_minute_buckets.last_odometer_cm),
        gps_point_count=telemetry_minute_buckets.gps_point_count + excluded.gps_point_count,
        precise_gps_point_count=telemetry_minute_buckets.precise_gps_point_count + excluded.precise_gps_point_count,
        max_gps_speed_centi_mps=MAX(telemetry_minute_buckets.max_gps_speed_centi_mps, excluded.max_gps_speed_centi_mps),
        max_temp_mosfet_deci_c=MAX(telemetry_minute_buckets.max_temp_mosfet_deci_c, excluded.max_temp_mosfet_deci_c),
        max_temp_motor_deci_c=MAX(telemetry_minute_buckets.max_temp_motor_deci_c, excluded.max_temp_motor_deci_c),
        first_moving_at_ms=MIN(telemetry_minute_buckets.first_moving_at_ms, excluded.first_moving_at_ms),
        last_moving_at_ms=MAX(telemetry_minute_buckets.last_moving_at_ms, excluded.last_moving_at_ms),
        updated_at=MAX(telemetry_minute_buckets.updated_at + 1, excluded.updated_at),
        sync_seq=excluded.sync_seq
      """,
    arguments: [
      b.bucketStartMs, b.boardId, b.sampleCount, b.firstSampleAtMs, b.lastSampleAtMs,
      b.sumAbsSpeedCentiKmh, b.movingSpeedSampleCount, b.sumMovingAbsSpeedCentiKmh, b.maxAbsSpeedCentiKmh,
      b.minBatteryVoltageMv, b.maxMotorCurrentAbsMa, b.maxBatteryCurrentAbsMa, b.batteryUsedWhMilli,
      b.batteryRegenWhMilli, b.maxDutyAbsPermille, b.firstOdometerCm, b.lastOdometerCm,
      b.gpsPointCount, b.preciseGpsPointCount, b.maxGpsSpeedCentiMps, b.maxTempMosfetDeciC,
      b.maxTempMotorDeciC, b.firstLatitudeE7, b.firstLongitudeE7, b.firstMovingAtMs, b.lastMovingAtMs, now,
      syncSeq,
    ]
  )
}

internal func insertMarker(_ db: Database, _ marker: [String: Any?]) throws {
  let occurredAtMs = telemetryLong(marker["occurredAtMs"] ?? nil) ?? telemetryNowMs()
  let elapsedRealtimeMs = telemetryLong(marker["elapsedRealtimeMs"] ?? nil) ?? telemetryElapsedMs()
  let type = marker["type"] as? String ?? "event"
  let boardId = marker["boardId"] as? String
  let message = marker["message"] as? String
  let gapMs = telemetryLong(marker["gapMs"] ?? nil)
  try db.execute(
    sql: "INSERT INTO telemetry_markers (occurred_at_ms, elapsed_realtime_ms, type, board_id, message, gap_ms) VALUES (?, ?, ?, ?, ?, ?)",
    arguments: [occurredAtMs, elapsedRealtimeMs, type, boardId, message, gapMs]
  )
}

internal func insertExclusion(_ db: Database, _ range: MetricExclusionRange) throws {
  try db.execute(
    sql: "INSERT INTO metric_exclusion_ranges (board_id, reason, start_ms, end_ms, sample_count) VALUES (?, ?, ?, ?, ?)",
    arguments: [range.boardId, range.reason, range.startMs, range.endMs, range.sampleCount]
  )
}

/// [boardNames] resolves `boards.id` -> name on read; the row never carried one (ADR 0028).
internal func historyMap(_ row: Row, markers: [Row], boardNames: [String: String]) -> [String: Any?] {
  let sampleCount: Int = row["sample_count"]
  let movingCount: Int? = row["moving_speed_sample_count"]
  let sumMoving: Int64? = row["sum_moving_abs_speed_centi_kmh"]
  let avgSpeed = movingCount.map { $0 > 0 ? Double(sumMoving ?? 0) / Double($0) / 100.0 : 0.0 }
    ?? (sampleCount > 0 ? Double(row["sum_abs_speed_centi_kmh"] as Int64) / Double(sampleCount) / 100.0 : 0.0)
  let marker = markers.last { marker in
    let occurredAtMs = marker["occurred_at_ms"] as Int64
    // An all-Boards read leaves the marker query unscoped, so the bucket has to claim its own.
    let markerBoard = marker["board_id"] as String? ?? ""
    return occurredAtMs >= (row["first_sample_at_ms"] as Int64) - 5_000 &&
      occurredAtMs <= (row["first_sample_at_ms"] as Int64) + 1_000 &&
      markerBoard == (row["board_id"] as String)
  }
  let distanceDeltaM: Double? = {
    guard let first = row["first_odometer_cm"] as Int64?, let last = row["last_odometer_cm"] as Int64? else { return nil }
    return Double(max(0, last - first)) / 100.0
  }()
  return [
    "id": "\(row["board_id"] as String):\(row["bucket_start_ms"] as Int64)",
    "startAtMs": row["first_sample_at_ms"] as Int64,
    "endAtMs": row["last_sample_at_ms"] as Int64,
    "bucketStartMs": row["bucket_start_ms"] as Int64,
    "boardId": (row["board_id"] as String).isEmpty ? nil : row["board_id"] as String,
    "boardName": boardNames[row["board_id"] as String] ?? UNKNOWN_TELEMETRY_BOARD_NAME,
    "sampleCount": sampleCount,
    "gpsPointCount": row["gps_point_count"] as Int,
    "preciseGpsPointCount": row["precise_gps_point_count"] as Int,
    "maxAbsSpeedKmh": Double(row["max_abs_speed_centi_kmh"] as Int) / 100.0,
    "maxGpsSpeedKmh": (row["max_gps_speed_centi_mps"] as Int?).map { Double($0) / 100.0 * 3.6 },
    "avgSpeedKmh": avgSpeed,
    "avgSpeedSampleCount": movingCount ?? sampleCount,
    "minBatteryVoltage": (row["min_battery_voltage_mv"] as Int?).map { Double($0) / 1000.0 },
    "maxMotorCurrent": Double(row["max_motor_current_abs_ma"] as Int) / 1000.0,
    "maxBatteryCurrent": Double(row["max_battery_current_abs_ma"] as Int) / 1000.0,
    "maxDuty": Double(row["max_duty_abs_permille"] as Int) / 1000.0,
    "distanceDeltaM": distanceDeltaM,
    "gpsDistanceM": ((row["gps_distance_cm"] as Int64) > 0) ? Double(row["gps_distance_cm"] as Int64) / 100.0 : nil,
    "maxTempMosfet": (row["max_temp_mosfet_deci_c"] as Int?).map { Double($0) / 10.0 },
    "maxTempMotor": (row["max_temp_motor_deci_c"] as Int?).map { Double($0) / 10.0 },
    "batteryUsedWh": Double(row["battery_used_wh_milli"] as Int64) / 1000.0,
    "batteryRegenWh": Double(row["battery_regen_wh_milli"] as Int64) / 1000.0,
    "firstLatitude": (row["first_latitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 },
    "firstLongitude": (row["first_longitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 },
    "firstMovingAtMs": row["first_moving_at_ms"] as Int64?,
    "lastMovingAtMs": row["last_moving_at_ms"] as Int64?,
    "boundaryBefore": marker?["type"] as String? ?? "none",
    "boundaryMessage": marker?["message"] as String?,
    "gapBeforeMs": marker?["gap_ms"] as Int64?,
  ]
}

internal func sampleMap(_ row: Row, batteryPercent: Double?, boardNames: [String: String]) -> [String: Any?] {
  [
    "id": row["id"] as Int64,
    "capturedAtMs": row["captured_at_ms"] as Int64,
    "boardId": row["board_id"] as String?,
    "boardName": (row["board_id"] as String?).flatMap { boardNames[$0] } ?? UNKNOWN_TELEMETRY_BOARD_NAME,
    "speedKmh": Double(row["speed_centi_kmh"] as Int? ?? 0) / 100.0,
    "batteryVoltage": Double(row["battery_voltage_mv"] as Int? ?? 0) / 1000.0,
    "batteryPercent": batteryPercent,
    "motorCurrent": Double(row["motor_current_ma"] as Int? ?? 0) / 1000.0,
    "batteryCurrent": Double(row["battery_current_ma"] as Int? ?? 0) / 1000.0,
    "dutyCycle": Double(row["duty_permille"] as Int? ?? 0) / 1000.0,
    "pitch": Double(row["pitch_centi_deg"] as Int? ?? 0) / 100.0,
    "roll": Double(row["roll_centi_deg"] as Int? ?? 0) / 100.0,
    "balancePitch": Double(row["balance_pitch_centi_deg"] as Int? ?? 0) / 100.0,
    "balanceCurrent": Double(row["balance_current_ma"] as Int? ?? 0) / 1000.0,
    "erpm": row["erpm"] as Int? ?? 0,
    "state": row["state"] as Int? ?? 0,
    "switchState": row["switch_state"] as Int? ?? 0,
    "adc1": Double(row["adc1_milli"] as Int? ?? 0) / 1000.0,
    "adc2": Double(row["adc2_milli"] as Int? ?? 0) / 1000.0,
    "odometer": (row["odometer_cm"] as Int64?).map { Double($0) / 100.0 },
    "tempMosfet": (row["temp_mosfet_deci_c"] as Int?).map { Double($0) / 10.0 },
    "tempMotor": (row["temp_motor_deci_c"] as Int?).map { Double($0) / 10.0 },
    "latitude": (row["latitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 },
    "longitude": (row["longitude_e7"] as Int64?).map { Double($0) / 10_000_000.0 },
  ]
}

internal func markerMap(_ row: Row) -> [String: Any?] {
  [
    "id": row["id"] as Int64,
    "occurredAtMs": row["occurred_at_ms"] as Int64,
    "type": row["type"] as String,
    "boardId": row["board_id"] as String?,
    "message": row["message"] as String?,
    "gapMs": row["gap_ms"] as Int64?,
  ]
}

internal func exclusionMap(_ row: Row) -> [String: Any?] {
  let reason = row["reason"] as String
  var metrics: [String: Bool] = [:]
  if reason == EXCLUSION_REASON_LOW_SPEED { metrics[METRIC_AVG_SPEED] = true }
  if reason == EXCLUSION_REASON_FREE_SPIN {
    metrics[METRIC_MAX_SPEED] = true
    metrics[METRIC_MAX_DUTY] = true
  }
  return [
    "id": row["id"] as Int64,
    "boardId": row["board_id"] as String,
    "reason": reason,
    "startMs": row["start_ms"] as Int64,
    "endMs": row["end_ms"] as Int64,
    "sampleCount": row["sample_count"] as Int,
    "metrics": metrics,
  ]
}

internal func gpsMaps(_ rows: [Row], boardNames: [String: String]) -> [[String: Any?]] {
  var previousByBoard: [String: (lat: Double, lon: Double)] = [:]
  return rows.compactMap { row in
    guard let latitudeE7 = row["latitude_e7"] as Int64?, let longitudeE7 = row["longitude_e7"] as Int64? else {
      return nil
    }
    let latitude = Double(latitudeE7) / 10_000_000.0
    let longitude = Double(longitudeE7) / 10_000_000.0
    let boardId = row["board_id"] as String? ?? ""
    let previous = previousByBoard[boardId]
    previousByBoard[boardId] = (latitude, longitude)
    return [
      "id": row["id"] as Int64,
      "capturedAtMs": row["captured_at_ms"] as Int64,
      "boardId": (row["board_id"] as String?) ?? nil,
      "boardName": boardNames[boardId] ?? UNKNOWN_TELEMETRY_BOARD_NAME,
      "latitude": latitude,
      "longitude": longitude,
      "speedMps": (row["gps_speed_centi_mps"] as Int?).map { Double($0) / 100.0 },
      "bearingDeg": (row["bearing_centi_deg"] as Int?).map { Double($0) / 100.0 },
      "accuracyM": (row["accuracy_cm"] as Int?).map { Double($0) / 100.0 },
      "altitudeM": (row["altitude_cm"] as Int?).map { Double($0) / 100.0 },
      "timestamp": (row["location_timestamp_ms"] as Int64?) ?? (row["captured_at_ms"] as Int64),
      "precise": ((row["accuracy_cm"] as Int?) ?? Int.max) <= 2_000,
      "distanceFromPreviousM": previous.map { telemetryHaversineM($0.lat, $0.lon, latitude, longitude) },
    ]
  }
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
    tempMotorDeciC: row["temp_motor_deci_c"] as Int?,
    gpsSpeedCentiMps: row["gps_speed_centi_mps"] as Int?,
    gpsTimestampMs: row["location_timestamp_ms"] as Int64?,
    gpsAccuracyCm: row["accuracy_cm"] as Int?,
    latitudeE7: row["latitude_e7"] as Int64?,
    longitudeE7: row["longitude_e7"] as Int64?,
    bearingCentiDeg: row["bearing_centi_deg"] as Int?,
    altitudeCm: row["altitude_cm"] as Int?,
    preciseGps: ((row["accuracy_cm"] as Int?) ?? Int.max) <= 2_000
  )
}

internal func appendNullableDouble(_ data: inout Data, _ value: Double?) {
  appendDouble(&data, value ?? Double.nan)
}

internal func appendDouble(_ data: inout Data, _ value: Double) {
  var bits = value.bitPattern.littleEndian
  withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
}

internal func telemetryHaversineM(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
  let radius = 6_371_000.0
  let dLat = (lat2 - lat1) * .pi / 180.0
  let dLon = (lon2 - lon1) * .pi / 180.0
  let a = sin(dLat / 2) * sin(dLat / 2) +
    cos(lat1 * .pi / 180.0) * cos(lat2 * .pi / 180.0) *
    sin(dLon / 2) * sin(dLon / 2)
  return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
}

internal func mergeTelemetryPayload(_ lhs: [String: Any?], _ rhs: [String: Any?]) -> [String: Any?] {
  lhs.merging(rhs) { _, new in new }
}

internal func telemetryCenti(_ value: Double) -> Int { Int((value * 100.0).rounded()) }
internal func telemetryMilli(_ value: Double) -> Int { Int((value * 1000.0).rounded()) }
internal func telemetryDeci(_ value: Double) -> Int { Int((value * 10.0).rounded()) }
internal func telemetryMaxOptional(_ lhs: Int?, _ rhs: Int?) -> Int? {
  guard let rhs else { return lhs }
  return max(lhs ?? rhs, rhs)
}
internal func telemetryNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }
internal func telemetryElapsedMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000.0) }
internal func telemetryInt(_ raw: Any?) -> Int? {
  if let value = raw as? Int { return value }
  if let value = raw as? NSNumber { return value.intValue }
  return nil
}
internal func telemetryLong(_ raw: Any?) -> Int64? {
  if let value = raw as? Int64 { return value }
  if let value = raw as? Int { return Int64(value) }
  if let value = raw as? NSNumber { return value.int64Value }
  return nil
}
