import Foundation

/// A course the rider is actually travelling, derived per precise fix.
///
/// `sourceTimestamp` is the fix the bearing came from, not the fix it was reported on: a retained
/// course keeps the older timestamp so callers can tell a fresh course from a held one.
internal struct GpsCourse: Equatable {
  let bearingDeg: Double
  let sourceTimestamp: Int64
}

/// Turns raw GPS fixes into a *reliable* course.
///
/// A fix's own bearing is noise while standing still — a parked board spins the puck through every
/// heading — so it is only trusted above a walking pace, falls back to the line between the last two
/// fixes when the receiver reports no bearing, and is otherwise held briefly so a momentary stop at
/// a light does not throw the puck back to north.
///
/// Feed precise fixes only, in time order. Stateful, one instance per location source.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsCourseDeriver.kt `GpsCourseDeriver`
/// @platform-diff `reset()` is iOS-only: `LocationTracker` drops the replay's fixes when a
/// replay session ends and clears the deriver with them, so a recorded course cannot bend the first
/// live one. Android's `LocationTracker` outlives every session and keeps both.
/// @parity /modules/vescape-core/src/index.ts `LocationEvent`
internal final class GpsCourseDeriver {
  /// Below roughly a walking pace the reported bearing is receiver noise.
  static let minSpeedMps = 0.8

  /// Two fixes closer than this describe GPS jitter, not travel.
  static let minDistanceM = 2.0

  /// How long a course survives without a fix that can confirm it.
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
    // A missing speed is treated as moving: a receiver that reports no speed at all should still
    // steer the puck rather than never producing a course.
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
