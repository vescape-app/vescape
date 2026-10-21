import Foundation

/// The app's battery and temperature tiers, as native needs them for other Riders on the wrist.
/// Battery is low-is-bad, temperature high-is-bad; a reading exactly on a threshold is still the
/// milder level, and no reading is `.normal`.
///
/// Phone-only: the wrist gets the levels already resolved in the Group Ride Frame.
///
/// @parity /src/modules/board/constants/telemetryThresholds.ts `TELEMETRY_THRESHOLDS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryThresholds.kt `TelemetryThresholds`
enum TelemetryThresholds {
  /// Battery SoC as a 0-1 fraction: below this is a warning.
  static let batteryWarning = 0.3
  /// Battery SoC as a 0-1 fraction: below this is critical.
  static let batteryCritical = 0.1
  /// °C: above this is a warning.
  static let tempWarning = 70.0
  /// °C: above this is critical.
  static let tempCritical = 80.0

  /// @parity /src/modules/board/constants/telemetryThresholds.ts `batteryLevel`
  static func batteryLevel(_ soc: Double?) -> TelemetryLevel {
    guard let soc else { return .normal }
    if soc < batteryCritical { return .critical }
    if soc < batteryWarning { return .warning }
    return .normal
  }

  /// @parity /src/modules/board/constants/telemetryThresholds.ts `tempLevel`
  static func tempLevel(_ tempC: Double?) -> TelemetryLevel {
    guard let tempC else { return .normal }
    if tempC > tempCritical { return .critical }
    if tempC > tempWarning { return .warning }
    return .normal
  }

  /// A Rider's heat: the worse of their motor and controller temperature.
  static func heatLevel(motorTempC: Double?, ctrlTempC: Double?) -> TelemetryLevel {
    max(tempLevel(motorTempC), tempLevel(ctrlTempC))
  }
}
