import Foundation
import GRDB

/// Local rows as the server reads them.
///
/// Every encoder validates before transport, so a batch is refused here — with the row retained and
/// one metadata-only Diagnostic Event — rather than wedging against the server. The field sets
/// mirror `vescape-server` `src/sync/protocol.ts`; a column the server does not declare is not sent,
/// because an unknown field rejects the whole batch.
///
/// Rows arrive as GRDB rows rather than typed structs: the iOS side stores telemetry in raw SQL, and
/// re-modelling fifteen tables here would add a second schema to keep in step with the first.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncWire.kt
/// @parity /modules/vescape-server/src/sync/protocol.ts
enum SyncWire {
  static func encode(_ table: SyncTable, _ row: Row) throws -> String {
    switch table {
    case .appSettings: return try appSetting(row)
    case .boards: return try board(row)
    case .boardSettings: return try boardSetting(row)
    case .boardWarnings: return try boardWarning(row)
    case .alerts: return try alert(row)
    case .tuneProfiles: return try tuneProfile(row)
    case .tuneHistoryEntries: return try tuneHistoryEntry(row)
    case .privacyZones: return try privacyZone(row)
    case .telemetryMarkers: return try telemetryMarker(row)
    case .metricExclusionRanges: return try metricExclusionRange(row)
    case .diagnosticEvents: return try diagnosticEvent(row)
    case .telemetryFrames: return try telemetryFrame(row)
    case .telemetryMinuteBuckets: return try telemetryMinuteBucket(row)
    case .favorites: return try favorite(row)
    case .deleteActions: return try deleteAction(row)
    }
  }

