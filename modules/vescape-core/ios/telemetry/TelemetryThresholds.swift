import Foundation

/// @parity /src/modules/board/constants/telemetryThresholds.ts `TELEMETRY_THRESHOLDS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryThresholds.kt `TelemetryThresholds`
enum TelemetryThresholds {
  static let batteryWarning = 0.3
  static let batteryCritical = 0.1
  static let tempWarning = 70.0
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

  static func heatLevel(motorTempC: Double?, ctrlTempC: Double?) -> TelemetryLevel {
    max(tempLevel(motorTempC), tempLevel(ctrlTempC))
  }
}
