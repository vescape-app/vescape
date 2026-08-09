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

  /// Points of the first returned route as `(latitude, longitude)`, or `nil` when the token is
  /// missing, the call fails, or Mapbox returns no route. A `nil` simply yields no Navigation:
  /// failure UI is a later slice, and this slice never retries.
  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> [(latitude: Double, longitude: Double)]? {
    guard !accessToken.isEmpty else {
      Self.log.warning("No Mapbox access token baked in; skipping Directions call")
      return nil
    }

    // Mapbox takes coordinates as `longitude,latitude` — the opposite order from `setDirectionPoint`.
    let coordinates = "\(fromLongitude),\(fromLatitude);\(toLongitude),\(toLatitude)"
    var components = URLComponents(string: "\(Self.baseUrl)/\(profile)/\(coordinates)")
    components?.queryItems = [
      URLQueryItem(name: "geometries", value: "polyline6"),
      URLQueryItem(name: "overview", value: "full"),
      URLQueryItem(name: "access_token", value: accessToken),
    ]
    guard let url = components?.url else { return nil }

    do {
      let (data, response) = try await session.data(from: url)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        Self.log.warning("Directions call failed: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        return nil
      }
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
      guard
        let routes = json?["routes"] as? [[String: Any]],
        let geometry = routes.first?["geometry"] as? String,
        !geometry.isEmpty
      else { return nil }

      let points = Polyline6.decode(geometry)
      return points.isEmpty ? nil : points
    } catch {
      Self.log.warning("Directions call failed: \(error.localizedDescription, privacy: .public)")
      return nil
    }
  }
}
