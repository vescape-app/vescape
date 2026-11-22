package expo.modules.vescapecore.navigation

import expo.modules.vescapecore.geo.GeoMath
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * @parity /modules/vescape-core/ios/navigation/RouteProgress.swift
 * @parity /modules/vescape-core/src/index.ts `RouteProgress`
 */
data class RouteProgress(
  val latitude: Double,
  val longitude: Double,
  val navigationRevision: Long,
  val segmentIndex: Int,
  val segmentFraction: Double,
  val deviationMeters: Double,
  val remainingMeters: Double,
  val remainingDurationSeconds: Double?,
  val bearingDeg: Double,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "latitude" to latitude,
    "longitude" to longitude,
    "navigationRevision" to navigationRevision,
    "segmentIndex" to segmentIndex,
    "segmentFraction" to segmentFraction,
    "deviationMeters" to deviationMeters,
    "remainingMeters" to remainingMeters,
    "remainingDurationSeconds" to remainingDurationSeconds,
    "bearingDeg" to bearingDeg,
  )

  companion object {
    const val AIM_SECONDS = 2.5
    const val MIN_AIM_METERS = 15.0
    const val MAX_AIM_METERS = 60.0

    fun compute(
      points: List<Pair<Double, Double>>,
      riderLatitude: Double,
      riderLongitude: Double,
      speedMps: Double?,
      navigationRevision: Long = 0,
      routeDistanceMeters: Double = 0.0,
      routeDurationSeconds: Double = 0.0,
    ): RouteProgress? {
      if (points.size < 2) return null

      val cosLatitude = cos(Math.toRadians(riderLatitude))
      var bestIndex = 0
      var bestFraction = 0.0
      var bestDistanceSq = Double.MAX_VALUE
      for (index in 0 until points.size - 1) {
        val (startLatitude, startLongitude) = points[index]
        val (endLatitude, endLongitude) = points[index + 1]
        val startX = (startLongitude - riderLongitude) * cosLatitude
        val startY = startLatitude - riderLatitude
        val deltaX = (endLongitude - startLongitude) * cosLatitude
        val deltaY = endLatitude - startLatitude
        val lengthSq = deltaX * deltaX + deltaY * deltaY
        val fraction = if (lengthSq == 0.0) {
          0.0
        } else {
          ((-startX * deltaX - startY * deltaY) / lengthSq).coerceIn(0.0, 1.0)
        }
        val offsetX = startX + fraction * deltaX
        val offsetY = startY + fraction * deltaY
        val distanceSq = offsetX * offsetX + offsetY * offsetY
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq
          bestIndex = index
          bestFraction = fraction
        }
      }

      val (segmentStartLatitude, segmentStartLongitude) = points[bestIndex]
      val (segmentEndLatitude, segmentEndLongitude) = points[bestIndex + 1]
      val latitude = segmentStartLatitude + (segmentEndLatitude - segmentStartLatitude) * bestFraction
      val longitude =
        segmentStartLongitude + (segmentEndLongitude - segmentStartLongitude) * bestFraction

      var remainingMeters =
        GeoMath.distanceMeters(latitude, longitude, segmentEndLatitude, segmentEndLongitude)
      for (index in bestIndex + 2 until points.size) {
        val (previousLatitude, previousLongitude) = points[index - 1]
        val (nextLatitude, nextLongitude) = points[index]
        remainingMeters +=
          GeoMath.distanceMeters(previousLatitude, previousLongitude, nextLatitude, nextLongitude)
      }

      val remainingDurationSeconds = if (routeDistanceMeters.isFinite() && routeDistanceMeters > 0 &&
        routeDurationSeconds.isFinite() && routeDurationSeconds > 0) {
        routeDurationSeconds * (remainingMeters / routeDistanceMeters).coerceIn(0.0, 1.0)
      } else null

      val (targetLatitude, targetLongitude) = points.last()
      var aimLatitude = targetLatitude
      var aimLongitude = targetLongitude
      var fromLatitude = latitude
      var fromLongitude = longitude
      var budget = aimDistanceMeters(speedMps)
      for (index in bestIndex + 1 until points.size) {
        val (nextLatitude, nextLongitude) = points[index]
        val segment =
          GeoMath.distanceMeters(fromLatitude, fromLongitude, nextLatitude, nextLongitude)
        if (segment >= budget) {
          val fraction = if (segment == 0.0) 0.0 else budget / segment
          aimLatitude = fromLatitude + (nextLatitude - fromLatitude) * fraction
          aimLongitude = fromLongitude + (nextLongitude - fromLongitude) * fraction
          break
        }
        budget -= segment
        fromLatitude = nextLatitude
        fromLongitude = nextLongitude
      }

      val pastEndMeters = if (remainingMeters <= DEGENERATE_AIM_METERS) {
        GeoMath.distanceMeters(riderLatitude, riderLongitude, targetLatitude, targetLongitude)
      } else {
        0.0
      }
      if (pastEndMeters > DEGENERATE_AIM_METERS) {
        return RouteProgress(
          latitude = latitude,
          longitude = longitude,
          navigationRevision = navigationRevision,
          segmentIndex = bestIndex,
          segmentFraction = bestFraction,
          deviationMeters = GeoMath.distanceMeters(riderLatitude, riderLongitude, latitude, longitude),
          remainingMeters = pastEndMeters,
          remainingDurationSeconds = null,
          bearingDeg =
            GeoMath.travelBearingDeg(riderLatitude, riderLongitude, targetLatitude, targetLongitude),
        )
      }

      val aimOffsetMeters =
        GeoMath.distanceMeters(latitude, longitude, aimLatitude, aimLongitude)
      val bearingDeg = if (aimOffsetMeters > DEGENERATE_AIM_METERS) {
        GeoMath.travelBearingDeg(latitude, longitude, aimLatitude, aimLongitude)
      } else {
        lastLegBearingDeg(points) ?: 0.0
      }

      return RouteProgress(
        latitude = latitude,
        longitude = longitude,
        navigationRevision = navigationRevision,
        segmentIndex = bestIndex,
        segmentFraction = bestFraction,
        deviationMeters = GeoMath.distanceMeters(riderLatitude, riderLongitude, latitude, longitude),
        remainingMeters = remainingMeters,
        remainingDurationSeconds = remainingDurationSeconds,
        bearingDeg = bearingDeg,
      )
    }

    private const val DEGENERATE_AIM_METERS = 0.01

    private fun lastLegBearingDeg(points: List<Pair<Double, Double>>): Double? {
      for (index in points.size - 1 downTo 1) {
        val (fromLatitude, fromLongitude) = points[index - 1]
        val (toLatitude, toLongitude) = points[index]
        val length =
          GeoMath.distanceMeters(fromLatitude, fromLongitude, toLatitude, toLongitude)
        if (length > DEGENERATE_AIM_METERS) {
          return GeoMath.travelBearingDeg(fromLatitude, fromLongitude, toLatitude, toLongitude)
        }
      }
      return null
    }

    fun aimDistanceMeters(speedMps: Double?): Double {
      val speed = if (speedMps != null && speedMps.isFinite() && speedMps > 0) speedMps else 0.0
      return min(MAX_AIM_METERS, max(MIN_AIM_METERS, AIM_SECONDS * speed))
    }
  }
}
