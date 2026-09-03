import Foundation
import GRDB

/// Reported horizontal accuracy a Ride Track fix must beat to count as a route point or as GPS
/// movement evidence. Read-side, deliberately: every fix is stored with the accuracy the platform
/// reported, and this is the one rule that decides what those numbers are good enough for
/// (ADR 0038). It is the same number on both platforms and does not look at the Android provider;
/// it does not change live GPS classification.
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

internal func rideTrackFixIsPrecise(_ point: RideTrackPoint) -> Bool {
  rideTrackFixIsPrecise(accuracyCm: point.accuracyCm, recordingId: point.recordingId)
}

/// Does this fix evidence movement? The fix's **own reported speed**, checked after the accuracy
/// rule and against the rider's movement threshold — never a speed derived from the displacement
/// between two coordinates, which turns GPS scatter into a phantom ride. A fix with no reported
/// speed is not movement evidence, but stays a perfectly good route point (ADR 0038).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `isMovementEvidence`
internal func rideTrackFixIsMovement(_ point: RideTrackPoint, movingThresholdCentiKmh: Int) -> Bool {
  guard rideTrackFixIsPrecise(point), let speedCentiMps = point.gpsSpeedCentiMps else { return false }
  return gpsSpeedCentiMpsToCentiKmh(speedCentiMps) >= movingThresholdCentiKmh
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/sanitizers/FreeSpinMetricSanitizer.kt `gpsSpeedCentiMpsToCentiKmh`
internal func gpsSpeedCentiMpsToCentiKmh(_ centiMps: Int) -> Int { (centiMps * 36) / 10 }

/// The Ride Track as JS reads it: the route stream.
///
/// Only fixes that pass the shared read-side precision rule cross the bridge. A poor fix stays in
/// storage — that is the whole point of ADR 0038's write-everything decision — but it never draws
/// a route, never anchors a marker and never contributes a step distance, so the rule is applied
/// exactly once, here, instead of in every JS consumer.
///
/// Distance is measured only between two qualifying fixes of the same Ride Recording **and the
/// same Board** — a new recording never continues the previous one's geometry, and legacy rows
/// (which all share a nil recording) never chain across Boards.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toGpsSampleMaps`
internal func rideTrackGpsMaps(_ rows: [Row], boardNames: [String: String]) -> [[String: Any?]] {
  var previousByBoard: [String: (recordingId: String?, lat: Double, lon: Double)] = [:]
  return rows.compactMap { row in
    let recordingId = row["recording_id"] as String?
    let accuracyCm = row["accuracy_cm"] as Int?
    guard rideTrackFixIsPrecise(accuracyCm: accuracyCm, recordingId: recordingId) else { return nil }
    let latitude = Double(row["latitude_e7"] as Int64) / 10_000_000.0
    let longitude = Double(row["longitude_e7"] as Int64) / 10_000_000.0
    let boardId = row["board_id"] as String?
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
      "distanceFromPreviousM": step,
    ]
  }
}

/// The same projection, as the minute-bucket location contribution.
///
/// Every stored fix is counted, so `gpsPointCount` stays an honest measure of what was captured,
/// but only qualifying fixes derive anything: the bucket's route anchor, its step distances and
/// its GPS movement evidence.
///
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
    let from = precise
      ? lastByBoard[boardKey].flatMap { $0.recordingId == point.recordingId ? $0 : nil }
      : nil
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
      recordingId: point.recordingId ?? LEGACY_RIDE_RECORDING_ID,
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
