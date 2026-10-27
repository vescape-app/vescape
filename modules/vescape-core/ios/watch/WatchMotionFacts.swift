import Foundation

/// Measured facts only. Two Float32 lanes encode each integer millisecond exactly.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMotionFacts.kt
struct WatchMotionFacts: Equatable {
  var sourceId: Double, fixTimestamp: Double, sentAt: Double
  var gpsAgeMs: Double, boardAgeMs: Double, accuracyM: Double
  var clockRate = 1.0
  var lanes: [Double] {
    [sourceId, fixTimestamp, sentAt].flatMap { [floor($0 / 1048576), $0.truncatingRemainder(dividingBy: 1048576)] } + [gpsAgeMs, boardAgeMs, accuracyM, clockRate]
  }
  static func decode(_ lanes: [Double]) -> WatchMotionFacts? {
    guard lanes.count == 10, lanes.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
    return WatchMotionFacts(sourceId: lanes[0] * 1048576 + lanes[1], fixTimestamp: lanes[2] * 1048576 + lanes[3], sentAt: lanes[4] * 1048576 + lanes[5], gpsAgeMs: lanes[6], boardAgeMs: lanes[7], accuracyM: lanes[8], clockRate: min(100, max(0.1, lanes[9])))
  }
}

/// Minimum observed receive-send offset removes arbitrary clock skew. Subsequent excess delay ages
/// both inputs. The first frame's one-way latency is unknowable without clock sync.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMotionFacts.kt `WatchMotionClock`
final class WatchMotionClock {
  private var source = -1.0, lastSent = -Double.infinity, offset = Double.infinity
  func accept(_ facts: WatchMotionFacts, now: Double) -> Double? {
    guard facts.sourceId >= source, facts.sourceId != source || facts.sentAt > lastSent else { return nil }
    if facts.sourceId > source { source = facts.sourceId; lastSent = -.infinity; offset = .infinity }
    lastSent = facts.sentAt; offset = min(offset, now - facts.sentAt)
    return max(0, now - facts.sentAt - offset)
  }
}
