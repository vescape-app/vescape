import Foundation

/// The arithmetic and the strings behind the wrist gauges, with no view attached.
///
/// Android keeps these as private helpers inside `FrameGauges.kt`, where they are only reachable
/// through a Compose tree. Pulled out here they are the part of the layout that actually has a
/// right answer — what fraction of an arc a reading fills, and what it reads as — so the rectangular
/// watchOS layout can differ from the circular one (docs/watchos.md) while the values stay
/// provably the same on both wrists.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
enum WatchGauge {
  /// Full-scale speed, km/h. Anything above pins the arc rather than rescaling it: a gauge that
  /// silently changes its range is worse than one that saturates.
  static let speedMax = 50.0

  /// Temperature arc range, °C. Below the floor the arc is empty, not negative.
  static let tempMin = 10.0
  static let tempMax = 80.0

  /// Below this the battery reading takes the warning colour, and keeps it into ambient.
  static let batteryWarningPercent = 20.0

  /// An empty lane reads as this, never as zero: a board that is not connected and a board sitting
  /// still are different things, and the wrist must not blur them.
  static let dash = "—"

  static func speedFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: speedMax) }

  static func dutyFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: 100) }

  static func batteryFraction(_ value: Double?) -> Double { fraction(value ?? 0, of: 100) }

  static func tempFraction(_ value: Double?) -> Double {
    (((value ?? tempMin) - tempMin) / (tempMax - tempMin)).clamped()
  }

  private static func fraction(_ value: Double, of max: Double) -> Double { (value / max).clamped() }

  /// Speed and duty heroes: whole numbers, no unit — the unit is its own label under them.
  static func hero(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind)
  }

  /// Temperatures carry the degree sign; the MOTOR/CTRL label says which is which.
  static func temp(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind, suffix: "°")
  }

  static func batteryPercent(_ value: Double?, blind: Bool = false) -> String {
    whole(value, blind: blind, suffix: "%")
  }

  /// Rounded half away from zero, not by `%.0f`. C's `printf` rounds half to *even*, so 18.5 would
  /// print as "18" here while Android's `String.format` — Java rounds HALF_UP — prints "19". Two
  /// wrists reading different numbers off the same frame is exactly what this file exists to stop,
  /// and it only shows up on the exact halves, which is why the rounding is pinned by a test.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `format`
  private static func whole(_ value: Double?, blind: Bool, suffix: String = "") -> String {
    guard !blind, let value, value.isFinite else { return dash }
    return String(format: "%.0f%@", value.rounded(.toNearestOrAwayFromZero), suffix)
  }
}

extension Double {
  fileprivate func clamped() -> Double { Swift.min(Swift.max(self, 0), 1) }
}
