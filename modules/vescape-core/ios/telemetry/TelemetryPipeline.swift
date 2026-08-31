import Foundation

/// One GPS fix as everything downstream sees it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryModels.kt `LocationSnapshot`
/// @parity /modules/vescape-core/src/index.ts `LocationEvent`
internal struct TelemetryLocationCapture {
  let latitude: Double
  let longitude: Double
  let speedMps: Double?
  let bearingDeg: Double?
  let accuracyM: Double?
  let altitudeM: Double?
  let timestamp: Int64
  let precise: Bool
  /// The reliable course from `GpsCourseDeriver`, not the raw `bearingDeg`. Nil on approximate
  /// fixes and wherever a capture is rebuilt from storage.
  var courseDeg: Double?
  /// The fix `courseDeg` was derived from; older than `timestamp` while a course is retained.
  var courseSourceTimestamp: Int64?

  init(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    accuracyM: Double?,
    altitudeM: Double?,
    timestamp: Int64,
    precise: Bool,
    courseDeg: Double? = nil,
    courseSourceTimestamp: Int64? = nil
  ) {
    self.latitude = latitude
    self.longitude = longitude
    self.speedMps = speedMps
    self.bearingDeg = bearingDeg
    self.accuracyM = accuracyM
    self.altitudeM = altitudeM
    self.timestamp = timestamp
    self.precise = precise
    self.courseDeg = courseDeg
    self.courseSourceTimestamp = courseSourceTimestamp
  }

  var map: [String: Any?] {
    [
      "latitude": latitude,
      "longitude": longitude,
      "speedMps": speedMps,
      "bearingDeg": bearingDeg,
      "accuracyM": accuracyM,
      "altitudeM": altitudeM,
      "timestamp": timestamp,
      "precise": precise,
      "courseDeg": courseDeg,
      "courseSourceTimestamp": courseSourceTimestamp,
    ]
  }
}

/// How stale a GPS fix may be and still be stamped onto a recorded telemetry frame.
///
/// ADR 0034 "Recording never fabricates GPS": the trackers legitimately keep the last known fix
/// alive for map display, but a recorded frame that repeats a dead fix invents a ride that never
/// happened. Beyond this age the frame records no location and the route gap stays honest.
///
/// Both sides of the comparison are wall-clock epoch ms — `capturedAtMs` comes from the session
/// clock (`SessionClock.nowMs()`), the fix timestamp from `CLLocation.timestamp`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryMapper.kt `TELEMETRY_LOCATION_MAX_AGE_MS`
internal let telemetryLocationMaxAgeMs: Int64 = 10_000

/// The fix to record on a frame captured at `capturedAtMs`, or nil when the fix is too old.
/// A fix stamped in the future (clock skew) counts as fresh.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryMapper.kt `freshEnoughToRecord`
internal func telemetryLocationFreshEnoughToRecord(
  _ location: TelemetryLocationCapture?,
  capturedAtMs: Int64
) -> TelemetryLocationCapture? {
  guard let location else { return nil }
  return capturedAtMs - location.timestamp <= telemetryLocationMaxAgeMs ? location : nil
}

internal struct TelemetryCapture {
  let capturedAtMs: Int64
  let elapsedRealtimeMs: Int64
  /// Owning Board (`boards.id`) — what every telemetry table is keyed on (ADR 0028).
  let boardId: String?
  let canId: Int?
  let telemetry: RefloatTelemetry
  let location: TelemetryLocationCapture?
}

internal struct BucketTelemetryPoint {
  let capturedAtMs: Int64
  /// Owning Board (`boards.id`); the durable identity telemetry is keyed on (ADR 0028).
  let boardId: String?
  let speedCentiKmh: Int
  let batteryVoltageMv: Int
  let motorCurrentMa: Int
  let batteryCurrentMa: Int
  let dutyPermille: Int
  let odometerCm: Int64?
  let tempMosfetDeciC: Int?
  let tempMotorDeciC: Int?
  let gpsSpeedCentiMps: Int?
  let gpsTimestampMs: Int64?
  let gpsAccuracyCm: Int?
  let latitudeE7: Int64?
  let longitudeE7: Int64?
  let bearingCentiDeg: Int?
  let altitudeCm: Int?
  let preciseGps: Bool
  var excludedFromAvgSpeed = false
  var excludedFromMaxSpeed = false
  var excludedFromMaxDuty = false
}

internal struct FullTelemetryState {
  let capture: TelemetryCapture

  var t: RefloatTelemetry { capture.telemetry }
  var capturedAtMs: Int64 { capture.capturedAtMs }
  var elapsedRealtimeMs: Int64 { capture.elapsedRealtimeMs }
  var boardId: String? { capture.boardId }
  var location: TelemetryLocationCapture? { capture.location }

  func toBucketPoint() -> BucketTelemetryPoint {
    BucketTelemetryPoint(
      capturedAtMs: capturedAtMs,
      boardId: boardId,
      speedCentiKmh: telemetryCenti(t.speed),
      batteryVoltageMv: telemetryMilli(t.batteryVoltage),
      motorCurrentMa: telemetryMilli(t.motorCurrent),
      batteryCurrentMa: telemetryMilli(t.batteryCurrent),
      dutyPermille: telemetryMilli(t.dutyCycle),
      odometerCm: t.odometer.map { Int64(($0 * 100.0).rounded()) },
      tempMosfetDeciC: t.tempMosfet.map { telemetryDeci($0) },
      tempMotorDeciC: t.tempMotor.map { telemetryDeci($0) },
      gpsSpeedCentiMps: location?.speedMps.map { telemetryCenti($0) },
      gpsTimestampMs: location?.timestamp,
      gpsAccuracyCm: location?.accuracyM.map { telemetryCenti($0) },
      latitudeE7: location.map { Int64(($0.latitude * 10_000_000.0).rounded()) },
      longitudeE7: location.map { Int64(($0.longitude * 10_000_000.0).rounded()) },
      bearingCentiDeg: location?.bearingDeg.map { telemetryCenti($0) },
      altitudeCm: location?.altitudeM.map { telemetryCenti($0) },
      preciseGps: location?.precise ?? false
    )
  }
}

