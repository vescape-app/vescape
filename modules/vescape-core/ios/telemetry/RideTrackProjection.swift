import Foundation
import GRDB

/// Reported horizontal accuracy a Ride Track fix must beat to count as a route point or as GPS
/// movement evidence. Read-side, deliberately: every fix is stored with the accuracy the platform
/// reported, and this is the one rule that decides what those numbers are good enough for
/// (ADR 0038). It does not change live GPS classification.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `RIDE_TRACK_PRECISE_ACCURACY_CM`
internal let rideTrackPreciseAccuracyCm = Int(MAX_RECORDING_ACCURACY_M * 100.0)

internal func rideTrackFixIsPrecise(accuracyCm: Int?) -> Bool {
  guard let accuracyCm else { return false }
  return accuracyCm <= rideTrackPreciseAccuracyCm
}

/// The Ride Track as JS reads it. Distance is measured only between two fixes of the same Ride
/// Recording — a new recording never continues the previous one's geometry.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toGpsSampleMaps`
internal func rideTrackGpsMaps(_ rows: [Row], boardNames: [String: String]) -> [[String: Any?]] {
  var previous: (recordingId: String?, lat: Double, lon: Double)?
  return rows.map { row in
    let latitude = Double(row["latitude_e7"] as Int64) / 10_000_000.0
    let longitude = Double(row["longitude_e7"] as Int64) / 10_000_000.0
    let recordingId = row["recording_id"] as String?
    let boardId = row["board_id"] as String?
    let accuracyCm = row["accuracy_cm"] as Int?
    let step = previous.flatMap { previous -> Double? in
      guard previous.recordingId == recordingId else { return nil }
      return telemetryHaversineM(previous.lat, previous.lon, latitude, longitude)
    }
    previous = (recordingId, latitude, longitude)
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
      "precise": rideTrackFixIsPrecise(accuracyCm: accuracyCm),
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
  var last = previous
  return points.map { point in
    let from = last.flatMap { $0.recordingId == point.recordingId ? $0 : nil }
    let step = from.map {
      telemetryHaversineM(
        Double($0.latitudeE7) / 10_000_000.0,
        Double($0.longitudeE7) / 10_000_000.0,
        Double(point.latitudeE7) / 10_000_000.0,
        Double(point.longitudeE7) / 10_000_000.0
      )
    }
    last = point
    return BucketLocationPoint(
      capturedAtMs: point.fixAtMs,
      boardId: point.boardId,
      recordingId: point.recordingId ?? LEGACY_RIDE_RECORDING_ID,
      precise: rideTrackFixIsPrecise(accuracyCm: point.accuracyCm),
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
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `stampTrackLocations`
internal struct RideTrackStamper {
  private let track: [RideTrackPoint]
  private var cursor = 0
  private var current: RideTrackPoint?

  init(_ track: [RideTrackPoint]) {
    self.track = track
  }

  mutating func fix(atOrBefore capturedAtMs: Int64, boardId: String?) -> RideTrackPoint? {
    while cursor < track.count && track[cursor].fixAtMs <= capturedAtMs {
      current = track[cursor]
      cursor += 1
    }
    guard let fix = current,
      capturedAtMs - fix.fixAtMs <= telemetryLocationMaxAgeMs,
      boardId == nil || fix.boardId == nil || boardId == fix.boardId
    else { return nil }
    return fix
  }
}
