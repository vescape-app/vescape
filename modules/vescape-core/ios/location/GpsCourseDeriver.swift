import Foundation

internal struct GpsCourse: Equatable {
  let bearingDeg: Double
  let sourceTimestamp: Int64
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsCourseDeriver.kt `GpsCourseDeriver`
/// @parity /modules/vescape-core/src/index.ts `LocationEvent`
internal final class GpsCourseDeriver {
  static let minSpeedMps = 0.8

  static let minDistanceM = 2.0

  static let retentionMs: Int64 = 10_000

  private var previousLatitude: Double?
  private var previousLongitude: Double?
  private var previousTimestamp: Int64?
  private var lastCourse: GpsCourse?

  func derive(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    timestamp: Int64
  ) -> GpsCourse? {
    let course = resolve(
      latitude: latitude,
      longitude: longitude,
      speedMps: speedMps,
      bearingDeg: bearingDeg,
      timestamp: timestamp
    )
    previousLatitude = latitude
    previousLongitude = longitude
    previousTimestamp = timestamp
    lastCourse = course
    return course
  }

  func reset() {
    previousLatitude = nil
    previousLongitude = nil
    previousTimestamp = nil
    lastCourse = nil
  }

  private func resolve(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    timestamp: Int64
  ) -> GpsCourse? {
    let moving = speedMps == nil || (speedMps ?? 0) >= Self.minSpeedMps
    if moving {
      if let reported = GeoMath.normalizeBearingDeg(bearingDeg) {
        return GpsCourse(bearingDeg: reported, sourceTimestamp: timestamp)
      }
      if let derived = derivedBearingDeg(latitude: latitude, longitude: longitude, timestamp: timestamp) {
        return GpsCourse(bearingDeg: derived, sourceTimestamp: timestamp)
      }
    }

    guard let retained = lastCourse else { return nil }
    guard timestamp - retained.sourceTimestamp <= Self.retentionMs else { return nil }
    return retained
  }

  private func derivedBearingDeg(latitude: Double, longitude: Double, timestamp: Int64) -> Double? {
    guard
      let fromLatitude = previousLatitude,
      let fromLongitude = previousLongitude,
      let fromTimestamp = previousTimestamp,
      fromTimestamp < timestamp,
      GeoMath.distanceMeters(fromLatitude, fromLongitude, latitude, longitude) >= Self.minDistanceM
    else { return nil }
    return GeoMath.travelBearingDeg(fromLatitude, fromLongitude, latitude, longitude)
  }
}
