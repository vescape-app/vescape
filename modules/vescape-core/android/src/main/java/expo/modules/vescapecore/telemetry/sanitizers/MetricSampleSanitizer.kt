package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.RideTrackPointEntity

/**
 * [track] is the Ride Track over the same span, already reduced to fixes that pass the shared
 * read-side precision rule and report a speed. Sanitizers read it directly: the fix is not a
 * column on the sample any more (ADR 0038).
 */
internal data class MetricSanitizationContext(
  val samples: List<BucketTelemetryPoint>,
  val track: List<RideTrackPointEntity>,
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
