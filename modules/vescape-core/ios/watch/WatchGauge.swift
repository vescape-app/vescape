import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
enum WatchGauge {
  static let speedMax = 50.0

  /// @parity /src/modules/board/constants/telemetry.ts `RIM_TEMP_RANGE`
  static let tempMin = 20.0
  static let tempMax = 100.0

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `BATTERY_WARNING_PERCENT`
  /// @parity /watch/watchos/BatteryComplicationView.swift
  static let batteryWarningPercent = 20.0

  static let dash = "—"

  static func speedFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: speedMax) }

  static func dutyFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: 100) }

  static func batteryFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: 100) }

  static func tempFraction(_ value: Double?) -> Double {
    (((value ?? tempMin) - tempMin) / (tempMax - tempMin)).clamped()
  }

  private static func fraction(_ value: Double, of max: Double) -> Double { (value / max).clamped() }

  static func hero(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind)
  }

  static func temp(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind, suffix: "°")
  }

  static func batteryPercent(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind, suffix: "%")
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `format`
  private static func whole(_ value: Double?, blind: Bool, suffix: String = "") -> String {
    guard !blind, let value, value.isFinite else { return dash }
    return String(format: "%.0f%@", value.rounded(.toNearestOrAwayFromZero), suffix)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/UnitPresentation.kt `distance`
  static func distance(_ meters: Double, distanceUnit: String = "km") -> String {
    UnitPresentation.distance(meters, distanceUnit: distanceUnit)
  }
}

extension Double {
  fileprivate func clamped() -> Double { Swift.min(Swift.max(self, 0), 1) }
}
