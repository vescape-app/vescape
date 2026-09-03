import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt
internal struct TelemetryBucket {
  let bucketStartMs: Int64
  /// Owning Board (`boards.id`), or `""` when the samples match no saved Board — the column is part
  /// of the bucket primary key, so unattributed rows need a value rather than null (ADR 0028).
  let boardId: String
  /// Owning Ride Recording, or `LEGACY_RIDE_RECORDING_ID` for buckets built before durable
  /// recording identity. Part of the key so two recordings of one Board inside one minute aggregate
  /// separately instead of being merged (ADR 0038).
  let recordingId: String
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
  var gpsDistanceCm: Int64 = 0
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

  /// The Ride Track's contribution to this minute. Separate from `add` because the track is its own
  /// stream on its own clock — a fix is not a Telemetry Sample and must not count as one (ADR 0038).
  mutating func addLocation(_ point: BucketLocationPoint) {
    gpsPointCount += 1
    if point.precise { preciseGpsPointCount += 1 }
    firstSampleAtMs = min(firstSampleAtMs, point.capturedAtMs)
    lastSampleAtMs = max(lastSampleAtMs, point.capturedAtMs)
    if firstLatitudeE7 == nil, let latitude = point.latitudeE7, let longitude = point.longitudeE7 {
      firstLatitudeE7 = latitude
      firstLongitudeE7 = longitude
    }
    gpsDistanceCm += point.distanceFromPreviousCm ?? 0
    maxGpsSpeedCentiMps = telemetryMaxOptional(maxGpsSpeedCentiMps, point.gpsSpeedCentiMps)
  }
}

/// One Ride Track fix as the minute buckets see it.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `BucketLocationPoint`
internal struct BucketLocationPoint {
  let capturedAtMs: Int64
  let boardId: String?
  let recordingId: String
  let precise: Bool
  let distanceFromPreviousCm: Int64?
  let gpsSpeedCentiMps: Int?
  let latitudeE7: Int64?
  let longitudeE7: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt `buildTelemetryBuckets`
internal func buildTelemetryBuckets(
  _ points: [BucketTelemetryPoint],
  locationPoints: [BucketLocationPoint] = []
) -> [TelemetryBucket] {
  // Keyed on the Ride Recording as well as the Board and the minute: two recordings of one Board
  // can share a minute, and merging them would fabricate one ride out of two (ADR 0038).
  var buckets: [String: TelemetryBucket] = [:]
  for point in points.sorted(by: { $0.capturedAtMs < $1.capturedAtMs }) {
    let bucketStart = point.capturedAtMs - (point.capturedAtMs % TELEMETRY_BUCKET_SIZE_MS)
    let boardId = point.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let key = "\(boardId):\(point.recordingId):\(bucketStart)"
    var bucket = buckets[key]
      ?? TelemetryBucket(bucketStartMs: bucketStart, boardId: boardId, recordingId: point.recordingId)
    bucket.add(point)
    buckets[key] = bucket
  }
  for point in locationPoints.sorted(by: { $0.capturedAtMs < $1.capturedAtMs }) {
    let bucketStart = point.capturedAtMs - (point.capturedAtMs % TELEMETRY_BUCKET_SIZE_MS)
    let boardId = point.boardId ?? UNKNOWN_TELEMETRY_BOARD_ID
    let key = "\(boardId):\(point.recordingId):\(bucketStart)"
    // A minute can hold fixes and no frame at all — a board dropout is exactly when the Ride Track
    // matters most — so the track creates its own bucket rather than being discarded (ADR 0038).
    var bucket = buckets[key]
      ?? TelemetryBucket(bucketStartMs: bucketStart, boardId: boardId, recordingId: point.recordingId)
    bucket.addLocation(point)
    buckets[key] = bucket
  }
  return Array(buckets.values)
}
