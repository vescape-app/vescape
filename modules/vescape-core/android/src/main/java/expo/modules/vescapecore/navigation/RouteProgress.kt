package expo.modules.vescapecore.navigation

import expo.modules.vescapecore.geo.GeoMath
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * Where the rider is along their Navigation right now: the point on the path nearest to them, how
 * far is left along the path from there, and which way the path goes next.
 *
 * Derived, never stored. It is recomputed from the fixed path on every GPS Fix and it dies with the
 * Navigation it belongs to — see the glossary entry in `CONTEXT.md`. Nothing here recomputes or
 * reroutes the Navigation itself, which stays computed-once.
 *
 * Attachment is unconditional: the nearest point on the path is always taken, there is no off-route
 * state and no threshold. A rider who loops away and comes back re-attaches by itself. The accepted
 * cost is that on a path passing near itself — out-and-back, figure-eight — the projection can snap
 * between legs and [remainingMeters] can jump. Do not add a threshold to paper over it.
 *
 * @parity /modules/vescape-core/ios/navigation/RouteProgress.swift
 * @parity /modules/vescape-core/src/index.ts `RouteProgress`
 */
data class RouteProgress(
  /** The point on the path nearest to the rider, projected onto a segment rather than a vertex. */
  val latitude: Double,
  val longitude: Double,
  /**
   * Metres left to the Direction Point measured **along** the path from the projection: the rest of
   * the projected segment plus every segment after it. Not the straight line — a target 679 m away
   * across a river is the 2 km the rider actually has to ride.
   */
  val remainingMeters: Double,
  /**
   * Absolute degrees clockwise from north, from the projection to an aim point a short way further
   * along the path. Absolute on purpose: the wrist rotates a north-up world by the GPS course, so
   * one convention keeps the two rotations from disagreeing.
   */
  val bearingDeg: Double,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "latitude" to latitude,
    "longitude" to longitude,
    "remainingMeters" to remainingMeters,
    "bearingDeg" to bearingDeg,
  )

  companion object {
    /**
     * How far ahead on the path the aim point sits: `2.5 s` of travel, floored so a standing rider
     * still gets a usable direction and capped so a fast one is not aimed past the next turn.
     */
    const val AIM_SECONDS = 2.5
    const val MIN_AIM_METERS = 15.0
    const val MAX_AIM_METERS = 60.0

    /**
     * Route Progress for a rider at [riderLatitude]/[riderLongitude] along [points], which are
     * `(latitude, longitude)` in ridden order. Null when there is no path to attach to.
     *
     * [speedMps] comes from the fix and may be missing; the aim point falls back to its floor.
     */
    fun compute(
      points: List<Pair<Double, Double>>,
      riderLatitude: Double,
      riderLongitude: Double,
      speedMps: Double?,
    ): RouteProgress? {
      if (points.size < 2) return null

      // Point-to-segment, not point-to-vertex: on a long straight run between sparse vertices the
      // nearest vertex can be hundreds of metres from where the rider actually is.
      //
      // Distances are compared in a local flat frame — degrees with longitude squeezed by the
      // rider's latitude — because only the *ordering* of candidates matters here. The winning
      // projection is then measured on the great circle like everything else.
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

      // Walk forward from the projection until the aim budget runs out. Running off the end of the
      // path instead leaves the aim on the Direction Point, which is the right answer for the last
      // few metres of a ride.
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

      return RouteProgress(
        latitude = latitude,
        longitude = longitude,
        remainingMeters = remainingMeters,
        bearingDeg = GeoMath.travelBearingDeg(latitude, longitude, aimLatitude, aimLongitude),
      )
    }

    /** `max(15 m, 2.5 s x speed)`, capped at 60 m. A missing or nonsense speed takes the floor. */
    fun aimDistanceMeters(speedMps: Double?): Double {
      val speed = if (speedMps != null && speedMps.isFinite() && speedMps > 0) speedMps else 0.0
      return min(MAX_AIM_METERS, max(MIN_AIM_METERS, AIM_SECONDS * speed))
    }
  }
}
