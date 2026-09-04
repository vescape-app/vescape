package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH
import expo.modules.vescapecore.telemetry.FREE_SPIN_NEAREST_GPS_MAX_AGE_MS
import expo.modules.vescapecore.telemetry.RideTrackPointEntity
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_ID
import expo.modules.vescapecore.telemetry.isPrecise
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
    val nearestGps = findNearestFix(point, context.track) ?: return MetricSanitizerOutput()
    val gpsSpeedCentiKmh = gpsSpeedCentiMpsToCentiKmh(nearestGps.gpsSpeedCentiMps!!)
    val freeSpin = if (gpsSpeedCentiKmh < FREE_SPIN_LOW_GPS_CUTOFF_CENTI_KMH) {
      absSpeed > stationaryCap
    } else {
      absSpeed - gpsSpeedCentiKmh > maxDelta
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

internal fun preciseGpsTrack(track: List<RideTrackPointEntity>): List<RideTrackPointEntity> =
  track.filter { it.isPrecise() && it.gpsSpeedCentiMps != null }

/**
 * The fix nearest in time to a sample, within the age window and attributable to its Board. The two
 * streams run on two clocks, so "nearest" is a search, not an index: a fix either side of the
 * sample is equally usable. [track] must be ordered by `fixAtMs`.
 */
internal fun findNearestFix(
  point: BucketTelemetryPoint,
  track: List<RideTrackPointEntity>,
): RideTrackPointEntity? {
  if (track.isEmpty()) return null
  var low = 0
  var high = track.size
  while (low < high) {
    val mid = (low + high) / 2
    if (track[mid].fixAtMs < point.capturedAtMs) low = mid + 1 else high = mid
  }

  var best: RideTrackPointEntity? = null
  var bestAge = Long.MAX_VALUE

  // Walk outward until the age window closes rather than over a fixed number of neighbours: a
  // multi-Board track interleaves fixes, so the nearest same-Board fix can sit several indices out.
  fun consider(candidate: RideTrackPointEntity): Boolean {
    val age = abs(candidate.fixAtMs - point.capturedAtMs)
    if (age > FREE_SPIN_NEAREST_GPS_MAX_AGE_MS) return false
    // A fix that matched no saved Board can stand in for any Board's sample, as it always could.
    val attributable = candidate.boardId == null || candidate.boardId == point.boardId
    if (attributable && age < bestAge) {
      best = candidate
      bestAge = age
    }
    return true
  }

  var backward = low - 1
  while (backward >= 0 && consider(track[backward])) backward--
  var forward = low
  while (forward < track.size && consider(track[forward])) forward++
  return best
}

/** @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift `gpsSpeedCentiMpsToCentiKmh` */
internal fun gpsSpeedCentiMpsToCentiKmh(centiMps: Int): Int = (centiMps * 36) / 10
