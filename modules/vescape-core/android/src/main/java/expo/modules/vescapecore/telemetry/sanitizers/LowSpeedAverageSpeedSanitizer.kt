package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_LOW_SPEED
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_ID
import kotlin.math.abs

internal class LowSpeedAverageSpeedSanitizer(
  movingSpeedThresholdCentiKmh: Int,
) : MetricSampleSanitizer {
  private val threshold = movingSpeedThresholdCentiKmh.coerceAtLeast(0)

  override fun sanitize(
    index: Int,
    point: BucketTelemetryPoint,
    context: MetricSanitizationContext,
  ): MetricSanitizerOutput {
    val absSpeed = abs(point.speedCentiKmh)
    if (absSpeed >= threshold) return MetricSanitizerOutput()

    return MetricSanitizerOutput(
      excludedFromAvgSpeed = true,
      exclusions = listOf(
        MetricExclusionSample(
          capturedAtMs = point.capturedAtMs,
          boardId = point.boardId ?: UNKNOWN_TELEMETRY_BOARD_ID,
          reason = EXCLUSION_REASON_LOW_SPEED,
        ),
      ),
    )
  }
}
