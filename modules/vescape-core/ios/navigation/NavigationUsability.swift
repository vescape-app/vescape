import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationUsability.kt
enum NavigationUsability {
  static let maxDetourRatio = 4.0

  private static let minCheckedDirectMeters = 50.0

  static func isUsable(
    _ points: [(latitude: Double, longitude: Double)],
    targetLatitude: Double,
    targetLongitude: Double
  ) -> Bool {
    guard points.count >= 2, let origin = points.first else { return false }
    let direct = GeoMath.distanceMeters(
      origin.latitude, origin.longitude, targetLatitude, targetLongitude
    )
    if direct < minCheckedDirectMeters { return true }
    return pathLengthMeters(points) <= direct * maxDetourRatio
  }

  private static func pathLengthMeters(_ points: [(latitude: Double, longitude: Double)]) -> Double {
    var total = 0.0
    for index in 1..<points.count {
      let previous = points[index - 1]
      let point = points[index]
      total += GeoMath.distanceMeters(
        previous.latitude, previous.longitude, point.latitude, point.longitude
      )
    }
    return total
  }
}
