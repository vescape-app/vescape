import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt
/// @parity /src/constants/theme.ts
enum Palette {
  static let primaryText = Color(red: 0.945, green: 0.961, blue: 0.976)
  static let secondaryText = Color(red: 0.580, green: 0.639, blue: 0.722)
  static let dimText = Color(red: 0.392, green: 0.455, blue: 0.545)
  static let guide = Color(red: 0.200, green: 0.255, blue: 0.333)
  static let speed = Color(red: 0.220, green: 0.741, blue: 0.973)
  static let duty = Color(red: 0.078, green: 0.722, blue: 0.651)
  static let motorTemp = Color(red: 0.937, green: 0.267, blue: 0.267)
  static let ctrlTemp = Color(red: 0.976, green: 0.451, blue: 0.086)
  static let battery = Color(red: 0.133, green: 0.773, blue: 0.369)
  static let warning = Color(red: 0.976, green: 0.451, blue: 0.086)
  static let critical = Color(red: 0.937, green: 0.267, blue: 0.267)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `TrailColor`
  /// @parity /src/constants/theme.ts `accentColors.dark.violet`
  static let trail = Color(red: 124.0 / 255, green: 111.0 / 255, blue: 239.0 / 255)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `NavColor`
  /// @parity /src/screens/main/map/NavigationMapLayers.tsx `NAVIGATION_ROUTE_COLOR`
  static let nav = Color(red: 0.659, green: 0.333, blue: 0.969)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `LightsColor`
  static let lights = Color(red: 0.961, green: 0.620, blue: 0.043)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `TiltColor`
  static let tilt = Color(red: 0.024, green: 0.714, blue: 0.831)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `ArmedColor`
  static let armed = Color(red: 0.961, green: 0.620, blue: 0.043)

  static let ambientText = Color(red: 0.722, green: 0.769, blue: 0.808)

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `weatherColor`
  static func weather(_ slug: String) -> Color {
    switch slug {
    case "sun": return Color(red: 0.984, green: 0.749, blue: 0.141)
    case "moon": return Color(red: 0.655, green: 0.545, blue: 0.980)
    case "cloud-sun": return Color(red: 0.961, green: 0.620, blue: 0.043)
    case "cloud-moon": return Color(red: 0.486, green: 0.435, blue: 0.937)
    case "cloud-fog": return Color(red: 0.796, green: 0.835, blue: 0.882)
    case "cloud-rain": return Color(red: 0.376, green: 0.647, blue: 0.980)
    case "cloud-snow": return Color(red: 0.729, green: 0.902, blue: 0.992)
    case "cloud-lightning": return Color(red: 0.753, green: 0.518, blue: 0.988)
    default: return Color(red: 0.580, green: 0.639, blue: 0.722)
    }
  }

  static func battery(for value: Double?) -> Color {
    guard let value else { return secondaryText }
    return value < WatchGauge.batteryWarningPercent ? warning : battery
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `telemetryLevelColor`
  static func level(_ level: TelemetryLevel) -> Color? {
    switch level {
    case .normal: return nil
    case .warning: return warning
    case .critical: return critical
    }
  }
}

extension Color {
  init(argb: UInt32) {
    self.init(
      .sRGB,
      red: Double((argb >> 16) & 0xFF) / 255,
      green: Double((argb >> 8) & 0xFF) / 255,
      blue: Double(argb & 0xFF) / 255,
      opacity: Double((argb >> 24) & 0xFF) / 255
    )
  }
}
