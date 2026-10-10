import Foundation

/// GPS phase reported to JS in Live State. Native owns the phase; JS renders it and never infers
/// one from a boolean.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPhase.kt
/// @parity /modules/vescape-core/src/index.ts `GpsPhase`
internal enum GpsPhase: String {
  case idle
  case starting
  case active
  case error

  /// The one place the phase is decided, so both platforms answer the same for the same monitor
  /// state. `retained` means a location manager is held but updates may not run yet — the
  /// permission dialog is open, or the foreground service that arms the monitor is still starting.
  /// `updatesStarted` means location updates were actually requested and fixes can arrive.
  ///
  /// A standing error wins over everything: it is the same string `gpsLastError()` surfaces, so the
  /// phase and the error can never disagree.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPhase.kt `resolve`
  static func resolve(retained: Bool, updatesStarted: Bool, error: String?) -> GpsPhase {
    if error != nil { return .error }
    if updatesStarted { return .active }
    return retained ? .starting : .idle
  }
}
