import Foundation

internal let alertBeepCountDefault = 3
internal func telemetryNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validUnitSystem`
/// @parity /src/helpers/units.ts `UnitSystem`
internal func validUnitSystem(_ value: Any?) -> String? {
  guard let units = value as? String, units == "metric" || units == "imperial" else { return nil }
  return units
}
