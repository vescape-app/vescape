import Foundation

internal let DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH = 300
internal let METRIC_AVG_SPEED = "avg_speed"
internal let METRIC_MAX_SPEED = "max_speed"
internal let METRIC_MAX_DUTY = "max_duty"
internal let EXCLUSION_REASON_LOW_SPEED = "low_speed"
internal let EXCLUSION_REASON_FREE_SPIN = "free_spin"
private let EXCLUSION_RANGE_MERGE_GAP_MS: Int64 = 2_000
private let FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH = 700
private let FREE_SPIN_NEAREST_GPS_MAX_AGE_MS: Int64 = 10_000
private let FREE_SPIN_GPS_PRECISE_ACCURACY_CM = 2_000
internal let DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH = 12.0
internal let DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH = 15.0

internal struct MetricSanitizerConfig {
  var movingSpeedThresholdCentiKmh = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH
  var freeSpinMaxSpeedDeltaCentiKmh = Int(DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH * 100)
  var freeSpinStationaryBoardCapCentiKmh = Int(DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH * 100)

  static func from(settings: [String: Any?]) -> MetricSanitizerConfig {
    MetricSanitizerConfig(
      movingSpeedThresholdCentiKmh: max(0, Int(((settings["movingSpeedThresholdKmh"] as? NSNumber)?.doubleValue ?? 3.0) * 100.0)),
      freeSpinMaxSpeedDeltaCentiKmh: max(0, Int(((settings["freeSpinMaxSpeedDeltaKmh"] as? NSNumber)?.doubleValue ?? DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH) * 100.0)),
      freeSpinStationaryBoardCapCentiKmh: max(0, Int(((settings["freeSpinStationaryBoardCapKmh"] as? NSNumber)?.doubleValue ?? DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH) * 100.0))
    )
  }
}

internal struct SanitizedSample {
  let excludedFromAvgSpeed: Bool
  let excludedFromMaxSpeed: Bool
  let excludedFromMaxDuty: Bool
}

internal struct MetricExclusionRange {
  let boardId: String
  let reason: String
  let startMs: Int64
  let endMs: Int64
  let sampleCount: Int
}

internal struct SanitizationResult {
  let samples: [SanitizedSample]
  let exclusions: [MetricExclusionRange]
}

private struct MetricExclusionSample {
  let capturedAtMs: Int64
  let boardId: String
  let reason: String
}

/// Metric Sanitizers preserve raw Telemetry Samples while marking metric values excluded.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MetricSanitizer.kt
internal func sanitizeTelemetrySamples(
  _ samples: [BucketTelemetryPoint],
  config: MetricSanitizerConfig
) -> SanitizationResult {
  let preciseGpsIndices = samples.indices.filter { isPreciseGps(samples[$0]) }
  var sanitized: [SanitizedSample] = []
  var exclusionSamples: [MetricExclusionSample] = []

  for (index, point) in samples.enumerated() {
    let lowSpeed = abs(point.speedCentiKmh) < config.movingSpeedThresholdCentiKmh
    let freeSpin = isFreeSpin(
      index: index,
      point: point,
      samples: samples,
      preciseGpsIndices: preciseGpsIndices,
      maxDelta: config.freeSpinMaxSpeedDeltaCentiKmh,
      stationaryCap: config.freeSpinStationaryBoardCapCentiKmh
    )
    sanitized.append(
      SanitizedSample(
        excludedFromAvgSpeed: lowSpeed,
        excludedFromMaxSpeed: freeSpin,
        excludedFromMaxDuty: freeSpin
      )
    )
    let boardId = point.boardId ?? ""
    if lowSpeed {
      exclusionSamples.append(MetricExclusionSample(capturedAtMs: point.capturedAtMs, boardId: boardId, reason: EXCLUSION_REASON_LOW_SPEED))
    }
    if freeSpin {
      exclusionSamples.append(MetricExclusionSample(capturedAtMs: point.capturedAtMs, boardId: boardId, reason: EXCLUSION_REASON_FREE_SPIN))
    }
  }
  return SanitizationResult(samples: sanitized, exclusions: collapseExclusionSamples(exclusionSamples))
}

private func isPreciseGps(_ point: BucketTelemetryPoint) -> Bool {
  guard let _ = point.gpsSpeedCentiMps, let _ = point.gpsTimestampMs, let accuracy = point.gpsAccuracyCm else {
    return false
  }
  return accuracy <= FREE_SPIN_GPS_PRECISE_ACCURACY_CM
}

private func isFreeSpin(
  index: Int,
  point: BucketTelemetryPoint,
  samples: [BucketTelemetryPoint],
  preciseGpsIndices: [Int],
  maxDelta: Int,
  stationaryCap: Int
) -> Bool {
  guard let nearest = nearestPreciseGps(index: index, point: point, samples: samples, indices: preciseGpsIndices),
        let gpsSpeed = nearest.gpsSpeedCentiMps
  else { return false }
  let boardSpeed = abs(point.speedCentiKmh)
  let gpsSpeedKmh = gpsSpeed * 36 / 10
  if gpsSpeedKmh < FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH {
    return boardSpeed > max(0, stationaryCap)
  }
  return boardSpeed - gpsSpeedKmh > max(0, maxDelta)
}

private func nearestPreciseGps(
  index: Int,
  point: BucketTelemetryPoint,
  samples: [BucketTelemetryPoint],
  indices: [Int]
) -> BucketTelemetryPoint? {
  guard !indices.isEmpty else { return nil }
  let insertion = indices.firstIndex(where: { $0 >= index }) ?? indices.count
  var best: BucketTelemetryPoint?
  var bestAge = Int64.max
  for candidateOffset in [insertion, insertion - 1, insertion + 1] where candidateOffset >= 0 && candidateOffset < indices.count {
    let candidate = samples[indices[candidateOffset]]
    guard let ts = candidate.gpsTimestampMs else { continue }
    let age = abs(ts - point.capturedAtMs)
    if age <= FREE_SPIN_NEAREST_GPS_MAX_AGE_MS && age < bestAge {
      best = candidate
      bestAge = age
    }
  }
  return best
}

private func collapseExclusionSamples(_ samples: [MetricExclusionSample]) -> [MetricExclusionRange] {
  guard !samples.isEmpty else { return [] }
  let sorted = samples.sorted {
    if $0.boardId != $1.boardId { return $0.boardId < $1.boardId }
    if $0.reason != $1.reason { return $0.reason < $1.reason }
    return $0.capturedAtMs < $1.capturedAtMs
  }
  var ranges: [MetricExclusionRange] = []
  var current = sorted[0]
  var start = current.capturedAtMs
  var end = start
  var count = 1

  func flush() {
    ranges.append(MetricExclusionRange(boardId: current.boardId, reason: current.reason, startMs: start, endMs: end, sampleCount: count))
  }

  for sample in sorted.dropFirst() {
    if sample.boardId == current.boardId && sample.reason == current.reason && sample.capturedAtMs - end <= EXCLUSION_RANGE_MERGE_GAP_MS {
      end = sample.capturedAtMs
      count += 1
    } else {
      flush()
      current = sample
      start = sample.capturedAtMs
      end = sample.capturedAtMs
      count = 1
    }
  }
  flush()
  return ranges
}
