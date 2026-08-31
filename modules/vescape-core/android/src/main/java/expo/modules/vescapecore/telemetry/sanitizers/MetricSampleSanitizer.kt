package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint

internal data class MetricSanitizationContext(
  val samples: List<BucketTelemetryPoint>,
  val preciseGpsIndices: List<Int>,
)

internal data class MetricExclusionSample(
  val capturedAtMs: Long,
  val boardId: String,
  val reason: String,
)

internal data class MetricSanitizerOutput(
  val excludedFromAvgSpeed: Boolean = false,
  val excludedFromMaxSpeed: Boolean = false,
  val excludedFromMaxDuty: Boolean = false,
  val exclusions: List<MetricExclusionSample> = emptyList(),
)

internal interface MetricSampleSanitizer {
  fun sanitize(
    index: Int,
    point: BucketTelemetryPoint,
    context: MetricSanitizationContext,
  ): MetricSanitizerOutput
}
