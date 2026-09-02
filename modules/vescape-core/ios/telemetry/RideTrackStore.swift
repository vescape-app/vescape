import Foundation
import GRDB

/// One **Ride Recording**: durable identity and explicit start/end boundaries for a capture, held
/// apart from the Board that produced it (ADR 0038).
///
/// `boardId` stays Board attribution — it says *which Board*, never *which recording*. Two
/// recordings of one Board minutes (or seconds) apart are two rows here, which is what keeps their
/// frames, track and minute buckets from being merged on read.
///
/// `endedAtMs` is nil while the recording is open. Only an explicit rider Stop Recording or
/// Disconnect closes it: an unexpected drop, an Idle Pause, a process restart or an hour of silence
/// in both streams leave it open.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `RideRecordingEntity`
internal struct RideRecording {
  let id: String
  /// Owning Board (`boards.id`), or nil when the recording matched no saved Board.
  let boardId: String?
  let startedAtMs: Int64
  var endedAtMs: Int64?
  var endedReason: String?
}

/// Rider stopped recording explicitly.
internal let RIDE_RECORDING_END_STOPPED = "stopped"
/// Rider disconnected the Board explicitly.
internal let RIDE_RECORDING_END_DISCONNECTED = "disconnected"
/// An explicit connection attempt to another Board ended this one, however that attempt turned out.
internal let RIDE_RECORDING_END_BOARD_CHANGE = "board_change"

/// Stand-in Ride Recording id for minute buckets aggregated from rows without durable recording
/// identity. `recording_id` is part of the bucket primary key, so legacy rows need a value.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `LEGACY_RIDE_RECORDING_ID`
internal let LEGACY_RIDE_RECORDING_ID = ""

/// One point of a **Ride Track**: a single GPS Fix recorded during a Ride Recording, on the GPS
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
  /// Owning Ride Recording, or nil for points migrated out of `telemetry_frames`, which predate
  /// durable recording identity and keep their legacy gap-based grouping.
  let recordingId: String?
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `insertRideRecording`
internal func insertRideRecording(_ db: Database, _ recording: RideRecording) throws {
  try db.execute(
    sql: """
      INSERT INTO ride_recordings (id, board_id, started_at_ms, ended_at_ms, ended_reason)
      VALUES (?, ?, ?, ?, ?)
      """,
    arguments: [
      recording.id, recording.boardId, recording.startedAtMs, recording.endedAtMs,
      recording.endedReason,
    ]
  )
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `endRideRecording`
internal func closeRideRecordingRow(_ db: Database, id: String, endedAtMs: Int64, reason: String) throws {
  try db.execute(
    sql: """
      UPDATE ride_recordings SET ended_at_ms = ?, ended_reason = ?
      WHERE id = ? AND ended_at_ms IS NULL
      """,
    arguments: [endedAtMs, reason, id]
  )
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `insertRideTrackPoints`
internal func insertRideTrackPoint(_ db: Database, _ point: RideTrackPoint) throws {
  try db.execute(
    sql: """
      INSERT INTO ride_track_points (
        recording_id, board_id, fix_at_ms, latitude_e7, longitude_e7,
        accuracy_cm, gps_speed_centi_mps, bearing_centi_deg, altitude_cm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
    arguments: [
      point.recordingId, point.boardId, point.fixAtMs, point.latitudeE7, point.longitudeE7,
      point.accuracyCm, point.gpsSpeedCentiMps, point.bearingCentiDeg, point.altitudeCm,
    ]
  )
}

/// The Ride Track over a time range, on the GPS clock. Every stored fix is returned with the
/// accuracy it was reported with — filtering poor fixes is a read-side decision the caller makes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getRideTrackPoints`
internal func fetchRideTrack(
  _ db: Database,
  fromMs: Int64,
  toMs: Int64,
  boardId: String?
) throws -> [Row] {
  try Row.fetchAll(
    db,
    sql: """
      SELECT * FROM ride_track_points
      WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND (? IS NULL OR board_id = ?)
      ORDER BY fix_at_ms ASC
      """,
    arguments: [fromMs, toMs, boardId, boardId]
  )
}

/// Drop closed recordings no row references any more. Identity outlives its rows only as long as
/// something can still be attributed to it, and an open recording is never pruned.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `pruneOrphanRideRecordings`
internal func pruneOrphanRideRecordings(_ db: Database) throws {
  try db.execute(
    sql: """
      DELETE FROM ride_recordings
      WHERE ended_at_ms IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ride_track_points p WHERE p.recording_id = ride_recordings.id)
        AND NOT EXISTS (SELECT 1 FROM telemetry_frames f WHERE f.recording_id = ride_recordings.id)
        AND NOT EXISTS (
          SELECT 1 FROM telemetry_minute_buckets b WHERE b.recording_id = ride_recordings.id
        )
      """
  )
}
