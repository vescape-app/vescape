import Foundation

internal func telemetryNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validDistanceUnit`
/// @parity /src/helpers/units.ts `DistanceUnit`
internal func validDistanceUnit(_ value: Any?) -> String? {
  guard let units = value as? String, units == "km" || units == "mi" else { return nil }
  return units
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validTemperatureUnit`
/// @parity /modules/vescape-core/src/index.ts `TemperatureUnit`
internal func validTemperatureUnit(_ value: Any?) -> String? {
  guard let unit = value as? String, unit == "celsius" || unit == "fahrenheit" else { return nil }
  return unit
}
