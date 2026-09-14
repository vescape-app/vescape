import SwiftUI

/// Mirrors `src/constants/theme.ts` so the wrist matches the phone app, and `Palette.kt` so the two
/// wrists match each other. Colour is load-bearing here: it is what tells a rider which curved
/// number is the motor and which is the controller, and in ambient it is what separates a reading
/// the watch stands behind from one it is only still showing.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt
/// @parity /src/constants/theme.ts
enum Palette {
  static let primaryText = Color(red: 0.945, green: 0.961, blue: 0.976)  // slate.textPrimary #F1F5F9
  static let secondaryText = Color(red: 0.580, green: 0.639, blue: 0.722)  // slate.textSecondary #94A3B8
  static let dimText = Color(red: 0.392, green: 0.455, blue: 0.545)  // slate.textMuted #64748B
  static let guide = Color(red: 0.200, green: 0.255, blue: 0.333)  // slate.border #334155
  static let speed = Color(red: 0.220, green: 0.741, blue: 0.973)  // sky #38BDF8
  static let duty = Color(red: 0.078, green: 0.722, blue: 0.651)  // teal #14B8A6
  static let motorTemp = Color(red: 0.937, green: 0.267, blue: 0.267)  // red #EF4444
  static let ctrlTemp = Color(red: 0.976, green: 0.451, blue: 0.086)  // orange #F97316
  static let battery = Color(red: 0.133, green: 0.773, blue: 0.369)  // green #22C55E
  static let warning = Color(red: 0.976, green: 0.451, blue: 0.086)  // orange #F97316

  /// The one colour ambient invents: a dimmed near-white the always-on panel can hold cheaply.
  static let ambientText = Color(red: 0.722, green: 0.769, blue: 0.808)  // #B8C4CE

  /// The rider's chosen colour, resolved from the mirrored setting. Nil — unset, or a form this
  /// build cannot parse — leaves the caller on the wrist's own palette.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `parseRiderColor`
  static func rider(_ hex: String?) -> Color? {
    parseWatchRiderColor(hex).map { Color(red: $0.red, green: $0.green, blue: $0.blue) }
  }

  static func battery(for value: Double?) -> Color {
    guard let value else { return secondaryText }
    return value < WatchGauge.batteryWarningPercent ? warning : battery
  }
}
