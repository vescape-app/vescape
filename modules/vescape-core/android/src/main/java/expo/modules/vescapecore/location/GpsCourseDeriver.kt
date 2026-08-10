package expo.modules.vescapecore.location

import expo.modules.vescapecore.geo.GeoMath

/**
 * A course the rider is actually travelling, derived per precise fix.
 *
 * `sourceTimestamp` is the fix the bearing came from, not the fix it was reported on: a retained
 * course keeps the older timestamp so callers can tell a fresh course from a held one.
 */
internal data class GpsCourse(
  val bearingDeg: Double,
  val sourceTimestamp: Long,
)

/**
 * Turns raw GPS fixes into a *reliable* course.
 *
 * A fix's own bearing is noise while standing still — a parked board spins the puck through every
 * heading — so it is only trusted above a walking pace, falls back to the line between the last two
 * fixes when the receiver reports no bearing, and is otherwise held briefly so a momentary stop at
 * a light does not throw the puck back to north.
 *
 * Feed precise fixes only, in time order. Stateful, one instance per location source.
 *
 * @parity /modules/vescape-core/ios/location/GpsCourseDeriver.swift `GpsCourseDeriver`
 * @platform-diff No `reset()`: Android's `LocationTracker` outlives every session and keeps its
 * latest fixes across disconnects, so there is no teardown to hang one off. iOS clears its fix
 * state on disconnect and resets the deriver with it.
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

  private fun resolve(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    timestamp: Long,
  ): GpsCourse? {
    // A missing speed is treated as moving: a receiver that reports no speed at all should still
    // steer the puck rather than never producing a course.
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
    /** Below roughly a walking pace the reported bearing is receiver noise. */
    const val MIN_SPEED_MPS = 0.8

    /** Two fixes closer than this describe GPS jitter, not travel. */
    const val MIN_DISTANCE_M = 2.0

    /** How long a course survives without a fix that can confirm it. */
    const val RETENTION_MS = 10_000L
  }
}
