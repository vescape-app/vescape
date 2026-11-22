import Foundation
import os

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt
final class MapboxDirectionsApi: DirectionsRoutes {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt `PATH`
  private static let path = "/api/maps/directions"
  private static let log = Logger(subsystem: "app.vescape.core", category: "MapboxDirectionsApi")

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> DirectionsResult {
    let coordinates = [fromLongitude, fromLatitude, toLongitude, toLatitude]
      .map { String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), $0) }
    let path = "\(Self.path)/\(profile)/\(coordinates[0]),\(coordinates[1]);\(coordinates[2]),\(coordinates[3])"
    let result = await api.request(.get, path: path, auth: .required) {
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
    return .path(
      points: points,
      distanceMeters: (route["distance"] as? NSNumber)?.doubleValue ?? 0,
      durationSeconds: (route["duration"] as? NSNumber)?.doubleValue ?? 0
    )
  }
}
