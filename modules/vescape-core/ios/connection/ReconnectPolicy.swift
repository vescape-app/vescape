import Foundation

/// Cadence of the supplemental rescan cycle that accelerates rediscovery of a dropped Board.
///
/// CoreBluetooth's persistent connect does the real reconnecting and costs nothing; this cycle only
/// shortens the time to notice a board that came back. That makes its cadence purely a power
/// decision, which is why it is allowed to relax into a slow tier where Android's — which is doing
/// the actual work — matches it attempt for attempt.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt
internal enum ReconnectPolicy {
  /// Active-scan window. Identical in both tiers: a window too short to hear an advertising board is
  /// not a cheaper scan, it is a wasted one.
  static let rescanWindowMs = 4000
  /// Gap between windows while the rider is watching. Never relaxes — they are looking at the phase
  /// and waiting for it to change.
  static let foregroundIdleMs = 2000
  /// Gap between windows with the phone away, while the drop still looks like a dropout.
  static let backgroundIdleMs = 12000

  /// Cycles spent chasing a board before the loop decides this is not a dropout.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `RECONNECT_SLOW_AFTER_ATTEMPTS`
  static let slowAfterAttempts = 12
  /// Gap once the loop is chasing a board that is almost certainly off. Still unbounded — a board
  /// left charging overnight reconnects when it comes back — but at a duty cycle a pocketed phone
  /// can afford.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `RECONNECT_SLOW_BACKOFF_MS`
  static let slowIdleMs = 30000

  /// Gap before the next active-scan window. `attempt` counts completed cycles this reconnect.
  ///
  /// Foreground never relaxes: the rider is looking at the phase and waiting for it to change.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `nextRetry`
  static func rescanIdleMs(attempt: Int, appForeground: Bool) -> Int {
    if appForeground { return foregroundIdleMs }
    return attempt > slowAfterAttempts ? slowIdleMs : backgroundIdleMs
  }
}
