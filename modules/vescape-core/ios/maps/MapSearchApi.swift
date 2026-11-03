import Foundation

/// Failure codes crossing the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maps/MapSearchApi.kt `MapSearchApiException`
struct MapSearchApiError: Error {
  let code: String
  let message: String

  static let signInRequired = "MAP_SEARCH_SIGN_IN_REQUIRED"
  static let unavailable = "MAP_SEARCH_UNAVAILABLE"
}

/// Place search and reverse geocoding through the server's Mapbox proxy. The server keeps the
/// Mapbox secret and answers with Mapbox's body verbatim, so this hands the raw JSON to JS, which
/// owns the parsing. Native only owns the call because native owns the Device Token.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maps/MapSearchApi.kt
final class MapSearchApi {
  static let shared = MapSearchApi(api: VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl))

  private static let path = "/api/maps"

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  /// Mapbox Search Box forward body. `proximity` is `longitude,latitude`.
  func search(query: String, limit: Int, proximity: String?) async throws -> String {
    var params = ["q": query, "limit": String(limit)]
    if let proximity { params["proximity"] = proximity }
    return try Self.unwrap(await api.request(.get, path: "\(Self.path)/search", query: params, auth: .required) { $0 })
  }

  /// Mapbox Geocoding v5 reverse body (the server asks for one feature).
  func reverse(latitude: Double, longitude: Double) async throws -> String {
    let params = ["longitude": String(longitude), "latitude": String(latitude)]
    return try Self.unwrap(await api.request(.get, path: "\(Self.path)/reverse", query: params, auth: .required) { $0 })
  }

  private static func unwrap(_ result: ApiResult<String>) throws -> String {
    switch result {
    case .ok(let body): return body
    case .unauthorized: throw MapSearchApiError(code: MapSearchApiError.signInRequired, message: "Sign-in required")
    case .invalid(let error): throw MapSearchApiError(code: MapSearchApiError.unavailable, message: error)
    case .unavailable(let cause): throw MapSearchApiError(code: MapSearchApiError.unavailable, message: cause)
    case .cancelled: throw CancellationError()
    default: throw MapSearchApiError(code: MapSearchApiError.unavailable, message: String(describing: result))
    }
  }
}
