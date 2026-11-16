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
/// Stored rows reference the Board by its local `boards.key`; everything outside this file's SQL
/// speaks the Board UUID (ADR 0028).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `RideTrackPoint`
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

/// Ride Track rows with the stored Board key joined back to its UUID as `board_id`, so nothing
/// outside this SQL sees `board_key`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `RIDE_TRACK_SELECT`
internal let RIDE_TRACK_SELECT = """
  SELECT t.id, b.id AS board_id, t.fix_at_ms, t.latitude_e7, t.longitude_e7, t.accuracy_cm,
    t.gps_speed_centi_mps, t.bearing_centi_deg, t.altitude_cm
  FROM ride_track_points t LEFT JOIN boards b ON b.key = t.board_key

  """

/// The `board_key` a nullable Board UUID filter means: NULL for the unowned track, the Board's key,
/// or -1 (no row) for a UUID with no Board. Binds the UUID twice; compare with `IS`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `BOARD_KEY_OF_BOARD_ID`
internal let BOARD_KEY_OF_BOARD_ID = "(CASE WHEN ? IS NULL THEN NULL ELSE IFNULL((SELECT key FROM boards WHERE id = ?), -1) END)"

/// The key of Board `boardId`, minting a tombstoned Board first when no row exists (the v55 orphan
/// rule), so stored data never loses its owner. Runs inside the caller's transaction.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `resolveBoardKey`
internal func resolveBoardKey(_ db: Database, _ boardId: String) throws -> Int64 {
  let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
  try db.execute(
    sql: "INSERT OR IGNORE INTO boards (id, name, ble_id, created_at, deleted_at) VALUES (?, ?, NULL, ?, ?)",
    arguments: [boardId, UNKNOWN_TELEMETRY_BOARD_NAME, nowMs, nowMs]
  )
  return try Int64.fetchOne(db, sql: "SELECT key FROM boards WHERE id = ?", arguments: [boardId])!
}

/// Stores a fix against its Board's key. A UUID with no Board row gets a minted tombstoned Board
/// first, the same rule v55 applied to orphans, so the key always resolves and the fix keeps its owner.
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

/// The Ride Track over a time range, on the GPS clock. Every stored fix is returned with the
/// accuracy it was reported with — filtering poor fixes is a read-side decision the caller makes.
/// [limit] is the same read cap the Telemetry Sample reads carry: a wide range must not pull an
/// unbounded track into memory and across the bridge.
///
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

/// Complete input for durable summaries and bucket rebuilds, without the bridge read cap.
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
