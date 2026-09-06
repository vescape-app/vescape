package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.FREE_SPIN_GPS_PRECISE_ACCURACY_CM
import expo.modules.vescapecore.telemetry.FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH
import expo.modules.vescapecore.telemetry.FREE_SPIN_NEAREST_GPS_MAX_AGE_MS
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_ID
import kotlin.math.abs

internal class FreeSpinMetricSanitizer(
  maxSpeedDeltaCentiKmh: Int,
  stationaryBoardCapCentiKmh: Int,
) : MetricSampleSanitizer {
  private val maxDelta = maxSpeedDeltaCentiKmh.coerceAtLeast(0)
  private val stationaryCap = stationaryBoardCapCentiKmh.coerceAtLeast(0)

  override fun sanitize(
    index: Int,
    point: BucketTelemetryPoint,
    context: MetricSanitizationContext,
  ): MetricSanitizerOutput {
    val absSpeed = abs(point.speedCentiKmh)
    val nearestGps = findNearestPreciseGps(index, point, context) ?: return MetricSanitizerOutput()
    val gpsSpeedKmh = gpsSpeedCentiMpsToKmh(nearestGps.gpsSpeedCentiMps!!)
    val freeSpin = if (gpsSpeedKmh < FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH) {
      absSpeed > stationaryCap
    } else {
      absSpeed - gpsSpeedKmh > maxDelta
    }
    if (!freeSpin) return MetricSanitizerOutput()

    return MetricSanitizerOutput(
      excludedFromMaxSpeed = true,
      excludedFromMaxDuty = true,
      exclusions = listOf(
        MetricExclusionSample(
          capturedAtMs = point.capturedAtMs,
          boardId = point.boardId ?: UNKNOWN_TELEMETRY_BOARD_ID,
          reason = EXCLUSION_REASON_FREE_SPIN,
        ),
      ),
    )
  }
}

internal fun buildPreciseGpsIndex(samples: List<BucketTelemetryPoint>): List<Int> =
  samples.indices.filter { i -> isPreciseGps(samples[i]) }

internal fun isPreciseGps(point: BucketTelemetryPoint): Boolean =
  point.gpsSpeedCentiMps != null &&
    point.gpsTimestampMs != null &&
    point.gpsAccuracyCm != null &&
    point.gpsAccuracyCm <= FREE_SPIN_GPS_PRECISE_ACCURACY_CM

internal fun findNearestPreciseGps(
  index: Int,
  point: BucketTelemetryPoint,
  context: MetricSanitizationContext,
): BucketTelemetryPoint? {
  if (context.preciseGpsIndices.isEmpty()) return null

  var insertionPoint = context.preciseGpsIndices.binarySearch(index)
  if (insertionPoint < 0) insertionPoint = -(insertionPoint + 1)

  var best: BucketTelemetryPoint? = null
  var bestAge = Long.MAX_VALUE

  for (offset in intArrayOf(0, -1)) {
    val idx = insertionPoint + offset
    if (idx < 0 || idx >= context.preciseGpsIndices.size) continue
    val candidate = context.samples[context.preciseGpsIndices[idx]]
    val age = abs(candidate.gpsTimestampMs!! - point.capturedAtMs)
    if (age <= FREE_SPIN_NEAREST_GPS_MAX_AGE_MS && age < bestAge) {
      best = candidate
      bestAge = age
    }
  }
  for (offset in intArrayOf(1)) {
    val idx = insertionPoint + offset
    if (idx < 0 || idx >= context.preciseGpsIndices.size) continue
    val candidate = context.samples[context.preciseGpsIndices[idx]]
    val age = abs(candidate.gpsTimestampMs!! - point.capturedAtMs)
    if (age <= FREE_SPIN_NEAREST_GPS_MAX_AGE_MS && age < bestAge) {
      best = candidate
      bestAge = age
    }
  }

  return best
}

internal fun gpsSpeedCentiMpsToKmh(centiMps: Int): Int = (centiMps * 36) / 10
