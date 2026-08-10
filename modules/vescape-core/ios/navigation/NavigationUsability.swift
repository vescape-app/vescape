import Foundation

/// Whether a path Directions returned is worth drawing at all.
///
/// Directions answers `200 OK` for targets nothing can actually reach: a Direction Point 800 m into
/// a forest has no routable way to it, so the router detours kilometres along the nearest road and
/// returns that with full confidence. Riding it is not what the rider asked for, and drawing it is
/// worse than drawing nothing.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationUsability.kt
enum NavigationUsability {
  /// How much longer than the straight line a path may be before it is treated as no path at all.
  ///
  /// A starting heuristic, not a law: it is picked from how bad the forest case looks on a map and
  /// is **unvalidated by real rides**. Expect to move it once riders report either a missing line
  /// over a legitimate detour (too low) or a nonsense line through the next village (too high).
  static let maxDetourRatio = 4.0

  /// Below this the ratio stops meaning anything — standing 5 m from the pin makes any path that
  /// rounds a building a 10x detour — so short paths are simply accepted.
  private static let minCheckedDirectMeters = 50.0

  private static let earthRadiusMeters = 6_371_000.0

  /// Path points as `(latitude, longitude)`, in the order they are ridden.
  static func isUsable(
    _ points: [(latitude: Double, longitude: Double)],
    targetLatitude: Double,
    targetLongitude: Double
  ) -> Bool {
    guard points.count >= 2, let origin = points.first else { return false }
    let direct = distanceMeters(
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
      total += distanceMeters(
        previous.latitude, previous.longitude, point.latitude, point.longitude
      )
    }
    return total
  }

  private static func distanceMeters(
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
}
