import Foundation

/// The arithmetic behind the wrist's Tilt page, with no view attached: the Remote Tilt wire scale
/// the phone pad labels, and the drone-style rate stick that drives it.
///
/// Wrist-only on both platforms. It lives here, symlinked into `watch/watchos/` like
/// `WatchGauge.swift`, only so the SwiftPM package `test:ios` builds can test it.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltStick.kt
enum WatchTiltStick {
  /// Remote Tilt neutral on the Refloat 0..255 scale. A literal rather than `REMOTE_TILT_CENTER`:
  /// this file is compiled into the watch target, which has no board protocol.
  ///
  /// @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REMOTE_TILT_CENTER`
  static let center = 128
  private static let halfRange = 255 - center

  /// Signed percent of full tilt, the same scale the phone pad labels: +100 is 255, 0 is neutral.
  static func percent(value: Int) -> Double {
    Double(value - center) * 100 / Double(halfRange)
  }

  /// The wire value for `percent`, clamped to the range the stick can reach.
  static func value(percent: Double) -> Int {
    let clamped = min(max(percent, -100), 100)
    return min(max(rounded(Double(center) + clamped / 100 * Double(halfRange)), 0), 255)
  }

  /// A drone-style rate stick: deflection sets how fast tilt changes, not what it is. Letting go
  /// stops the change and leaves the value where it is.
  ///
  /// Nothing moves inside `deadzone`, so a thumb resting on the glass does not creep. Past it the
  /// rate rises with the square of the deflection — fine trims near the middle, the full
  /// `ratePercent` per second at `full` and beyond.
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

  /// Advance `percent` by `ratePercentPerSecond` over `elapsedMs`, held inside full tilt either way.
  ///
  /// One step never covers more than `maxStepMs`: a clock that stalls under a held thumb must not
  /// turn into one full-range jump sent as an absolute lock.
  static func integrate(percent: Double, ratePercentPerSecond: Double, elapsedMs: Int64) -> Double {
    let step = min(max(elapsedMs, 0), maxStepMs)
    return min(max(percent + ratePercentPerSecond * Double(step) / 1000, -100), 100)
  }

  private static let maxStepMs: Int64 = 50

  /// Nearest whole number, halves rounded up — Kotlin's `roundToInt`, so both wrists put a
  /// half-percent tilt on the same side of a notch and send the same byte for it.
  static func rounded(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

  /// Signed whole percent as the Tilt page and the gauges badge print it: `+12%`, `0%`, `-4%`.
  static func format(_ percent: Double) -> String {
    let whole = rounded(percent)
    return whole > 0 ? "+\(whole)%" : "\(whole)%"
  }
}
