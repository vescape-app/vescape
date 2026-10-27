import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/UnitPresentation.kt
/// @parity /src/helpers/units.ts
internal enum UnitPresentation {
  static let metersPerMile = 1609.344
  static func speedFromKmh(_ kmh: Double, _ distanceUnit: String) -> Double {
    distanceUnit == "mi" ? kmh * 1000 / metersPerMile : kmh
  }
  static func speedUnit(_ distanceUnit: String) -> String { distanceUnit == "mi" ? "mph" : "km/h" }
  static func formatSpokenSpeed(_ kmh: Double, _ distanceUnit: String) -> String {
    let value = speedFromKmh(kmh, distanceUnit).rounded(.toNearestOrAwayFromZero)
    return String(format: "%.0f", locale: Locale(identifier: "en_US_POSIX"), value)
  }
  static func distance(_ meters: Double, distanceUnit: String) -> String {
    guard meters.isFinite else { return "—" }
    let miles = distanceUnit == "mi"
    let short = miles ? meters / metersPerMile < 0.1 : meters < 1000
    let value = miles ? meters / metersPerMile * (short ? 5280 : 1) : meters / (short ? 1 : 1000)
    let unit = miles ? (short ? "ft" : "mi") : (short ? "m" : "km")
    let scale = short ? 1.0 : 10.0
    return String(format: short ? "%.0f %@" : "%.1f %@", locale: Locale(identifier: "en_US_POSIX"), (value * scale).rounded(.toNearestOrAwayFromZero) / scale, unit)
  }
}
