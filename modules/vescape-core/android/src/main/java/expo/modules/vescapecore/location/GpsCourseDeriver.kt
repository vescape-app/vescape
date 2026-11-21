package expo.modules.vescapecore.location

import expo.modules.vescapecore.geo.GeoMath

internal data class GpsCourse(
  val bearingDeg: Double,
  val sourceTimestamp: Long,
)

/**
 * @parity /modules/vescape-core/ios/location/GpsCourseDeriver.swift `GpsCourseDeriver`
 * @parity /modules/vescape-core/src/index.ts `LocationEvent`
 */
internal class GpsCourseDeriver {
  private var previousLatitude: Double? = null
  private var previousLongitude: Double? = null
  private var previousTimestamp: Long? = null
  private var lastCourse: GpsCourse? = null

  fun derive(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    timestamp: Long,
  ): GpsCourse? {
    val course = resolve(latitude, longitude, speedMps, bearingDeg, timestamp)
    previousLatitude = latitude
    previousLongitude = longitude
    previousTimestamp = timestamp
    lastCourse = course
    return course
  }

  fun reset() {
    previousLatitude = null
    previousLongitude = null
    previousTimestamp = null
    lastCourse = null
  }

  private fun resolve(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    timestamp: Long,
  ): GpsCourse? {
    val moving = speedMps == null || speedMps >= MIN_SPEED_MPS
    if (moving) {
      GeoMath.normalizeBearingDeg(bearingDeg)?.let { return GpsCourse(it, timestamp) }
      derivedBearingDeg(latitude, longitude, timestamp)?.let { return GpsCourse(it, timestamp) }
    }

    val retained = lastCourse ?: return null
    if (timestamp - retained.sourceTimestamp > RETENTION_MS) return null
    return retained
  }

  private fun derivedBearingDeg(latitude: Double, longitude: Double, timestamp: Long): Double? {
    val fromLatitude = previousLatitude ?: return null
    val fromLongitude = previousLongitude ?: return null
    val fromTimestamp = previousTimestamp ?: return null
    if (fromTimestamp >= timestamp) return null
    if (GeoMath.distanceMeters(fromLatitude, fromLongitude, latitude, longitude) < MIN_DISTANCE_M) {
      return null
    }
    return GeoMath.travelBearingDeg(fromLatitude, fromLongitude, latitude, longitude)
  }

  companion object {
    const val MIN_SPEED_MPS = 0.8

    const val MIN_DISTANCE_M = 2.0

    const val RETENTION_MS = 10_000L
  }
}
