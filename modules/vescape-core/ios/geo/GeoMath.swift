import Foundation

/// Great-circle helpers shared by everything native that reasons about two positions.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/geo/GeoMath.kt
internal enum GeoMath {
  private static let earthRadiusMeters = 6_371_000.0

  static func distanceMeters(
    _ fromLatitude: Double,
    _ fromLongitude: Double,
    _ toLatitude: Double,
    _ toLongitude: Double
  ) -> Double {
    let deltaLatitude = (toLatitude - fromLatitude) * .pi / 180
    let deltaLongitude = (toLongitude - fromLongitude) * .pi / 180
    let a = sin(deltaLatitude / 2) * sin(deltaLatitude / 2)
      + cos(fromLatitude * .pi / 180) * cos(toLatitude * .pi / 180)
      * sin(deltaLongitude / 2) * sin(deltaLongitude / 2)
    return 2 * earthRadiusMeters * asin(min(1.0, sqrt(a)))
  }

  /// Initial great-circle bearing from one position to another, normalized to `[0, 360)`.
  static func travelBearingDeg(
    _ fromLatitude: Double,
    _ fromLongitude: Double,
    _ toLatitude: Double,
    _ toLongitude: Double
  ) -> Double {
    let fromLatitudeRad = fromLatitude * .pi / 180
    let toLatitudeRad = toLatitude * .pi / 180
    let deltaLongitude = (toLongitude - fromLongitude) * .pi / 180
    let y = sin(deltaLongitude) * cos(toLatitudeRad)
    let x = cos(fromLatitudeRad) * sin(toLatitudeRad)
      - sin(fromLatitudeRad) * cos(toLatitudeRad) * cos(deltaLongitude)
    return normalizeBearingDeg(atan2(y, x) * 180 / .pi) ?? 0
  }

  /// `[0, 360)`, or nil when the value is absent or not finite.
  static func normalizeBearingDeg(_ value: Double?) -> Double? {
    guard let value, value.isFinite else { return nil }
    return ((value.truncatingRemainder(dividingBy: 360)) + 360)
      .truncatingRemainder(dividingBy: 360)
  }
}
