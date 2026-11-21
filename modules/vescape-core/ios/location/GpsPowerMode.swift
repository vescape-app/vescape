import CoreLocation
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt
/// @parity /modules/vescape-core/src/index.ts `GpsPowerMode`
internal enum GpsPowerMode: String {
  case off
  case map
  case ride
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt `GPS_MAP_MIN_DISTANCE_M`
internal let GPS_MAP_MIN_DISTANCE_M = 5.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt `RIDE_DROPOUT_GRACE_MS`
internal let RIDE_DROPOUT_GRACE_MS: Int64 = 120_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt `GpsDemand`
internal enum GpsDemand {
  static func resolve(
    appVisible: Bool,
    riding: Bool,
    watchNavigating: Bool,
    replayOwnsPosition: Bool,
    manualPublicRide: Bool
  ) -> GpsPowerMode {
    if replayOwnsPosition { return .off }
    if riding || watchNavigating || manualPublicRide { return .ride }
    if appVisible { return .map }
    return .off
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt `ridingThroughDropout`
  static func ridingThroughDropout(linkLostAtMs: Int64?, nowMs: Int64) -> Bool {
    guard let linkLostAtMs else { return true }
    return nowMs - linkLostAtMs < RIDE_DROPOUT_GRACE_MS
  }
}
