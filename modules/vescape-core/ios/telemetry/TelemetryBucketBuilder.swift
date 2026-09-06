import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt
internal struct TelemetryBucket {
  let bucketStartMs: Int64
  /// Owning Board (`boards.id`), or `""` when the samples match no saved Board — the column is part
  /// of the bucket primary key, so unattributed rows need a value rather than null (ADR 0028).
  let boardId: String
  var sampleCount = 0
  var firstSampleAtMs = Int64.max
  var lastSampleAtMs = Int64.min
  var sumAbsSpeedCentiKmh: Int64 = 0
  var movingSpeedSampleCount = 0
  var sumMovingAbsSpeedCentiKmh: Int64 = 0
  var firstMovingAtMs: Int64?
  var lastMovingAtMs: Int64?
  var maxAbsSpeedCentiKmh = 0
  var minBatteryVoltageMv: Int?
  var maxMotorCurrentAbsMa = 0
  var maxBatteryCurrentAbsMa = 0
  var maxDutyAbsPermille = 0
  var firstOdometerCm: Int64?
  var lastOdometerCm: Int64?
  var gpsPointCount = 0
  var preciseGpsPointCount = 0
  var maxGpsSpeedCentiMps: Int?
  var maxTempMosfetDeciC: Int?
  var maxTempMotorDeciC: Int?
  var firstLatitudeE7: Int64?
  var firstLongitudeE7: Int64?
  var batteryUsedWhMilli: Int64 = 0
  var batteryRegenWhMilli: Int64 = 0
  var lastEnergyPoint: BucketTelemetryPoint?

  mutating func add(_ point: BucketTelemetryPoint) {
    sampleCount += 1
    firstSampleAtMs = min(firstSampleAtMs, point.capturedAtMs)
    lastSampleAtMs = max(lastSampleAtMs, point.capturedAtMs)
    let absSpeed = abs(point.speedCentiKmh)
    sumAbsSpeedCentiKmh += Int64(absSpeed)
    if !point.excludedFromAvgSpeed {
      movingSpeedSampleCount += 1
      sumMovingAbsSpeedCentiKmh += Int64(absSpeed)
      firstMovingAtMs = min(firstMovingAtMs ?? point.capturedAtMs, point.capturedAtMs)
      lastMovingAtMs = max(lastMovingAtMs ?? point.capturedAtMs, point.capturedAtMs)
    }
    if !point.excludedFromMaxSpeed { maxAbsSpeedCentiKmh = max(maxAbsSpeedCentiKmh, absSpeed) }
    minBatteryVoltageMv = min(minBatteryVoltageMv ?? point.batteryVoltageMv, point.batteryVoltageMv)
    maxMotorCurrentAbsMa = max(maxMotorCurrentAbsMa, abs(point.motorCurrentMa))
    maxBatteryCurrentAbsMa = max(maxBatteryCurrentAbsMa, abs(point.batteryCurrentMa))
    if !point.excludedFromMaxDuty { maxDutyAbsPermille = max(maxDutyAbsPermille, abs(point.dutyPermille)) }
    if firstOdometerCm == nil { firstOdometerCm = point.odometerCm }
    if point.odometerCm != nil { lastOdometerCm = point.odometerCm }
    maxTempMosfetDeciC = telemetryMaxOptional(maxTempMosfetDeciC, point.tempMosfetDeciC)
    maxTempMotorDeciC = telemetryMaxOptional(maxTempMotorDeciC, point.tempMotorDeciC)
    if point.gpsTimestampMs != nil {
      gpsPointCount += 1
      if point.preciseGps || (point.gpsAccuracyCm.map { $0 <= 2_000 } ?? false) { preciseGpsPointCount += 1 }
      maxGpsSpeedCentiMps = telemetryMaxOptional(maxGpsSpeedCentiMps, point.gpsSpeedCentiMps)
      if firstLatitudeE7 == nil, let latitude = point.latitudeE7, let longitude = point.longitudeE7 {
        firstLatitudeE7 = latitude
        firstLongitudeE7 = longitude
      }
    }
    if let previous = lastEnergyPoint {
      let dtMs = point.capturedAtMs - previous.capturedAtMs
      if dtMs > 0 && dtMs <= MAX_ENERGY_SAMPLE_GAP_MS {
        let wh = Double(previous.batteryVoltageMv) / 1000.0 * Double(previous.batteryCurrentMa) / 1000.0 * Double(dtMs) / 3_600_000.0
        let milli = Int64((abs(wh) * 1000.0).rounded())
        if wh > 0 { batteryUsedWhMilli += milli }
        if wh < 0 { batteryRegenWhMilli += milli }
      }
    }
    lastEnergyPoint = point
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `buildTelemetryBuckets`
internal func buildTelemetryBuckets(_ points: [BucketTelemetryPoint]) -> [TelemetryBucket] {
  var buckets: [String: TelemetryBucket] = [:]
  for point in points.sorted(by: { $0.capturedAtMs < $1.capturedAtMs }) {
    let bucketStart = point.capturedAtMs - (point.capturedAtMs % TELEMETRY_BUCKET_SIZE_MS)
    let boardId = point.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let key = "\(boardId):\(bucketStart)"
    var bucket = buckets[key] ?? TelemetryBucket(bucketStartMs: bucketStart, boardId: boardId)
    bucket.add(point)
    buckets[key] = bucket
  }
  return Array(buckets.values)
}
