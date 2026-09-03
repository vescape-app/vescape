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
/// [track] is the Ride Track over the same span. Free spin compares the Board's reported speed
/// against the phone's, and that comparison reads the track directly: the fix is not a column on
/// the sample any more, and synthesising one onto the sample just to hand it back would be the
/// same join twice (ADR 0038). Both lists must be ordered by time.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MetricSanitizer.kt
internal func sanitizeTelemetrySamples(
  _ samples: [BucketTelemetryPoint],
  track: [RideTrackPoint] = [],
  config: MetricSanitizerConfig
) -> SanitizationResult {
  let preciseTrack = track.filter { rideTrackFixIsPrecise($0) && $0.gpsSpeedCentiMps != nil }
  var sanitized: [SanitizedSample] = []
  var exclusionSamples: [MetricExclusionSample] = []

  for point in samples {
    let lowSpeed = abs(point.speedCentiKmh) < config.movingSpeedThresholdCentiKmh
    let freeSpin = isFreeSpin(
      point: point,
      track: preciseTrack,
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

private func isFreeSpin(
  point: BucketTelemetryPoint,
  track: [RideTrackPoint],
  maxDelta: Int,
  stationaryCap: Int
) -> Bool {
  guard let nearest = nearestFix(to: point, in: track), let gpsSpeed = nearest.gpsSpeedCentiMps
  else { return false }
  let boardSpeed = abs(point.speedCentiKmh)
  let gpsSpeedKmh = gpsSpeedCentiMpsToCentiKmh(gpsSpeed)
  if gpsSpeedKmh < FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH {
    return boardSpeed > max(0, stationaryCap)
  }
  return boardSpeed - gpsSpeedKmh > max(0, maxDelta)
}

/// The fix nearest in time to a sample, within the age window and attributable to its Board. The
/// two streams run on two clocks, so "nearest" is a search, not an index: a fix either side of the
/// sample is equally usable.
private func nearestFix(to point: BucketTelemetryPoint, in track: [RideTrackPoint]) -> RideTrackPoint? {
  guard !track.isEmpty else { return nil }
  var low = 0
  var high = track.count
  while low < high {
    let mid = (low + high) / 2
    if track[mid].fixAtMs < point.capturedAtMs { low = mid + 1 } else { high = mid }
  }
  var best: RideTrackPoint?
  var bestAge = Int64.max
  for index in (low - 2)...(low + 1) where index >= 0 && index < track.count {
    let candidate = track[index]
    // A fix that matched no saved Board can stand in for any Board's sample, as it always could.
    guard candidate.boardId == nil || candidate.boardId == point.boardId else { continue }
    let age = abs(candidate.fixAtMs - point.capturedAtMs)
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
