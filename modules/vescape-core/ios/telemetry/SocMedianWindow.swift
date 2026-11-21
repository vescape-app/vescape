import Foundation

private let BUCKET_SCALE = 10
private let MAX_BUCKET = 100 * BUCKET_SCALE
private let BUCKET_COUNT = MAX_BUCKET + 1

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/SocMedianWindow.kt
final class SocMedianWindow {
  private struct Sample { let tMs: Int64; let bucket: Int }

  var windowMs: Int64
  private var samples: [Sample] = []
  private var bucketCounts = [Int](repeating: 0, count: BUCKET_COUNT)
  private var sampleCount = 0

  init(windowMs: Int64 = 20_000) { self.windowMs = windowMs }

  func reset() {
    samples.removeAll(keepingCapacity: true)
    for i in bucketCounts.indices { bucketCounts[i] = 0 }
    sampleCount = 0
  }

  func median(percent: Double, nowMs: Int64) -> Double {
    if windowMs <= 0 {
      reset()
      return percent
    }
    let bucket = Self.percentBucket(percent)
    samples.append(Sample(tMs: nowMs, bucket: bucket))
    bucketCounts[bucket] += 1
    sampleCount += 1
    while samples.count > 1, nowMs - samples[0].tMs > windowMs {
      let expired = samples.removeFirst()
      bucketCounts[expired.bucket] -= 1
      sampleCount -= 1
    }
    let mid = sampleCount / 2
    if sampleCount % 2 == 1 {
      return Self.bucketPercent(bucketAtRank(mid))
    } else {
      return (Self.bucketPercent(bucketAtRank(mid - 1)) + Self.bucketPercent(bucketAtRank(mid))) / 2.0
    }
  }

  private func bucketAtRank(_ rank: Int) -> Int {
    var seen = 0
    for bucket in bucketCounts.indices {
      seen += bucketCounts[bucket]
      if seen > rank { return bucket }
    }
    return MAX_BUCKET
  }

  private static func percentBucket(_ percent: Double) -> Int {
    min(MAX_BUCKET, max(0, Int((percent * Double(BUCKET_SCALE)).rounded())))
  }

  private static func bucketPercent(_ bucket: Int) -> Double { Double(bucket) / Double(BUCKET_SCALE) }
}
