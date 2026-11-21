import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `RIDE_TRACK_PRECISE_ACCURACY_CM`
internal let rideTrackPreciseAccuracyCm = Int(MAX_RECORDING_ACCURACY_M * 100.0)

internal func rideTrackFixIsPrecise(accuracyCm: Int?) -> Bool {
  guard let accuracyCm else { return false }
  return accuracyCm <= rideTrackPreciseAccuracyCm
}

internal func rideTrackFixIsPrecise(_ point: RideTrackPoint) -> Bool {
  rideTrackFixIsPrecise(accuracyCm: point.accuracyCm)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `isMovementEvidence`
internal func rideTrackFixIsMovement(_ point: RideTrackPoint, movingThresholdCentiKmh: Int) -> Bool {
  guard rideTrackFixIsPrecise(point), let speedCentiMps = point.gpsSpeedCentiMps else { return false }
  return gpsSpeedCentiMpsToCentiKmh(speedCentiMps) >= movingThresholdCentiKmh
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `gpsSpeedCentiMpsToCentiKmh`
internal func gpsSpeedCentiMpsToCentiKmh(_ centiMps: Int) -> Int { (centiMps * 36) / 10 }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toGpsSampleMaps`
/// @parity /modules/vescape-core/src/index.ts `HistoryGpsSample`
internal func rideTrackGpsMaps(_ rows: [Row], boardNames: [String: String]) -> [[String: Any?]] {
  var previousByBoard: [String: (lat: Double, lon: Double)] = [:]
  return rows.compactMap { row in
    let accuracyCm = row["accuracy_cm"] as Int?
    guard rideTrackFixIsPrecise(accuracyCm: accuracyCm) else { return nil }
    let latitude = Double(row["latitude_e7"] as Int64) / 10_000_000.0
    let longitude = Double(row["longitude_e7"] as Int64) / 10_000_000.0
    let boardId = row["board_id"] as String?
    let boardKey = boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let step = previousByBoard[boardKey].map { previous in
      telemetryHaversineM(previous.lat, previous.lon, latitude, longitude)
    }
    previousByBoard[boardKey] = (latitude, longitude)
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
      "distanceFromPreviousM": step,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toBucketLocationPoints`
internal func rideTrackBucketPoints(
  _ points: [RideTrackPoint],
  previous: RideTrackPoint? = nil,
  movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH
) -> [BucketLocationPoint] {
  var lastByBoard: [String: RideTrackPoint] = [:]
  if let previous, rideTrackFixIsPrecise(previous) {
    lastByBoard[previous.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID] = previous
  }
  return points.map { point in
    let precise = rideTrackFixIsPrecise(point)
    let boardKey = point.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let from = precise ? lastByBoard[boardKey] : nil
    let step = from.map {
      telemetryHaversineM(
        Double($0.latitudeE7) / 10_000_000.0,
        Double($0.longitudeE7) / 10_000_000.0,
        Double(point.latitudeE7) / 10_000_000.0,
        Double(point.longitudeE7) / 10_000_000.0
      )
    }
    if precise { lastByBoard[boardKey] = point }
    return BucketLocationPoint(
      capturedAtMs: point.fixAtMs,
      boardId: point.boardId,
      precise: precise,
      moving: rideTrackFixIsMovement(point, movingThresholdCentiKmh: movingThresholdCentiKmh),
      distanceFromPreviousCm: step.map { Int64(($0 * 100.0).rounded()) },
      gpsSpeedCentiMps: point.gpsSpeedCentiMps,
      latitudeE7: precise ? point.latitudeE7 : nil,
      longitudeE7: precise ? point.longitudeE7 : nil
    )
  }
}

internal func rideTrackPoint(_ row: Row) -> RideTrackPoint {
  RideTrackPoint(
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

internal func telemetryHaversineM(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
  let radius = 6_371_000.0
  let dLat = (lat2 - lat1) * .pi / 180.0
  let dLon = (lon2 - lon1) * .pi / 180.0
  let a = sin(dLat / 2) * sin(dLat / 2) +
    cos(lat1 * .pi / 180.0) * cos(lat2 * .pi / 180.0) *
    sin(dLon / 2) * sin(dLon / 2)
  return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
}
