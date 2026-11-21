import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltStick.kt
enum WatchTiltStick {
  /// @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REMOTE_TILT_CENTER`
  static let center = 128
  private static let halfRange = 255 - center

  static func percent(value: Int) -> Double {
    Double(value - center) * 100 / Double(halfRange)
  }

  static func value(percent: Double) -> Int {
    let clamped = min(max(percent, -100), 100)
    return min(max(rounded(Double(center) + clamped / 100 * Double(halfRange)), 0), 255)
  }

  static func ratePercentPerSecond(
    deflection: Double,
    deadzone: Double,
    full: Double,
    ratePercent: Int
  ) -> Double {
    let magnitude = abs(deflection)
    guard magnitude > deadzone else { return 0 }
    let fraction = min(max((magnitude - deadzone) / (full - deadzone), 0), 1)
    return (deflection < 0 ? -1 : 1) * Double(ratePercent) * fraction * fraction
  }

  static func integrate(percent: Double, ratePercentPerSecond: Double, elapsedMs: Int64) -> Double {
    let step = min(max(elapsedMs, 0), maxStepMs)
    return min(max(percent + ratePercentPerSecond * Double(step) / 1000, -100), 100)
  }

  private static let maxStepMs: Int64 = 50

  static func rounded(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

  static func format(_ percent: Double) -> String {
    let whole = rounded(percent)
    return whole > 0 ? "+\(whole)%" : "\(whole)%"
  }
}
