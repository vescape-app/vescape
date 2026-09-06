package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.telemetry.sanitizers.FreeSpinMetricSanitizer
import expo.modules.vescapecore.telemetry.sanitizers.LowSpeedAverageSpeedSanitizer
import expo.modules.vescapecore.telemetry.sanitizers.MetricExclusionSample
import expo.modules.vescapecore.telemetry.sanitizers.MetricSanitizationContext
import expo.modules.vescapecore.telemetry.sanitizers.buildPreciseGpsIndex
import kotlin.math.roundToInt

// @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift
internal const val DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH = 300
internal const val METRIC_AVG_SPEED = "avg_speed"
internal const val METRIC_MAX_SPEED = "max_speed"
internal const val METRIC_MAX_DUTY = "max_duty"
internal const val EXCLUSION_REASON_LOW_SPEED = "low_speed"
internal const val EXCLUSION_REASON_FREE_SPIN = "free_spin"
internal const val METRIC_EXCLUSION_RANGE_MERGE_GAP_MS = 2_000L

internal const val FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH = 700
internal const val FREE_SPIN_MAX_DELTA_CENTI_KMH = 1200
internal const val FREE_SPIN_NEAREST_GPS_MAX_AGE_MS = 10_000L
internal const val FREE_SPIN_GPS_PRECISE_ACCURACY_CM = 2000

internal const val DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH = 12.0
internal const val DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH = 15.0

internal data class MetricSanitizerConfig(
  val movingSpeedThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
  val freeSpinMaxSpeedDeltaCentiKmh: Int = (DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH * 100).toInt(),
  val freeSpinStationaryBoardCapCentiKmh: Int = (DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH * 100).toInt(),
)

internal fun AppSettings.toMetricSanitizerConfig(): MetricSanitizerConfig =
  MetricSanitizerConfig(
    movingSpeedThresholdCentiKmh = (movingSpeedThresholdKmh * 100.0).roundToInt().coerceAtLeast(0),
    freeSpinMaxSpeedDeltaCentiKmh = (freeSpinMaxSpeedDeltaKmh * 100.0).roundToInt().coerceAtLeast(0),
    freeSpinStationaryBoardCapCentiKmh = (freeSpinStationaryBoardCapKmh * 100.0).roundToInt().coerceAtLeast(0),
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
)

internal fun sanitizeTelemetrySamples(
  samples: List<BucketTelemetryPoint>,
  config: MetricSanitizerConfig,
): SanitizationResult =
  sanitizeTelemetrySamples(
    samples = samples,
    movingSpeedThresholdCentiKmh = config.movingSpeedThresholdCentiKmh,
    freeSpinMaxSpeedDeltaCentiKmh = config.freeSpinMaxSpeedDeltaCentiKmh,
    freeSpinStationaryBoardCapCentiKmh = config.freeSpinStationaryBoardCapCentiKmh,
  )

internal fun sanitizeTelemetrySamples(
  samples: List<BucketTelemetryPoint>,
  movingSpeedThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
  freeSpinMaxSpeedDeltaCentiKmh: Int = (DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH * 100).toInt(),
  freeSpinStationaryBoardCapCentiKmh: Int = (DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH * 100).toInt(),
): SanitizationResult {
  val sanitizers = listOf(
    LowSpeedAverageSpeedSanitizer(movingSpeedThresholdCentiKmh),
    FreeSpinMetricSanitizer(freeSpinMaxSpeedDeltaCentiKmh, freeSpinStationaryBoardCapCentiKmh),
  )
  val context = MetricSanitizationContext(
    samples = samples,
    preciseGpsIndices = buildPreciseGpsIndex(samples),
  )
  val sanitized = mutableListOf<SanitizedSample>()
  val exclusionSamples = mutableListOf<MetricExclusionSample>()

  for ((index, point) in samples.withIndex()) {
    val results = sanitizers.map { sanitizer -> sanitizer.sanitize(index, point, context) }

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

  return SanitizationResult(samples = sanitized, exclusions = collapseExclusionSamples(exclusionSamples))
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
