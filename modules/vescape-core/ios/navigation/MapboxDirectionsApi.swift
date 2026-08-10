import Foundation
import os

/// The app's only call to the Mapbox Directions API. It fetches one way-following geometry between
/// two coordinates and returns the decoded points; it holds no state and decides nothing about when
/// a Navigation exists — that is `NavigationController`'s job.
///
/// This does not go through `VescapeApi`: that boundary owns the Vescape backend's origin, Device
/// Credential and 401 policy, none of which apply to a third-party host authenticated by a baked
/// token.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt
final class MapboxDirectionsApi: DirectionsRoutes {
  /// Info.plist key holding the Mapbox access token, injected at prebuild time so native never
  /// depends on the JS runtime having started.
  /// @parity /plugins/withMapboxToken.ts `IOS_INFO_PLIST_KEY`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt `ACCESS_TOKEN_METADATA`
  static let accessTokenInfoKey = "VescapeMapboxAccessToken"

  /// Baked Mapbox access token, empty when prebuild ran without one.
  static var bakedAccessToken: String {
    (Bundle.main.object(forInfoDictionaryKey: accessTokenInfoKey) as? String) ?? ""
  }

  private static let baseUrl = "https://api.mapbox.com/directions/v5/mapbox"
  private static let callTimeoutSeconds: TimeInterval = 15
  private static let log = Logger(subsystem: "app.vescape.core", category: "MapboxDirectionsApi")

  private let accessToken: String
  private let session: URLSession

  init(accessToken: String) {
    self.accessToken = accessToken
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = Self.callTimeoutSeconds
    session = URLSession(configuration: configuration)
  }

  /// Points of the first returned route, or which way this failed. A missing token, a transport
  /// error and a non-2xx response are all `.failed` — the question never got a real answer. A 2xx
  /// carrying no route is `.noPath`: Mapbox answered, and the answer is that nothing leads there.
  ///
  /// Nothing is retried here; retrying is the rider's call.
  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> DirectionsResult {
    guard !accessToken.isEmpty else {
      Self.log.warning("No Mapbox access token baked in; skipping Directions call")
      return .failed
    }

    // Mapbox takes coordinates as `longitude,latitude` — the opposite order from `setDirectionPoint`.
    let coordinates = "\(fromLongitude),\(fromLatitude);\(toLongitude),\(toLatitude)"
    var components = URLComponents(string: "\(Self.baseUrl)/\(profile)/\(coordinates)")
    components?.queryItems = [
      URLQueryItem(name: "geometries", value: "polyline6"),
      URLQueryItem(name: "overview", value: "full"),
      URLQueryItem(name: "access_token", value: accessToken),
    ]
    guard let url = components?.url else { return .failed }

    do {
      let (data, response) = try await session.data(from: url)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        Self.log.warning("Directions call failed: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        return .failed
      }
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
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
    } catch {
      Self.log.warning("Directions call failed: \(error.localizedDescription, privacy: .public)")
      return .failed
    }
  }
}
