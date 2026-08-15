import Foundation

/// The source of "now" for one Board Session.
///
/// Every timestamp a session stamps onto data it produces — telemetry `lastPacketAt`, BMS captures,
/// GPS fix times — and every comparison against those timestamps (staleness, live-window pruning,
/// chart decimation) reads this clock rather than `Date()` directly. A real session runs on
/// `SystemSessionClock` and is bit-for-bit unchanged; a replay swaps in a clock that can sit in the
/// past, which is what lets it fast-forward without collapsing the timeline it writes.
///
/// The rule is deliberately all-or-nothing: mixing wall time and session time inside one session
/// produces data that disagrees with the code reading it. Real elapsed-time throttles that guard a
/// resource rather than describe the ride stay on wall time — but a throttle whose *rate* should
/// track the data feeding it divides its interval by `speed`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/SessionClock.kt
internal protocol SessionClock: AnyObject {
  func nowMs() -> Int64

  /// How fast session time is currently running against real time. Always 1.0 for a real session; a
  /// replay warming up its live window runs faster.
  ///
  /// Consumers that emit on a wall-clock interval — the bridge throttles in `LiveSeriesEmitter` —
  /// divide by this so their cadence tracks the rate of the data rather than emitting one enormous
  /// batch per interval.
  var speed: Double { get }
}

extension SessionClock {
  var speed: Double { 1.0 }
}

/// Wall time, unshifted: what every session that is not a replay runs on.
internal final class SystemSessionClock: SessionClock {
  static let shared = SystemSessionClock()

  func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}
