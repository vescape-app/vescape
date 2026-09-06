import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
internal func insertFrame(_ db: Database, _ state: FullTelemetryState) throws {
  try TelemetryFrameRecord(state: state).insert(db)
}

private struct TelemetryFrameRecord: PersistableRecord {
  static let databaseTableName = "telemetry_frames"
  let state: FullTelemetryState
  func encode(to row: inout PersistenceContainer) {
    let t = state.t
    let loc = state.location
    row["captured_at_ms"] = state.capturedAtMs; row["elapsed_realtime_ms"] = state.elapsedRealtimeMs
    row["board_id"] = state.boardId; row["can_id"] = state.capture.canId
    row["flags"] = TELEMETRY_FLAG_KEYFRAME | (loc == nil ? 0 : TELEMETRY_FLAG_HAS_LOCATION)
    row["changed_mask_1"] = Int.max; row["changed_mask_2"] = 1
    row["speed_centi_kmh"] = telemetryCenti(t.speed); row["battery_voltage_mv"] = telemetryMilli(t.batteryVoltage)
    row["motor_current_ma"] = telemetryMilli(t.motorCurrent); row["battery_current_ma"] = telemetryMilli(t.batteryCurrent)
    row["duty_permille"] = telemetryMilli(t.dutyCycle); row["pitch_centi_deg"] = telemetryCenti(t.pitch)
    row["roll_centi_deg"] = telemetryCenti(t.roll); row["balance_pitch_centi_deg"] = telemetryCenti(t.balancePitch)
    row["balance_current_ma"] = telemetryMilli(t.balanceCurrent); row["erpm"] = t.erpm
    row["state"] = t.state; row["switch_state"] = t.switchState
    row["adc1_milli"] = telemetryMilli(t.adc1); row["adc2_milli"] = telemetryMilli(t.adc2)
    row["odometer_cm"] = t.odometer.map { Int64(($0 * 100.0).rounded()) }
    row["temp_mosfet_deci_c"] = t.tempMosfet.map { telemetryDeci($0) }; row["temp_motor_deci_c"] = t.tempMotor.map { telemetryDeci($0) }
    row["latitude_e7"] = loc.map { Int64(($0.latitude * 10_000_000.0).rounded()) }
    row["longitude_e7"] = loc.map { Int64(($0.longitude * 10_000_000.0).rounded()) }
    row["gps_speed_centi_mps"] = loc?.speedMps.map { telemetryCenti($0) }; row["bearing_centi_deg"] = loc?.bearingDeg.map { telemetryCenti($0) }
    row["accuracy_cm"] = loc?.accuracyM.map { telemetryCenti($0) }; row["altitude_cm"] = loc?.altitudeM.map { telemetryCenti($0) }
    row["location_timestamp_ms"] = loc?.timestamp
  }
}

internal func upsertBucket(_ db: Database, _ b: TelemetryBucket) throws {
  try db.execute(
    sql: RecordingPersistenceSQL.upsertBucket,
    arguments: RecordingPersistenceSQL.bucketArguments(b)
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
