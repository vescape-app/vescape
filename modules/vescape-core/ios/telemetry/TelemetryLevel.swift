import Foundation

/// @parity /src/modules/board/constants/telemetryThresholds.ts `TelemetryLevel`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryLevel.kt `TelemetryLevel`
enum TelemetryLevel: UInt8, Comparable {
  case normal = 0
  case warning = 1
  case critical = 2

  init(wire: UInt8) { self = TelemetryLevel(rawValue: wire) ?? .normal }

  static func < (lhs: TelemetryLevel, rhs: TelemetryLevel) -> Bool { lhs.rawValue < rhs.rawValue }
}
