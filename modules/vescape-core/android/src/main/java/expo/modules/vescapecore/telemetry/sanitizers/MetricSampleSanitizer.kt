package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint

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

/** Sees every sample once, in capture order. */
internal interface MetricSampleSanitizer {
  fun sanitize(point: BucketTelemetryPoint): MetricSanitizerOutput
}
