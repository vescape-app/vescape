import Foundation

internal let DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH = 300
internal let METRIC_AVG_SPEED = "avg_speed"
internal let METRIC_MAX_SPEED = "max_speed"
internal let METRIC_MAX_DUTY = "max_duty"
internal let EXCLUSION_REASON_LOW_SPEED = "low_speed"
internal let EXCLUSION_REASON_FREE_SPIN = "free_spin"
private let EXCLUSION_RANGE_MERGE_GAP_MS: Int64 = 2_000

internal struct MetricSanitizerConfig {
  var movingSpeedThresholdCentiKmh = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH

  static func from(settings: [String: Any?]) -> MetricSanitizerConfig {
    MetricSanitizerConfig(
      movingSpeedThresholdCentiKmh: max(0, Int((((settings["movingSpeedThresholdKmh"] as? NSNumber)?.doubleValue ?? 3.0) * 100.0).rounded()))
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
  /// Free-spin state after the last sample; hand it to the batch that continues these samples.
  let freeSpinCarry: FreeSpinCarry
}

private struct MetricExclusionSample {
  let capturedAtMs: Int64
  let boardId: String
  let reason: String
}

/// Metric Sanitizers preserve raw Telemetry Samples while marking metric values excluded.
///
/// `samples` must be in capture order. Free spin reads each sample against the one before it, so a
/// batch that continues earlier samples passes the earlier batch's `freeSpinCarry`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MetricSanitizer.kt
internal func sanitizeTelemetrySamples(
  _ samples: [BucketTelemetryPoint],
  config: MetricSanitizerConfig = MetricSanitizerConfig(),
  freeSpinCarry: FreeSpinCarry = FreeSpinCarry()
) -> SanitizationResult {
  var boards = freeSpinCarry.boards
  var sanitized: [SanitizedSample] = []
  var exclusionSamples: [MetricExclusionSample] = []

  for point in samples {
    let lowSpeed = abs(point.speedCentiKmh) < config.movingSpeedThresholdCentiKmh
    let key = point.boardId ?? ""
    let (state, freeSpin) = (boards[key] ?? FreeSpinState()).advance(point)
    boards[key] = state
    // A spinning wheel is not riding, so it counts toward no speed metric (ADR 0017).
    sanitized.append(
      SanitizedSample(
        excludedFromAvgSpeed: lowSpeed || freeSpin,
        excludedFromMaxSpeed: freeSpin,
        excludedFromMaxDuty: freeSpin
      )
    )
    if lowSpeed {
      exclusionSamples.append(MetricExclusionSample(capturedAtMs: point.capturedAtMs, boardId: key, reason: EXCLUSION_REASON_LOW_SPEED))
    }
    if freeSpin {
      exclusionSamples.append(MetricExclusionSample(capturedAtMs: point.capturedAtMs, boardId: key, reason: EXCLUSION_REASON_FREE_SPIN))
    }
  }
  return SanitizationResult(
    samples: sanitized,
    exclusions: collapseExclusionSamples(exclusionSamples),
    freeSpinCarry: FreeSpinCarry(boards: boards)
  )
}

/// Each Board's free-spin state where one sanitized batch ends, keyed by Board id (`""` for none).
/// A batch that continues the same samples (the next recording flush, the next rebuilt hour) starts
/// from it, so a spin crossing the edge stays excluded.
internal struct FreeSpinCarry {
  var boards: [String: FreeSpinState] = [:]
}

/// Free spin from Board telemetry alone: speeding up a loaded wheel takes a rider's worth of motor
/// current, a wheel in the air spins up on almost none. A fast climb on little current starts a
/// spin, and a latch keeps excluding the steady spinning after it, which looks like cruising.
///
/// Every value is fixed: per-Board calibration changed no Max Speed on the test rides (#629).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/sanitizers/FreeSpinMetricSanitizer.kt
internal struct FreeSpinState {
  var previous: BucketTelemetryPoint?
  var latch: FreeSpinLatch?

  /// Advance by `point`; the flag is whether `point` is free spin.
  func advance(_ point: BucketTelemetryPoint) -> (FreeSpinState, Bool) {
    let pair = previous.flatMap { SamplePair($0, point) }
    if var latch {
      latch.loadedStreak = pair?.loaded == true ? latch.loadedStreak + 1 : 0
      let returned = abs(point.speedCentiKmh) <= latch.speedBeforeCentiKmh + RETURN_MARGIN_CENTI_KMH
      let stuck = pair.map { abs($0.currentA) < STUCK_CURRENT_A } ?? false
      let timedOut = point.capturedAtMs - latch.startedAtMs > LATCH_TIMEOUT_MS && !stuck
      if !returned && latch.loadedStreak < LOADED_STREAK_TO_RELEASE && !timedOut {
        return (FreeSpinState(previous: point, latch: latch), true)
      }
    }
    if let previous, pair?.spinUp == true {
      let latch = FreeSpinLatch(startedAtMs: point.capturedAtMs, speedBeforeCentiKmh: abs(previous.speedCentiKmh))
      return (FreeSpinState(previous: point, latch: latch), true)
    }
    return (FreeSpinState(previous: point), false)
  }
}

internal struct FreeSpinLatch {
  let startedAtMs: Int64
  let speedBeforeCentiKmh: Int
  var loadedStreak = 0
}

/// Motor current a loaded Board needs per km/h/s of acceleration; measured 5.3–8.6 across Boards.
private let LOADED_EFFORT_A_PER_KMH_S = 6.5
/// Faster than a rider accelerates; a steep downhill gives about 3–4 km/h/s.
private let SPIN_MIN_ACCEL_KMH_S = 10.0
/// A spin-up draws less than this share of the loaded effort.
private let SPIN_EFFORT_RATIO = 0.35
/// A speed change drawing at least this share of the loaded effort carries a rider.
private let LOADED_EFFORT_RATIO = 0.7
private let LOADED_MIN_ACCEL_KMH_S = 2.0
/// One loaded-looking sample is not enough: Refloat's balancing spikes current mid-spin.
private let LOADED_STREAK_TO_RELEASE = 3
private let RETURN_MARGIN_CENTI_KMH = 500
private let LATCH_TIMEOUT_MS: Int64 = 15_000
/// A wheel held at the firmware speed limit in the air draws almost nothing; keep the latch on.
private let STUCK_CURRENT_A = 5.0
private let PAIR_MIN_GAP_MS: Int64 = 5
private let PAIR_MAX_GAP_MS: Int64 = 1_500

/// Two consecutive samples close enough to read an acceleration from; nil when they are not.
private struct SamplePair {
  /// Change in absolute speed, km/h per second.
  let accelKmhS: Double
  /// Mean motor current, A, positive when pushing in the direction of travel.
  let currentA: Double

  init?(_ previous: BucketTelemetryPoint, _ point: BucketTelemetryPoint) {
    let gapMs = point.capturedAtMs - previous.capturedAtMs
    guard gapMs >= PAIR_MIN_GAP_MS, gapMs <= PAIR_MAX_GAP_MS else { return nil }
    let direction = point.speedCentiKmh >= 0 ? 1.0 : -1.0
    accelKmhS = Double(abs(point.speedCentiKmh) - abs(previous.speedCentiKmh)) / 100.0 / (Double(gapMs) / 1_000.0)
    currentA = Double(previous.motorCurrentMa + point.motorCurrentMa) / 2.0 / 1_000.0 * direction
  }

  var spinUp: Bool {
    accelKmhS >= SPIN_MIN_ACCEL_KMH_S && currentA < SPIN_EFFORT_RATIO * LOADED_EFFORT_A_PER_KMH_S * accelKmhS
  }

  var loaded: Bool {
    abs(accelKmhS) >= LOADED_MIN_ACCEL_KMH_S && accelKmhS * currentA > 0
      && abs(currentA) >= LOADED_EFFORT_RATIO * LOADED_EFFORT_A_PER_KMH_S * abs(accelKmhS)
  }
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
