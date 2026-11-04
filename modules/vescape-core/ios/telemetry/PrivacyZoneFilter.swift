import Foundation

/// A user-defined Privacy Zone: a circular area (center + radius) inside which recorded GPS fixes
/// and their telemetry samples are dropped. Coordinates are e7-scaled integers to match the
/// stored column shapes and Android's `PrivacyZoneEntity`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `PrivacyZoneEntity`
internal struct PrivacyZoneEntity {
  let id: String
  let enabled: Bool
  let centerLatitudeE7: Int
  let centerLongitudeE7: Int
  let radiusMeters: Int
}

private let METERS_PER_E7_LATITUDE = 0.0111319

/// Pure geometry: whether an e7 coordinate falls inside any of the given zones. Ported directly
/// from Android; the equirectangular approximation (flat-earth over a small radius, latitude
/// scaled by `cos`) matches Android exactly so both platforms drop the same fixes.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PrivacyZoneFilter.kt
internal func isInsideAnyPrivacyZone(
  latitudeE7: Int,
  longitudeE7: Int,
  zones: [PrivacyZoneEntity]
) -> Bool {
  zones.contains { isInsidePrivacyZone(latitudeE7: latitudeE7, longitudeE7: longitudeE7, zone: $0) }
}

internal func isInsidePrivacyZone(
  latitudeE7: Int,
  longitudeE7: Int,
  zone: PrivacyZoneEntity
) -> Bool {
  let dLatM = Double(latitudeE7 - zone.centerLatitudeE7) * METERS_PER_E7_LATITUDE
  let cosLat = cos(Double(latitudeE7) / 1e7 * .pi / 180.0)
  let dLonM = Double(longitudeE7 - zone.centerLongitudeE7) * METERS_PER_E7_LATITUDE * cosLat
  let distSq = dLatM * dLatM + dLonM * dLonM
  let radiusSq = Double(zone.radiusMeters) * Double(zone.radiusMeters)
  return distSq <= radiusSq
}
