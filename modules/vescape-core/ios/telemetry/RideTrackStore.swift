import Foundation
import GRDB

internal let MAX_SAMPLE_LIMIT = 20_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `RideTrackPoint`
internal struct RideTrackPoint {
  let boardId: String?
  let fixAtMs: Int64
  let latitudeE7: Int64
  let longitudeE7: Int64
  let accuracyCm: Int?
  let gpsSpeedCentiMps: Int?
  let bearingCentiDeg: Int?
  let altitudeCm: Int?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `RIDE_TRACK_SELECT`
internal let RIDE_TRACK_SELECT = """
  SELECT t.id, b.id AS board_id, t.fix_at_ms, t.latitude_e7, t.longitude_e7, t.accuracy_cm,
    t.gps_speed_centi_mps, t.bearing_centi_deg, t.altitude_cm
  FROM ride_track_points t LEFT JOIN boards b ON b.key = t.board_key

  """

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `BOARD_KEY_OF_BOARD_ID`
internal let BOARD_KEY_OF_BOARD_ID = "(CASE WHEN ? IS NULL THEN NULL ELSE IFNULL((SELECT key FROM boards WHERE id = ?), -1) END)"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `resolveBoardKey`
internal func resolveBoardKey(_ db: Database, _ boardId: String) throws -> Int64 {
  let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
  try db.execute(
    sql: "INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at) VALUES (?, ?, NULL, ?, ?)",
    arguments: [boardId, UNKNOWN_TELEMETRY_BOARD_NAME, nowMs, nowMs]
  )
  return try Int64.fetchOne(db, sql: "SELECT key FROM boards WHERE id = ?", arguments: [boardId])!
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `insertRideTrackPoints`
internal func insertRideTrackPoint(_ db: Database, _ point: RideTrackPoint) throws {
  if let boardId = point.boardId { _ = try resolveBoardKey(db, boardId) }
  try db.execute(
    sql: """
      INSERT INTO ride_track_points (
        board_key, fix_at_ms, latitude_e7, longitude_e7,
        accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm
      ) VALUES ((SELECT key FROM boards WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
      """,
    arguments: [
      point.boardId, point.fixAtMs, point.latitudeE7, point.longitudeE7,
      point.accuracyCm, point.gpsSpeedCentiMps, point.bearingCentiDeg, point.altitudeCm,
    ]
  )
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getRideTrackPoints`
internal func fetchRideTrack(
  _ db: Database,
  fromMs: Int64,
  toMs: Int64,
  boardId: String?,
  limit: Int = MAX_SAMPLE_LIMIT
) throws -> [Row] {
  try fetchRideTrackRows(db, fromMs: fromMs, toMs: toMs, boardId: boardId, limit: limit)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getRideTrackForAggregation`
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
  var sql = RIDE_TRACK_SELECT + """
    WHERE t.fix_at_ms >= ? AND t.fix_at_ms <= ? AND (? IS NULL OR t.board_key = \(BOARD_KEY_OF_BOARD_ID))
    ORDER BY t.fix_at_ms ASC
    """
  var arguments: StatementArguments = [fromMs, toMs, boardId, boardId, boardId]
  if let limit {
    sql += " LIMIT ?"
    arguments += [limit]
  }
  return try Row.fetchAll(db, sql: sql, arguments: arguments)
}
