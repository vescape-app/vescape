package expo.modules.vescapecore.telemetry

import kotlin.math.cos
import expo.modules.vescapecore.database.PrivacyZoneEntity

private const val METERS_PER_E7_LATITUDE = 0.0111319

// @parity /modules/vescape-core/ios/telemetry/PrivacyZoneFilter.swift
internal fun isInsideAnyPrivacyZone(
  latitudeE7: Int,
  longitudeE7: Int,
  zones: List<PrivacyZoneEntity>,
): Boolean = zones.any { isInsidePrivacyZone(latitudeE7, longitudeE7, it) }

internal fun isInsidePrivacyZone(
  latitudeE7: Int,
  longitudeE7: Int,
  zone: PrivacyZoneEntity,
): Boolean {
  val dLatM = (latitudeE7 - zone.centerLatitudeE7).toDouble() * METERS_PER_E7_LATITUDE
  val cosLat = cos(Math.toRadians(latitudeE7 / 1e7))
  val dLonM = (longitudeE7 - zone.centerLongitudeE7).toDouble() * METERS_PER_E7_LATITUDE * cosLat
  val distSq = dLatM * dLatM + dLonM * dLonM
  val radiusSq = zone.radiusMeters.toDouble() * zone.radiusMeters.toDouble()
  return distSq <= radiusSq
}
