import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsAccuracy.kt `MAX_RECORDING_ACCURACY_M`
internal let MAX_RECORDING_ACCURACY_M = 20.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt
/// @platform-diff Android additionally requires `GPS_PROVIDER` here, which iOS has no concept of.
/// The difference is confined to live classification and no longer reaches durable data: history
/// reads one shared, provider-independent rule on both platforms.
internal func isPreciseGpsFix(accuracyM: Double?) -> Bool {
  guard let accuracyM else { return false }
  return accuracyM <= MAX_RECORDING_ACCURACY_M
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `GPS_STALE_FIX_TIMEOUT_MS`
internal let GPS_STALE_FIX_TIMEOUT_S = 30.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `LAST_GPS_PERSIST_INTERVAL_MS`
internal let LAST_GPS_PERSIST_INTERVAL_MS: Int64 = 30_000
