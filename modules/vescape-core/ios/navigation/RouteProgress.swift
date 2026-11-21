import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RouteProgress.kt
/// @parity /modules/vescape-core/src/index.ts `RouteProgress`
struct RouteProgress: Equatable {
  let latitude: Double
  let longitude: Double
  let navigationRevision: Int64
  let segmentIndex: Int
  let segmentFraction: Double
  let deviationMeters: Double
  let remainingMeters: Double
  let remainingDurationSeconds: Double?
  let bearingDeg: Double

  static let aimSeconds = 2.5
  static let minAimMeters = 15.0
  static let maxAimMeters = 60.0

  func toMap() -> [String: Any] {
    [
      "latitude": latitude,
      "longitude": longitude,
      "navigationRevision": navigationRevision,
      "segmentIndex": segmentIndex,
      "segmentFraction": segmentFraction,
      "deviationMeters": deviationMeters,
      "remainingMeters": remainingMeters,
      "remainingDurationSeconds": remainingDurationSeconds.map { $0 as Any } ?? NSNull(),
      "bearingDeg": bearingDeg,
    ]
  }

  static func compute(
    points: [(latitude: Double, longitude: Double)],
    riderLatitude: Double,
    riderLongitude: Double,
    speedMps: Double?,
    navigationRevision: Int64 = 0,
    routeDistanceMeters: Double = 0,
    routeDurationSeconds: Double = 0
  ) -> RouteProgress? {
    guard points.count >= 2, let target = points.last else { return nil }

    let cosLatitude = cos(riderLatitude * .pi / 180)
    var bestIndex = 0
    var bestFraction = 0.0
    var bestDistanceSq = Double.greatestFiniteMagnitude
    for index in 0..<(points.count - 1) {
      let start = points[index]
      let end = points[index + 1]
      let startX = (start.longitude - riderLongitude) * cosLatitude
      let startY = start.latitude - riderLatitude
      let deltaX = (end.longitude - start.longitude) * cosLatitude
      let deltaY = end.latitude - start.latitude
      let lengthSq = deltaX * deltaX + deltaY * deltaY
      let fraction = lengthSq == 0
        ? 0.0
        : min(1.0, max(0.0, (-startX * deltaX - startY * deltaY) / lengthSq))
      let offsetX = startX + fraction * deltaX
      let offsetY = startY + fraction * deltaY
      let distanceSq = offsetX * offsetX + offsetY * offsetY
      if distanceSq < bestDistanceSq {
        bestDistanceSq = distanceSq
        bestIndex = index
        bestFraction = fraction
      }
    }

    let segmentStart = points[bestIndex]
    let segmentEnd = points[bestIndex + 1]
    let latitude = segmentStart.latitude
      + (segmentEnd.latitude - segmentStart.latitude) * bestFraction
    let longitude = segmentStart.longitude
      + (segmentEnd.longitude - segmentStart.longitude) * bestFraction

    var remainingMeters = GeoMath.distanceMeters(
      latitude, longitude, segmentEnd.latitude, segmentEnd.longitude
    )
    if bestIndex + 2 < points.count {
      for index in (bestIndex + 2)..<points.count {
        let previous = points[index - 1]
        let next = points[index]
        remainingMeters += GeoMath.distanceMeters(
          previous.latitude, previous.longitude, next.latitude, next.longitude
        )
      }
    }

    let remainingDurationSeconds: Double? = routeDistanceMeters.isFinite && routeDistanceMeters > 0
      && routeDurationSeconds.isFinite && routeDurationSeconds > 0
      ? routeDurationSeconds * min(1, max(0, remainingMeters / routeDistanceMeters)) : nil

    var aimLatitude = target.latitude
    var aimLongitude = target.longitude
    var fromLatitude = latitude
    var fromLongitude = longitude
    var budget = aimDistanceMeters(speedMps)
    if bestIndex + 1 < points.count {
      for index in (bestIndex + 1)..<points.count {
        let next = points[index]
        let segment = GeoMath.distanceMeters(
          fromLatitude, fromLongitude, next.latitude, next.longitude
        )
        if segment >= budget {
          let fraction = segment == 0 ? 0.0 : budget / segment
          aimLatitude = fromLatitude + (next.latitude - fromLatitude) * fraction
          aimLongitude = fromLongitude + (next.longitude - fromLongitude) * fraction
          break
        }
        budget -= segment
        fromLatitude = next.latitude
        fromLongitude = next.longitude
      }
    }

    let pastEndMeters = remainingMeters <= degenerateAimMeters
      ? GeoMath.distanceMeters(riderLatitude, riderLongitude, target.latitude, target.longitude)
      : 0
    if pastEndMeters > degenerateAimMeters {
      return RouteProgress(
        latitude: latitude,
        longitude: longitude,
        navigationRevision: navigationRevision,
        segmentIndex: bestIndex,
        segmentFraction: bestFraction,
        deviationMeters: GeoMath.distanceMeters(riderLatitude, riderLongitude, latitude, longitude),
        remainingMeters: pastEndMeters,
        remainingDurationSeconds: nil,
        bearingDeg: GeoMath.travelBearingDeg(
          riderLatitude, riderLongitude, target.latitude, target.longitude
        )
      )
    }

    let aimOffsetMeters = GeoMath.distanceMeters(latitude, longitude, aimLatitude, aimLongitude)
    let bearingDeg = aimOffsetMeters > degenerateAimMeters
      ? GeoMath.travelBearingDeg(latitude, longitude, aimLatitude, aimLongitude)
      : (lastLegBearingDeg(points) ?? 0)

    return RouteProgress(
      latitude: latitude,
      longitude: longitude,
      navigationRevision: navigationRevision,
      segmentIndex: bestIndex,
      segmentFraction: bestFraction,
      deviationMeters: GeoMath.distanceMeters(riderLatitude, riderLongitude, latitude, longitude),
      remainingMeters: remainingMeters,
      remainingDurationSeconds: remainingDurationSeconds,
      bearingDeg: bearingDeg
    )
  }

  private static let degenerateAimMeters = 0.01

  private static func lastLegBearingDeg(
    _ points: [(latitude: Double, longitude: Double)]
  ) -> Double? {
    for index in stride(from: points.count - 1, through: 1, by: -1) {
      let from = points[index - 1]
      let to = points[index]
      let length = GeoMath.distanceMeters(
        from.latitude, from.longitude, to.latitude, to.longitude
      )
      if length > degenerateAimMeters {
        return GeoMath.travelBearingDeg(from.latitude, from.longitude, to.latitude, to.longitude)
      }
    }
    return nil
  }

  static func aimDistanceMeters(_ speedMps: Double?) -> Double {
    let speed = (speedMps?.isFinite ?? false) && speedMps! > 0 ? speedMps! : 0
    return min(maxAimMeters, max(minAimMeters, aimSeconds * speed))
  }
}
