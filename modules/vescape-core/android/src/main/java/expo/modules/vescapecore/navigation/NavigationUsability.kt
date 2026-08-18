package expo.modules.vescapecore.navigation

import expo.modules.vescapecore.geo.GeoMath

/**
 * Whether a path Directions returned is worth drawing at all.
 *
 * Directions answers `200 OK` for targets nothing can actually reach: a Direction Point 800 m into
 * a forest has no routable way to it, so the router detours kilometres along the nearest road and
 * returns that with full confidence. Riding it is not what the rider asked for, and drawing it is
 * worse than drawing nothing.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationUsability.swift
 */
object NavigationUsability {
  /**
   * How much longer than the straight line a path may be before it is treated as no path at all.
   *
   * A starting heuristic, not a law: it is picked from how bad the forest case looks on a map and
   * is **unvalidated by real rides**. Expect to move it once riders report either a missing line
   * over a legitimate detour (too low) or a nonsense line through the next village (too high).
   */
  const val MAX_DETOUR_RATIO = 4.0

  /**
   * Below this the ratio stops meaning anything — standing 5 m from the pin makes any path that
   * rounds a building a 10x detour — so short paths are simply accepted.
   */
  private const val MIN_CHECKED_DIRECT_METERS = 50.0

  /** Path points as `(latitude, longitude)`, in the order they are ridden. */
  fun isUsable(
    points: List<Pair<Double, Double>>,
    targetLatitude: Double,
    targetLongitude: Double,
  ): Boolean {
    if (points.size < 2) return false
    val (originLatitude, originLongitude) = points.first()
    val direct =
      GeoMath.distanceMeters(originLatitude, originLongitude, targetLatitude, targetLongitude)
    if (direct < MIN_CHECKED_DIRECT_METERS) return true
    return pathLengthMeters(points) <= direct * MAX_DETOUR_RATIO
  }

  private fun pathLengthMeters(points: List<Pair<Double, Double>>): Double {
    var total = 0.0
    for (index in 1 until points.size) {
      val (previousLatitude, previousLongitude) = points[index - 1]
      val (latitude, longitude) = points[index]
      total += GeoMath.distanceMeters(previousLatitude, previousLongitude, latitude, longitude)
    }
    return total
  }
}
