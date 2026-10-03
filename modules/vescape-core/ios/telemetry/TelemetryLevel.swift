import Foundation

/// How alarming a telemetry reading is. Ordered, so the worse of two levels is their `max`. The raw
/// value is its value in the Group Ride Frame; a value this build does not know reads as `.normal`.
///
/// `watch/watchos/` symlinks this file beside the Group Ride Frame codec that carries it.
///
/// @parity /src/modules/board/constants/telemetryThresholds.ts `TelemetryLevel`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryLevel.kt `TelemetryLevel`
enum TelemetryLevel: UInt8, Comparable {
  case normal = 0
  case warning = 1
  case critical = 2

  init(wire: UInt8) { self = TelemetryLevel(rawValue: wire) ?? .normal }

  static func < (lhs: TelemetryLevel, rhs: TelemetryLevel) -> Bool { lhs.rawValue < rhs.rawValue }
}
