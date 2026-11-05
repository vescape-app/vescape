package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.telemetry.sanitizers.FreeSpinCarry
import expo.modules.vescapecore.telemetry.sanitizers.FreeSpinMetricSanitizer
import expo.modules.vescapecore.telemetry.sanitizers.LowSpeedAverageSpeedSanitizer
import expo.modules.vescapecore.telemetry.sanitizers.MetricExclusionSample
import kotlin.math.roundToInt
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.MetricExclusionRangeEntity

// @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift
internal const val DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH = 300
internal const val METRIC_AVG_SPEED = "avg_speed"
internal const val METRIC_MAX_SPEED = "max_speed"
internal const val METRIC_MAX_DUTY = "max_duty"
internal const val EXCLUSION_REASON_LOW_SPEED = "low_speed"
internal const val EXCLUSION_REASON_FREE_SPIN = "free_spin"

data class MetricSanitizerConfig(
  val movingSpeedThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
)

internal fun AppSettings.toMetricSanitizerConfig(): MetricSanitizerConfig =
  MetricSanitizerConfig(
    movingSpeedThresholdCentiKmh = (movingSpeedThresholdKmh * 100.0).roundToInt().coerceAtLeast(0),
  )

internal data class SanitizedSample(
  val index: Int,
  val capturedAtMs: Long,
  val boardId: String?,
  val excludedFromAvgSpeed: Boolean,
  val excludedFromMaxSpeed: Boolean,
  val excludedFromMaxDuty: Boolean,
)

internal data class SanitizationResult(
  val samples: List<SanitizedSample>,
  val exclusions: List<MetricExclusionRangeEntity>,
  /** Free-spin state after the last sample; hand it to the batch that continues these samples. */
  val freeSpinCarry: FreeSpinCarry,
)

/**
 * Metric Sanitizers preserve raw Telemetry Samples while marking metric values excluded.
 *
 * [samples] must be in capture order. Free spin reads each sample against the one before it, so a
 * batch that continues earlier samples passes the earlier batch's [SanitizationResult.freeSpinCarry]
 * as [freeSpinCarry].
 *
 * @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift `sanitizeTelemetrySamples`
 */
internal fun sanitizeTelemetrySamples(
  samples: List<BucketTelemetryPoint>,
  config: MetricSanitizerConfig = MetricSanitizerConfig(),
  freeSpinCarry: FreeSpinCarry = FreeSpinCarry(),
): SanitizationResult {
  val freeSpin = FreeSpinMetricSanitizer(freeSpinCarry)
  val sanitizers = listOf(
    LowSpeedAverageSpeedSanitizer(config.movingSpeedThresholdCentiKmh),
    freeSpin,
  )
  val sanitized = mutableListOf<SanitizedSample>()
  val exclusionSamples = mutableListOf<MetricExclusionSample>()

  for ((index, point) in samples.withIndex()) {
    val results = sanitizers.map { sanitizer -> sanitizer.sanitize(point) }

    sanitized.add(
      SanitizedSample(
        index = index,
        capturedAtMs = point.capturedAtMs,
        boardId = point.boardId,
        excludedFromAvgSpeed = results.any { it.excludedFromAvgSpeed },
        excludedFromMaxSpeed = results.any { it.excludedFromMaxSpeed },
        excludedFromMaxDuty = results.any { it.excludedFromMaxDuty },
      ),
    )
    exclusionSamples.addAll(results.flatMap { it.exclusions })
  }

  return SanitizationResult(
    samples = sanitized,
    exclusions = collapseExclusionSamples(exclusionSamples),
    freeSpinCarry = freeSpin.carry,
  )
}

internal fun collapseExclusionSamples(samples: List<MetricExclusionSample>): List<MetricExclusionRangeEntity> {
  if (samples.isEmpty()) return emptyList()
  val ranges = mutableListOf<MetricExclusionRangeEntity>()
  val sorted = samples.sortedWith(compareBy({ it.boardId }, { it.reason }, { it.capturedAtMs }))

  var boardId = sorted.first().boardId
  var reason = sorted.first().reason
  var startMs = sorted.first().capturedAtMs
  var endMs = startMs
  var sampleCount = 1

  fun flush() {
    ranges.add(
      MetricExclusionRangeEntity(
        boardId = boardId,
        reason = reason,
        startMs = startMs,
        endMs = endMs,
        sampleCount = sampleCount,
      ),
    )
  }

  for (sample in sorted.drop(1)) {
    val sameRange = sample.boardId == boardId &&
      sample.reason == reason &&
      sample.capturedAtMs - endMs <= METRIC_EXCLUSION_RANGE_MERGE_GAP_MS
    if (sameRange) {
      endMs = sample.capturedAtMs
      sampleCount++
    } else {
      flush()
      boardId = sample.boardId
      reason = sample.reason
      startMs = sample.capturedAtMs
      endMs = sample.capturedAtMs
      sampleCount = 1
    }
  }
  flush()

  return ranges
}
