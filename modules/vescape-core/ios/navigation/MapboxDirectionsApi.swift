import Foundation
import os

/// The app's only Directions call. It fetches one way-following geometry between two coordinates
/// through the server's Mapbox Directions proxy (`GET /api/maps/directions/:profile/:coordinates`,
/// body verbatim from Mapbox) and returns the decoded points; it holds no state and decides nothing
/// about when a Navigation exists — that is `NavigationController`'s job.
///
/// The proxy needs a Device Token, so a signed-out rider gets `.failed`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt
final class MapboxDirectionsApi: DirectionsRoutes {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt `PATH`
  private static let path = "/api/maps/directions"
  private static let log = Logger(subsystem: "app.vescape.core", category: "MapboxDirectionsApi")

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  /// Points of the first returned route, or which way this failed. No credential, a transport
  /// error, a rate limit, an unconfigured or unreachable upstream and any other non-2xx are all
  /// `.failed` — the question never got a real answer. A 2xx carrying no route is `.noPath`: Mapbox
  /// answered, and the answer is that nothing leads there.
  ///
  /// Nothing is retried here beyond the API boundary's own rule; retrying is the rider's call.
  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> DirectionsResult {
    // Mapbox takes coordinates as `longitude,latitude` — the opposite order from `setDirectionPoint`.
    let coordinates = "\(fromLongitude),\(fromLatitude);\(toLongitude),\(toLatitude)"
    let result = await api.request(.get, path: "\(Self.path)/\(profile)/\(coordinates)", auth: .required) {
      try Self.parse($0)
    }
    switch result {
    case .ok(let directions):
      return directions
    default:
      Self.log.warning("Directions call failed: \(String(describing: result), privacy: .public)")
      return .failed
    }
  }

  private static func parse(_ body: String) throws -> DirectionsResult {
    let json = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
    guard
      let routes = json?["routes"] as? [[String: Any]],
      let route = routes.first,
      let geometry = route["geometry"] as? String,
      !geometry.isEmpty
    else { return .noPath }

    let points = Polyline6.decode(geometry)
    guard !points.isEmpty else { return .noPath }
    // Mapbox reports both for the route it returned; they are the only length and time the app
    // ever shows, so nothing here recomputes them from the geometry.
    return .path(
      points: points,
      distanceMeters: (route["distance"] as? NSNumber)?.doubleValue ?? 0,
      durationSeconds: (route["duration"] as? NSNumber)?.doubleValue ?? 0
    )
  }
}