  static func appSetting(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.appSettings)
    try writer.keyText("key", text(row, "key"))
    writer.text("valueJson", row["value_json"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  /// `transport` is the one column only iOS stores on the Board itself — Android keeps it in board
  /// settings and sends null there. The server declares the field for exactly this reason, so a
  /// restored iPhone keeps the Board Link's selected transport instead of re-probing for it.
  /// @platform-diff Android has no `boards.transport` column and sends null.
  static func board(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.boards)
    try writer.keyText("id", text(row, "id"))
    writer.text("name", row["name"])
    writer.text("bleId", row["ble_id"])
    writer.text("transport", row["transport"])
    try writer.timestamp("createdAt", row["created_at"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  static func boardSetting(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.boardSettings)
    try writer.keyText("boardId", text(row, "board_id"))
    try writer.keyText("key", text(row, "key"))
    writer.text("valueJson", row["value_json"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  static func boardWarning(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.boardWarnings)
    try writer.keyText("boardId", text(row, "board_id"))
    try writer.keyText("kind", text(row, "kind"))
    writer.text("severity", row["severity"])
    try writer.timestamp("firstDetectedAt", row["first_detected_at"])
    try writer.timestamp("lastDetectedAt", row["last_detected_at"])
    writer.text("payloadJson", row["payload_json"])
    return writer.build()
  }

  static func alert(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.alerts)
    try writer.keyText("boardId", text(row, "board_id"))
    try writer.keyText("id", text(row, "id"))
    try writer.keyText("controlId", text(row, "control_id"))
    try writer.number("threshold", row["threshold"])
    try writer.number("thresholdMax", row["threshold_max"])
    writer.bool("enabled", (row["enabled"] as Int64? ?? 0) != 0)
    writer.text("soundType", row["sound_type"])
    writer.text("source", row["source"])
    try writer.timestamp("createdAt", row["created_at"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  static func tuneProfile(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.tuneProfiles)
    try writer.keyText("id", text(row, "id"))
    try writer.keyText("boardId", text(row, "board_id"))
    // May legitimately be empty: the app defaults an unknown Refloat package version to `''`.
    try writer.derivedKeyText("refloatBaseVersion", row["refloat_base_version"])
    writer.text("name", row["name"])
    writer.text("icon", row["icon"])
    writer.text("color", row["color"])
    writer.text("fieldsJson", row["fields_json"])
    try writer.timestamp("createdAt", row["created_at"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  /// Carries no id: the local one restarts on a fresh install, so identity is `(profileId, createdAt)`.
  static func tuneHistoryEntry(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.tuneHistoryEntries)
    try writer.keyText("profileId", text(row, "profile_id"))
    writer.text("fieldsJson", row["fields_json"])
    try writer.timestamp("createdAt", row["created_at"])
    return writer.build()
  }

  static func privacyZone(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.privacyZones)
    try writer.keyText("id", text(row, "id"))
    writer.text("preset", row["preset"])
    writer.text("name", row["name"])
    writer.bool("enabled", (row["enabled"] as Int64? ?? 0) != 0)
    try writer.int32("centerLatitudeE7", row["center_latitude_e7"])
    try writer.int32("centerLongitudeE7", row["center_longitude_e7"])
    try writer.int32("radiusMeters", row["radius_meters"])
    try writer.timestamp("createdAt", row["created_at"])
    try writer.timestamp("updatedAt", row["updated_at"])
    return writer.build()
  }

  static func telemetryMarker(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.telemetryMarkers)
    try writer.timestamp("occurredAtMs", row["occurred_at_ms"])
    try writer.timestamp("elapsedRealtimeMs", row["elapsed_realtime_ms"])
    try writer.keyText("type", text(row, "type"))
    try writer.derivedKeyText("boardId", row["board_id"])
    writer.text("message", row["message"])
    try writer.timestamp("gapMs", row["gap_ms"])
    return writer.build()
  }

  static func metricExclusionRange(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.metricExclusionRanges)
    try writer.derivedKeyText("boardId", row["board_id"])
    writer.text("reason", row["reason"])
    try writer.timestamp("startMs", row["start_ms"])
    try writer.timestamp("endMs", row["end_ms"])
    try writer.count("sampleCount", row["sample_count"])
    return writer.build()
  }

  static func diagnosticEvent(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.diagnosticEvents)
    try writer.timestamp("occurredAtMs", row["occurred_at_ms"])
    try writer.timestamp("elapsedRealtimeMs", row["elapsed_realtime_ms"])
    try writer.keyText("eventName", text(row, "event_name"))
    try writer.derivedKeyText("operation", row["operation"])
    try writer.derivedKeyText("phase", row["phase"])
    try writer.derivedKeyText("boardId", row["board_id"])
    writer.text("message", row["message"])
    writer.text("propertiesJson", row["properties_json"])
    return writer.build()
  }

  /// A Telemetry Sample as recorded: still delta-encoded, carrying the Changed Masks. The local row
  /// id and the per-row device columns never cross the wire — the Board reference replaces them
  /// (ADR-0028) and a restored phone's full re-upload has to be an idempotent no-op.
  ///
  /// A frame that names no Board cannot be encoded; the scan never offers one.
  static func telemetryFrame(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.telemetryFrames)
    guard let boardId: String = row["board_id"] else {
      throw SyncProtocolError(table: .telemetryFrames, field: "boardId", problem: "must name a Board")
    }
    try writer.keyText("boardId", boardId)
    try writer.timestamp("capturedAtMs", row["captured_at_ms"])
    try writer.timestamp("elapsedRealtimeMs", row["elapsed_realtime_ms"])
    try writer.int32("canId", row["can_id"])
    try writer.count("flags", row["flags"])
    try writer.count("changedMask1", row["changed_mask_1"])
    try writer.count("changedMask2", row["changed_mask_2"])
    try writer.int32("speedCentiKmh", row["speed_centi_kmh"])
    try writer.int32("batteryVoltageMv", row["battery_voltage_mv"])
    try writer.int32("motorCurrentMa", row["motor_current_ma"])
    try writer.int32("batteryCurrentMa", row["battery_current_ma"])
    try writer.int32("dutyPermille", row["duty_permille"])
    try writer.int32("pitchCentiDeg", row["pitch_centi_deg"])
    try writer.int32("rollCentiDeg", row["roll_centi_deg"])
    try writer.int32("balancePitchCentiDeg", row["balance_pitch_centi_deg"])
    try writer.int32("balanceCurrentMa", row["balance_current_ma"])
    try writer.int32("erpm", row["erpm"])
    try writer.int32("state", row["state"])
    try writer.int32("switchState", row["switch_state"])
    try writer.int32("adc1Milli", row["adc1_milli"])
    try writer.int32("adc2Milli", row["adc2_milli"])
    try writer.int64("odometerCm", row["odometer_cm"])
    try writer.int32("tempMosfetDeciC", row["temp_mosfet_deci_c"])
    try writer.int32("tempMotorDeciC", row["temp_motor_deci_c"])
    // The server still declares the field, but a Telemetry Sample stopped carrying a fault code
    // when VESC faults became Board-owned evidence in their own tables (ADR-0037). Those tables
    // are not in SyncTable yet, so the honest value is an explicit null.
    try writer.int32("faultCode", nil)
    try writer.int32("latitudeE7", row["latitude_e7"])
    try writer.int32("longitudeE7", row["longitude_e7"])
    try writer.int32("gpsSpeedCentiMps", row["gps_speed_centi_mps"])
    try writer.int32("bearingCentiDeg", row["bearing_centi_deg"])
    try writer.int32("accuracyCm", row["accuracy_cm"])
    try writer.int32("altitudeCm", row["altitude_cm"])
    try writer.timestamp("locationTimestampMs", row["location_timestamp_ms"])
    return writer.build()
  }

  static func telemetryMinuteBucket(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.telemetryMinuteBuckets)
    try writer.keyText("boardId", text(row, "board_id"))
    try writer.timestamp("bucketStartMs", row["bucket_start_ms"])
    try writer.timestamp("updatedAt", row["updated_at"])
    try writer.count("sampleCount", row["sample_count"])
    try writer.timestamp("firstSampleAtMs", row["first_sample_at_ms"])
    try writer.timestamp("lastSampleAtMs", row["last_sample_at_ms"])
    try writer.int64("sumAbsSpeedCentiKmh", row["sum_abs_speed_centi_kmh"])
    try writer.count("movingSpeedSampleCount", row["moving_speed_sample_count"])
    try writer.int64("sumMovingAbsSpeedCentiKmh", row["sum_moving_abs_speed_centi_kmh"])
    try writer.int32("maxAbsSpeedCentiKmh", row["max_abs_speed_centi_kmh"])
    try writer.int32("minBatteryVoltageMv", row["min_battery_voltage_mv"])
    try writer.int32("maxMotorCurrentAbsMa", row["max_motor_current_abs_ma"])
    try writer.int32("maxBatteryCurrentAbsMa", row["max_battery_current_abs_ma"])
    try writer.int64("batteryUsedWhMilli", row["battery_used_wh_milli"])
    try writer.int64("batteryRegenWhMilli", row["battery_regen_wh_milli"])
    try writer.int32("maxDutyAbsPermille", row["max_duty_abs_permille"])
    // A minute bucket stopped counting faults when VESC faults became Board-owned evidence in their
    // own tables (ADR-0037), so zero is the truthful count under the new model. Not null: the
    // server declares this one non-nullable inside a strict schema it validates whole, so a null
    // here refuses the entire Sync Batch, not the field.
    try writer.count("faultCount", 0)
    try writer.int64("firstOdometerCm", row["first_odometer_cm"])
    try writer.int64("lastOdometerCm", row["last_odometer_cm"])
    try writer.count("gpsPointCount", row["gps_point_count"])
    try writer.count("preciseGpsPointCount", row["precise_gps_point_count"])
    try writer.int64("gpsDistanceCm", row["gps_distance_cm"])
    try writer.int32("maxGpsSpeedCentiMps", row["max_gps_speed_centi_mps"])
    try writer.int32("maxTempMosfetDeciC", row["max_temp_mosfet_deci_c"])
    try writer.int32("maxTempMotorDeciC", row["max_temp_motor_deci_c"])
    try writer.int32("firstLatitudeE7", row["first_latitude_e7"])
    try writer.int32("firstLongitudeE7", row["first_longitude_e7"])
    try writer.timestamp("firstMovingAtMs", row["first_moving_at_ms"])
    try writer.timestamp("lastMovingAtMs", row["last_moving_at_ms"])
    return writer.build()
  }

  /// The Board name is resolved on read rather than snapshotted, so none crosses the wire.
  static func favorite(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.favorites)
    try writer.keyText("id", text(row, "id"))
    try writer.nullableKeyText("boardId", row["board_id"])
    writer.text("name", row["name"])
    try writer.timestamp("startMs", row["start_ms"])
    try writer.timestamp("endMs", row["end_ms"])
    try writer.timestamp("createdAt", row["created_at"])
    try writer.timestamp("updatedAt", row["updated_at"])
    try writer.count("sampleCount", row["sample_count"])
    try writer.count("gpsPointCount", row["gps_point_count"])
    try writer.int64("distanceCm", row["distance_cm"])
    try writer.timestamp("movingDurationMs", row["moving_duration_ms"])
    try writer.int32("avgSpeedCentiKmh", row["avg_speed_centi_kmh"])
    try writer.int32("maxSpeedCentiKmh", row["max_speed_centi_kmh"])
    try writer.int64("batteryUsedWhMilli", row["battery_used_wh_milli"])
    return writer.build()
  }

  /// One Sync Action, flat: the target, the identity within that target's scope, and when the Rider
  /// removed it. The log's own `board_id`/`key` pair expands into the identity fields the server
  /// declares for that target, so an action reads like the row it names.
  static func deleteAction(_ row: Row) throws -> String {
    let writer = SyncRowWriter(.deleteActions)
    let target = text(row, "target")
    let key = text(row, "key")
    try writer.keyText("target", target)
    switch target {
    case "appSetting": try writer.keyText("key", key)
    case "board": try writer.keyText("id", key)
    case "boardSetting":
      try writer.keyText("boardId", try board(row, target: target))
      try writer.keyText("key", key)
    case "boardWarning":
      try writer.keyText("boardId", try board(row, target: target))
      try writer.keyText("kind", key)
    case "alert":
      try writer.keyText("boardId", try board(row, target: target))
      try writer.keyText("id", key)
    case "tuneProfile", "privacyZone", "favorite": try writer.keyText("id", key)
    default:
      throw SyncProtocolError(table: .deleteActions, field: "target", problem: "is not a known target")
    }
    try writer.timestamp("deletedAt", row["deleted_at"])
    return writer.build()
  }

  private static func board(_ row: Row, target: String) throws -> String {
    guard let boardId: String = row["board_id"] else {
      throw SyncProtocolError(table: .deleteActions, field: "boardId", problem: "is missing for \(target)")
    }
    return boardId
  }

  private static func text(_ row: Row, _ column: String) -> String {
    (row[column] as String?) ?? ""
  }
}
