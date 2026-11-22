import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPhase.kt
/// @parity /modules/vescape-core/src/index.ts `GpsPhase`
internal enum GpsPhase: String {
  case idle
  case starting
  case active
  case error

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPhase.kt `resolve`
  static func resolve(retained: Bool, updatesStarted: Bool, error: String?) -> GpsPhase {
    if error != nil { return .error }
    if updatesStarted { return .active }
    return retained ? .starting : .idle
  }
}
