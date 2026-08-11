package expo.modules.vescapecore.telemetry

/**
 * Denormalized ride stats for one Favorite range, mirroring the history session summary fields.
 *
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `FavoriteSummary`
 */
internal data class FavoriteSummary(
  val sampleCount: Int = 0,
  val gpsPointCount: Int = 0,
  /** Odometer delta across the range, or null when the range carries no odometer readings. */
  val distanceCm: Long? = null,
  val movingDurationMs: Long = 0,
  val avgSpeedCentiKmh: Int = 0,
  val maxSpeedCentiKmh: Int = 0,
  val batteryUsedWhMilli: Long = 0,
)

/**
 * Aggregate the buckets built from a Favorite's raw samples into one denormalized summary. Pure so
 * both the create path and its tests share one definition. Mirrors how JS collapses minute buckets
 * into a history session summary, including the GPS-distance fallback for rides with no odometer.
 *
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `buildFavoriteSummary`
 * @parity /src/modules/history/lib/favoritePreview.ts `summarizeFavoriteRange`
 * @platform-diff JS is a live preview over loaded samples; this is the durable sanitized summary.
 * @platform-diff Only Android fills `gps_distance_cm`, so the GPS fallback has no iOS counterpart.
 */
internal fun buildFavoriteSummary(buckets: Collection<TelemetryMinuteBucketEntity>): FavoriteSummary {
  if (buckets.isEmpty()) return FavoriteSummary()

  var sampleCount = 0
  var gpsPointCount = 0
  var sumAbsSpeed = 0L
  var sumMovingSpeed = 0L
  var movingSampleCount = 0
  var maxSpeedCentiKmh = 0
  var batteryUsedWhMilli = 0L
  var odometerDistanceCm: Long? = null
  var gpsDistanceCm = 0L
  var firstMovingAtMs: Long? = null
  var lastMovingAtMs: Long? = null
  var firstSampleAtMs = Long.MAX_VALUE
  var lastSampleAtMs = Long.MIN_VALUE

  for (bucket in buckets.sortedBy { it.bucketStartMs }) {
    sampleCount += bucket.sampleCount
    gpsPointCount += bucket.gpsPointCount
    sumAbsSpeed += bucket.sumAbsSpeedCentiKmh
    sumMovingSpeed += bucket.sumMovingAbsSpeedCentiKmh ?: 0L
    movingSampleCount += bucket.movingSpeedSampleCount ?: 0
    maxSpeedCentiKmh = maxOf(maxSpeedCentiKmh, bucket.maxAbsSpeedCentiKmh)
    batteryUsedWhMilli += bucket.batteryUsedWhMilli
    gpsDistanceCm += bucket.gpsDistanceCm
    val first = bucket.firstOdometerCm
    val last = bucket.lastOdometerCm
    if (first != null && last != null) {
      odometerDistanceCm = (odometerDistanceCm ?: 0L) + maxOf(0L, last - first)
    }
    bucket.firstMovingAtMs?.let { firstMovingAtMs = minOf(firstMovingAtMs ?: it, it) }
    bucket.lastMovingAtMs?.let { lastMovingAtMs = maxOf(lastMovingAtMs ?: it, it) }
    firstSampleAtMs = minOf(firstSampleAtMs, bucket.firstSampleAtMs)
    lastSampleAtMs = maxOf(lastSampleAtMs, bucket.lastSampleAtMs)
  }

  // Moving Window when the range has moving samples, otherwise the wall-clock span it covers — the
  // same fallback JS applies to legacy rides with no precomputed window.
  val movingStart = firstMovingAtMs
  val movingEnd = lastMovingAtMs
  val movingDurationMs = when {
    movingStart != null && movingEnd != null -> maxOf(0L, movingEnd - movingStart)
    firstSampleAtMs <= lastSampleAtMs -> maxOf(0L, lastSampleAtMs - firstSampleAtMs)
    else -> 0L
  }

  return FavoriteSummary(
    sampleCount = sampleCount,
    gpsPointCount = gpsPointCount,
    distanceCm = odometerDistanceCm ?: gpsDistanceCm.takeIf { it > 0 },
    movingDurationMs = movingDurationMs,
    avgSpeedCentiKmh = when {
      movingSampleCount > 0 -> (sumMovingSpeed / movingSampleCount).toInt()
      sampleCount > 0 -> (sumAbsSpeed / sampleCount).toInt()
      else -> 0
    },
    maxSpeedCentiKmh = maxSpeedCentiKmh,
    batteryUsedWhMilli = batteryUsedWhMilli,
  )
}
