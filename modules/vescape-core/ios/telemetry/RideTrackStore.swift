import Foundation
import GRDB

internal let MAX_SAMPLE_LIMIT = 20_000

/// One point of a **Ride Track**: a single GPS Fix recorded while recording, on the GPS
/// clock (ADR 0038).
///
/// Every admitted fix is stored with the accuracy the platform reported, poor ones included — the
/// precision rule is a read-side decision, and a write-time discard is unrecoverable. The two gates
/// that do drop a fix are the Ride Recording state (Idle Pause halts both streams) and Privacy Zones
/// (ADR 0009), which must filter this stream on its own now that position no longer rides along on a
/// suppressed Telemetry Sample.
///
/// `fixAtMs` is the GPS clock, deliberately not aligned to any telemetry frame's capture time.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `RideTrackPointEntity`
internal struct RideTrackPoint {
  /// Owning Board (`boards.id`), or nil when the fix matched no saved Board (ADR 0028).
  let boardId: String?
  let fixAtMs: Int64
  let latitudeE7: Int64
  let longitudeE7: Int64
  /// Reported horizontal accuracy. Stored as reported; never a filter at write time.
  let accuracyCm: Int?
  let gpsSpeedCentiMps: Int?
  /// Raw platform bearing, not the derived course.
  let bearingCentiDeg: Int?
  let altitudeCm: Int?
}

// MARK: - Storage

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `insertRideTrackPoints`
internal func insertRideTrackPoint(_ db: Database, _ point: RideTrackPoint) throws {
  try db.execute(
    sql: """
      INSERT INTO ride_track_points (
        board_id, fix_at_ms, latitude_e7, longitude_e7,
        accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      """,
    arguments: [
      point.boardId, point.fixAtMs, point.latitudeE7, point.longitudeE7,
      point.accuracyCm, point.gpsSpeedCentiMps, point.bearingCentiDeg, point.altitudeCm,
    ]
  )
}

/// The Ride Track over a time range, on the GPS clock. Every stored fix is returned with the
/// accuracy it was reported with — filtering poor fixes is a read-side decision the caller makes.
/// [limit] is the same read cap the Telemetry Sample reads carry: a wide range must not pull an
/// unbounded track into memory and across the bridge.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideTrackPoints`
internal func fetchRideTrack(
  _ db: Database,
  fromMs: Int64,
  toMs: Int64,
  boardId: String?,
  limit: Int = MAX_SAMPLE_LIMIT
) throws -> [Row] {
  try fetchRideTrackRows(db, fromMs: fromMs, toMs: toMs, boardId: boardId, limit: limit)
}

/// Complete input for durable summaries and bucket rebuilds, without the bridge read cap.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideTrackForAggregation`
internal func fetchRideTrackForAggregation(
  _ db: Database,
  fromMs: Int64,
  toMs: Int64,
  boardId: String?
) throws -> [Row] {
  try fetchRideTrackRows(db, fromMs: fromMs, toMs: toMs, boardId: boardId, limit: nil)
}

private func fetchRideTrackRows(
  _ db: Database,
  fromMs: Int64,
  toMs: Int64,
  boardId: String?,
  limit: Int?
) throws -> [Row] {
  var sql = """
    SELECT * FROM ride_track_points
    WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND (? IS NULL OR board_id = ?)
    ORDER BY fix_at_ms ASC
    """
  var arguments: StatementArguments = [fromMs, toMs, boardId, boardId]
  if let limit {
    sql += " LIMIT ?"
    arguments += [limit]
  }
  return try Row.fetchAll(db, sql: sql, arguments: arguments)
}
