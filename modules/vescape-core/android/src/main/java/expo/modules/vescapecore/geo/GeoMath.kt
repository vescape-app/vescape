package expo.modules.vescapecore.geo

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Great-circle helpers shared by everything native that reasons about two positions.
 *
 * @parity /modules/vescape-core/ios/geo/GeoMath.swift
 */
object GeoMath {
  private const val EARTH_RADIUS_METERS = 6_371_000.0

  fun distanceMeters(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
  ): Double {
    val deltaLatitude = Math.toRadians(toLatitude - fromLatitude)
    val deltaLongitude = Math.toRadians(toLongitude - fromLongitude)
    val a = sin(deltaLatitude / 2) * sin(deltaLatitude / 2) +
      cos(Math.toRadians(fromLatitude)) * cos(Math.toRadians(toLatitude)) *
      sin(deltaLongitude / 2) * sin(deltaLongitude / 2)
    return 2 * EARTH_RADIUS_METERS * asin(min(1.0, sqrt(a)))
  }

  /** Initial great-circle bearing from one position to another, normalized to `[0, 360)`. */
  fun travelBearingDeg(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
  ): Double {
    val fromLatitudeRad = Math.toRadians(fromLatitude)
    val toLatitudeRad = Math.toRadians(toLatitude)
    val deltaLongitude = Math.toRadians(toLongitude - fromLongitude)
    val y = sin(deltaLongitude) * cos(toLatitudeRad)
    val x = cos(fromLatitudeRad) * sin(toLatitudeRad) -
      sin(fromLatitudeRad) * cos(toLatitudeRad) * cos(deltaLongitude)
    return normalizeBearingDeg(Math.toDegrees(atan2(y, x)))!!
  }

  /** `[0, 360)`, or null when the value is absent or not finite. */
  fun normalizeBearingDeg(value: Double?): Double? {
    if (value == null || !value.isFinite()) return null
    return ((value % 360) + 360) % 360
  }
}
