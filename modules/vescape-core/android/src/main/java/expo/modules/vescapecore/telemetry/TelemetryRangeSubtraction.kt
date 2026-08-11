package expo.modules.vescapecore.telemetry

/**
 * Inclusive telemetry time range. Deletion uses inclusive SQL bounds, so subtraction returns the
 * exact inclusive holes that remain deletable.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRangeSubtraction.swift `TelemetryTimeRange`
 */
internal data class TelemetryTimeRange(
  val startMs: Long,
  val endMs: Long,
) {
  init {
    require(endMs >= startMs)
  }
}

/**
 * Deletion protection is bucket-granular: retain every raw sample in each minute bucket touched by
 * a Favorite so its existing precomputed bucket stays truthful without a history-wide rebuild.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRangeSubtraction.swift `expandTelemetryRangeToBuckets`
 */
internal fun expandTelemetryRangeToBuckets(
  range: TelemetryTimeRange,
  bucketSizeMs: Long = TELEMETRY_BUCKET_SIZE_MS,
): TelemetryTimeRange {
  require(bucketSizeMs > 0)
  val start = range.startMs - (range.startMs % bucketSizeMs)
  val endStart = range.endMs - (range.endMs % bucketSizeMs)
  return TelemetryTimeRange(start, endStart + bucketSizeMs - 1)
}

/**
 * Carve protected ranges out of one requested delete range. Protected ranges are clipped, sorted,
 * and merged first so overlapping Favorites never produce duplicate or inverted delete ranges.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRangeSubtraction.swift `subtractProtectedTelemetryRanges`
 */
internal fun subtractProtectedTelemetryRanges(
  deleteRange: TelemetryTimeRange,
  protectedRanges: Collection<TelemetryTimeRange>,
): List<TelemetryTimeRange> {
  val protected = protectedRanges
    .mapNotNull { range ->
      val start = maxOf(deleteRange.startMs, range.startMs)
      val end = minOf(deleteRange.endMs, range.endMs)
      if (start <= end) TelemetryTimeRange(start, end) else null
    }
    .sortedBy { it.startMs }
    .fold(mutableListOf<TelemetryTimeRange>()) { merged, range ->
      val previous = merged.lastOrNull()
      if (
        previous != null &&
        (range.startMs <= previous.endMs || previous.endMs != Long.MAX_VALUE && range.startMs == previous.endMs + 1)
      ) {
        merged[merged.lastIndex] = previous.copy(endMs = maxOf(previous.endMs, range.endMs))
      } else {
        merged += range
      }
      merged
    }

  val deletable = mutableListOf<TelemetryTimeRange>()
  var cursor = deleteRange.startMs
  for (range in protected) {
    if (cursor < range.startMs) deletable += TelemetryTimeRange(cursor, range.startMs - 1)
    if (range.endMs == Long.MAX_VALUE) return deletable
    cursor = range.endMs + 1
  }
  if (cursor <= deleteRange.endMs) deletable += TelemetryTimeRange(cursor, deleteRange.endMs)
  return deletable
}
