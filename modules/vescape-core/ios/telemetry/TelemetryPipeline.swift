import Foundation

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
  var courseDeg: Double?
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryMapper.kt `TELEMETRY_LOCATION_MAX_AGE_MS`
internal let telemetryLocationMaxAgeMs: Int64 = 10_000

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
  let boardId: String?
  let canId: Int?
  let telemetry: RefloatTelemetry
  let location: TelemetryLocationCapture?
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
      tempMotorDeciC: t.tempMotor.map { telemetryDeci($0) }
    )
  }
}
