package expo.modules.vescapecore.navigation

import expo.modules.vescapecore.geo.GeoMath

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationUsability.swift
 */
object NavigationUsability {
  const val MAX_DETOUR_RATIO = 4.0

  private const val MIN_CHECKED_DIRECT_METERS = 50.0

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
