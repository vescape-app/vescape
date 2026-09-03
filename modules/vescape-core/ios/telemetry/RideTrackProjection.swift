import Foundation
import GRDB

/// Reported horizontal accuracy a Ride Track fix must beat to count as a route point or as GPS
/// movement evidence. Read-side, deliberately: every fix is stored with the accuracy the platform
/// reported, and this is the one rule that decides what those numbers are good enough for
/// (ADR 0038). It does not change live GPS classification.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `RIDE_TRACK_PRECISE_ACCURACY_CM`
internal let rideTrackPreciseAccuracyCm = Int(MAX_RECORDING_ACCURACY_M * 100.0)

/// A fix with no reported accuracy is precise only when it predates durable recording identity.
/// Legacy rows were persisted through the old write-time `precise && freshEnoughToRecord` gate, so
/// a migrated row without `accuracy_cm` was stored *because* it was precise — reading it as
/// imprecise would silently strip route quality the ride actually had. A live fix carries whatever
/// the platform reported, so a missing accuracy there is genuinely unknown and does not count.
internal func rideTrackFixIsPrecise(accuracyCm: Int?, recordingId: String?) -> Bool {
  guard let accuracyCm else { return recordingId == nil }
  return accuracyCm <= rideTrackPreciseAccuracyCm
}

/// The Ride Track as JS reads it. Distance is measured only between two fixes of the same Ride
/// Recording **and the same Board** — a new recording never continues the previous one's geometry,
/// and legacy rows (which all share a nil recording) never chain across Boards.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toGpsSampleMaps`
internal func rideTrackGpsMaps(_ rows: [Row], boardNames: [String: String]) -> [[String: Any?]] {
  var previousByBoard: [String: (recordingId: String?, lat: Double, lon: Double)] = [:]
  return rows.map { row in
    let latitude = Double(row["latitude_e7"] as Int64) / 10_000_000.0
    let longitude = Double(row["longitude_e7"] as Int64) / 10_000_000.0
    let recordingId = row["recording_id"] as String?
    let boardId = row["board_id"] as String?
    let accuracyCm = row["accuracy_cm"] as Int?
    let boardKey = boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let step = previousByBoard[boardKey].flatMap { previous -> Double? in
      guard previous.recordingId == recordingId else { return nil }
      return telemetryHaversineM(previous.lat, previous.lon, latitude, longitude)
    }
    previousByBoard[boardKey] = (recordingId, latitude, longitude)
    return [
      "id": row["id"] as Int64,
      "capturedAtMs": row["fix_at_ms"] as Int64,
      "boardId": boardId,
      "boardName": boardId.flatMap { boardNames[$0] } ?? UNKNOWN_TELEMETRY_BOARD_NAME,
      "latitude": latitude,
      "longitude": longitude,
      "speedMps": (row["gps_speed_centi_mps"] as Int?).map { Double($0) / 100.0 },
      "bearingDeg": (row["bearing_centi_deg"] as Int?).map { Double($0) / 100.0 },
      "accuracyM": accuracyCm.map { Double($0) / 100.0 },
      "altitudeM": (row["altitude_cm"] as Int?).map { Double($0) / 100.0 },
      "timestamp": row["fix_at_ms"] as Int64,
      "precise": rideTrackFixIsPrecise(accuracyCm: accuracyCm, recordingId: recordingId),
      "distanceFromPreviousM": step,
    ]
  }
}

/// The same projection, as the minute-bucket location contribution.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toBucketLocationPoints`
internal func rideTrackBucketPoints(
  _ points: [RideTrackPoint],
  previous: RideTrackPoint? = nil
) -> [BucketLocationPoint] {
  var lastByBoard: [String: RideTrackPoint] = [:]
  if let previous { lastByBoard[previous.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID] = previous }
  return points.map { point in
    let boardKey = point.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let from = lastByBoard[boardKey].flatMap { $0.recordingId == point.recordingId ? $0 : nil }
    let step = from.map {
      telemetryHaversineM(
        Double($0.latitudeE7) / 10_000_000.0,
        Double($0.longitudeE7) / 10_000_000.0,
        Double(point.latitudeE7) / 10_000_000.0,
        Double(point.longitudeE7) / 10_000_000.0
      )
    }
    lastByBoard[boardKey] = point
    return BucketLocationPoint(
      capturedAtMs: point.fixAtMs,
      boardId: point.boardId,
      recordingId: point.recordingId ?? LEGACY_RIDE_RECORDING_ID,
      precise: rideTrackFixIsPrecise(accuracyCm: point.accuracyCm, recordingId: point.recordingId),
      distanceFromPreviousCm: step.map { Int64(($0 * 100.0).rounded()) },
      gpsSpeedCentiMps: point.gpsSpeedCentiMps,
      latitudeE7: point.latitudeE7,
      longitudeE7: point.longitudeE7
    )
  }
}

internal func rideTrackPoint(_ row: Row) -> RideTrackPoint {
  RideTrackPoint(
    recordingId: row["recording_id"] as String?,
    boardId: row["board_id"] as String?,
    fixAtMs: row["fix_at_ms"] as Int64,
    latitudeE7: row["latitude_e7"] as Int64,
    longitudeE7: row["longitude_e7"] as Int64,
    accuracyCm: row["accuracy_cm"] as Int?,
    gpsSpeedCentiMps: row["gps_speed_centi_mps"] as Int?,
    bearingCentiDeg: row["bearing_centi_deg"] as Int?,
    altitudeCm: row["altitude_cm"] as Int?
  )
}

/// The Ride Track fix that was current when a sample was captured, or nil when none was.
///
/// The two streams are written on two clocks and joined here, on read — never at write time. The
/// age gate is the same one live telemetry uses: beyond it a sample records no position rather than
/// repeating a dead fix (ADR 0034).
///
/// The cursor is kept **per Board**: a rebuild reads a mixed-Board track, and a single cursor would
/// let one Board's fix become the current one for another Board's next sample, dropping a position
/// that Board's own in-range fix already covered.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `stampTrackLocations`
internal struct RideTrackStamper {
  private let track: [RideTrackPoint]
  private var cursor = 0
  private var currentByBoard: [String: RideTrackPoint] = [:]
  /// A fix that matched no saved Board can stamp any Board's sample, as it always could.
  private var currentUnattributed: RideTrackPoint?
  private var currentAny: RideTrackPoint?

  init(_ track: [RideTrackPoint]) {
    self.track = track
  }

  mutating func fix(atOrBefore capturedAtMs: Int64, boardId: String?) -> RideTrackPoint? {
    while cursor < track.count && track[cursor].fixAtMs <= capturedAtMs {
      let point = track[cursor]
      if let pointBoardId = point.boardId {
        currentByBoard[pointBoardId] = point
      } else {
        currentUnattributed = point
      }
      currentAny = point
      cursor += 1
    }
    let candidate: RideTrackPoint?
    if let boardId {
      candidate = [currentByBoard[boardId], currentUnattributed]
        .compactMap { $0 }
        .max { $0.fixAtMs < $1.fixAtMs }
    } else {
      candidate = currentAny
    }
    guard let fix = candidate, capturedAtMs - fix.fixAtMs <= telemetryLocationMaxAgeMs
    else { return nil }
    return fix
  }
}
