import Foundation

/// Where the rider is along their Navigation right now: the point on the path nearest to them, how
/// far is left along the path from there, and which way the path goes next.
///
/// Derived, never stored. It is recomputed from the fixed path on every GPS Fix and it dies with
/// the Navigation it belongs to — see the glossary entry in `CONTEXT.md`. Nothing here recomputes
/// or reroutes the Navigation itself, which stays computed-once.
///
/// Attachment is unconditional: the nearest point on the path is always taken, there is no
/// off-route state and no threshold. A rider who loops away and comes back re-attaches by itself.
/// The accepted cost is that on a path passing near itself — out-and-back, figure-eight — the
/// projection can snap between legs and `remainingMeters` can jump. Do not add a threshold to
/// paper over it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RouteProgress.kt
/// @parity /modules/vescape-core/src/index.ts `RouteProgress`
struct RouteProgress: Equatable {
  /// The point on the path nearest to the rider, projected onto a segment rather than a vertex.
  let latitude: Double
  let longitude: Double
  /// Metres left to the Direction Point measured **along** the path from the projection: the rest
  /// of the projected segment plus every segment after it. Not the straight line — a target 679 m
  /// away across a river is the 2 km the rider actually has to ride.
  let remainingMeters: Double
  /// Absolute degrees clockwise from north, from the projection to an aim point a short way further
  /// along the path. Absolute on purpose: the wrist rotates a north-up world by the GPS course, so
  /// one convention keeps the two rotations from disagreeing.
  let bearingDeg: Double

  /// How far ahead on the path the aim point sits: `2.5 s` of travel, floored so a standing rider
  /// still gets a usable direction and capped so a fast one is not aimed past the next turn.
  static let aimSeconds = 2.5
  static let minAimMeters = 15.0
  static let maxAimMeters = 60.0

  func toMap() -> [String: Any] {
    [
      "latitude": latitude,
      "longitude": longitude,
      "remainingMeters": remainingMeters,
      "bearingDeg": bearingDeg,
    ]
  }

  /// Route Progress for a rider at `riderLatitude`/`riderLongitude` along `points`, which are
  /// `(latitude, longitude)` in ridden order. Nil when there is no path to attach to.
  ///
  /// `speedMps` comes from the fix and may be missing; the aim point falls back to its floor.
  static func compute(
    points: [(latitude: Double, longitude: Double)],
    riderLatitude: Double,
    riderLongitude: Double,
    speedMps: Double?
  ) -> RouteProgress? {
    guard points.count >= 2, let target = points.last else { return nil }

    // Point-to-segment, not point-to-vertex: on a long straight run between sparse vertices the
    // nearest vertex can be hundreds of metres from where the rider actually is.
    //
    // Distances are compared in a local flat frame — degrees with longitude squeezed by the
    // rider's latitude — because only the *ordering* of candidates matters here. The winning
    // projection is then measured on the great circle like everything else.
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

    // Walk forward from the projection until the aim budget runs out. Running off the end of the
    // path instead leaves the aim on the Direction Point, which is the right answer for the last
    // few metres of a ride.
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

    return RouteProgress(
      latitude: latitude,
      longitude: longitude,
      remainingMeters: remainingMeters,
      bearingDeg: GeoMath.travelBearingDeg(latitude, longitude, aimLatitude, aimLongitude)
    )
  }

  /// `max(15 m, 2.5 s x speed)`, capped at 60 m. A missing or nonsense speed takes the floor.
  static func aimDistanceMeters(_ speedMps: Double?) -> Double {
    let speed = (speedMps?.isFinite ?? false) && speedMps! > 0 ? speedMps! : 0
    return min(maxAimMeters, max(minAimMeters, aimSeconds * speed))
  }
}
