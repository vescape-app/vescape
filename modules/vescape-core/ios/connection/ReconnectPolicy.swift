import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt
internal enum ReconnectPolicy {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `nextRetry`
  static func failureRetryDelayMs(attempt: Int, appForeground: Bool) -> Int {
    if !appForeground && attempt > slowAfterAttempts { return slowIdleMs }
    return min(attempt * 500, 5000)
  }

  static let rescanWindowMs = 4000
  static let foregroundIdleMs = 2000
  static let backgroundIdleMs = 12000

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `RECONNECT_SLOW_AFTER_ATTEMPTS`
  static let slowAfterAttempts = 12
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `RECONNECT_SLOW_BACKOFF_MS`
  static let slowIdleMs = 30000

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectPolicy.kt `nextRetry`
  static func rescanIdleMs(attempt: Int, appForeground: Bool) -> Int {
    if appForeground { return foregroundIdleMs }
    return attempt > slowAfterAttempts ? slowIdleMs : backgroundIdleMs
  }
}
