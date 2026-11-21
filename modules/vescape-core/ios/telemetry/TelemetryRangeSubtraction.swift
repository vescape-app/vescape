import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRangeSubtraction.kt `TelemetryTimeRange`
internal struct TelemetryTimeRange: Equatable {
  let startMs: Int64
  let endMs: Int64

  init(startMs: Int64, endMs: Int64) {
    precondition(endMs >= startMs)
    self.startMs = startMs
    self.endMs = endMs
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRangeSubtraction.kt `expandTelemetryRangeToBuckets`
internal func expandTelemetryRangeToBuckets(
  _ range: TelemetryTimeRange,
  bucketSizeMs: Int64 = TELEMETRY_BUCKET_SIZE_MS
) -> TelemetryTimeRange {
  precondition(bucketSizeMs > 0)
  let start = range.startMs - (range.startMs % bucketSizeMs)
  let endStart = range.endMs - (range.endMs % bucketSizeMs)
  return TelemetryTimeRange(startMs: start, endMs: endStart + bucketSizeMs - 1)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRangeSubtraction.kt `subtractProtectedTelemetryRanges`
internal func subtractProtectedTelemetryRanges(
  deleteRange: TelemetryTimeRange,
  protectedRanges: [TelemetryTimeRange]
) -> [TelemetryTimeRange] {
  let clipped = protectedRanges.compactMap { range -> TelemetryTimeRange? in
    let start = max(deleteRange.startMs, range.startMs)
    let end = min(deleteRange.endMs, range.endMs)
    return start <= end ? TelemetryTimeRange(startMs: start, endMs: end) : nil
  }.sorted { $0.startMs < $1.startMs }

  var protected: [TelemetryTimeRange] = []
  for range in clipped {
    if
      let previous = protected.last,
      range.startMs <= previous.endMs ||
        (previous.endMs != Int64.max && range.startMs == previous.endMs + 1)
    {
      protected[protected.count - 1] = TelemetryTimeRange(
        startMs: previous.startMs,
        endMs: max(previous.endMs, range.endMs)
      )
    } else {
      protected.append(range)
    }
  }

  var deletable: [TelemetryTimeRange] = []
  var cursor = deleteRange.startMs
  for range in protected {
    if cursor < range.startMs {
      deletable.append(TelemetryTimeRange(startMs: cursor, endMs: range.startMs - 1))
    }
    if range.endMs == Int64.max { return deletable }
    cursor = range.endMs + 1
  }
  if cursor <= deleteRange.endMs {
    deletable.append(TelemetryTimeRange(startMs: cursor, endMs: deleteRange.endMs))
  }
  return deletable
}
