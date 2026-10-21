import Foundation

/// Failure codes crossing the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `MapPointApiException`
/// @parity /modules/vescape-core/src/index.ts `MapPointErrorCode`
struct MapPointApiError: Error {
  let code: String
  let message: String

  static let signInRequired = "MAP_POINT_SIGN_IN_REQUIRED"
  static let notYours = "MAP_POINT_NOT_YOURS"
  static let gone = "MAP_POINT_GONE"
  static let refused = "MAP_POINT_REFUSED"
  static let unreachable = "MAP_POINT_UNREACHABLE"
}

/// Map Points live on the server (`docs/adr/0009-map-points-are-server-owned.md` in the server
/// repo). This is the only place the app talks to that API: reads are public and gain `ownedByMe` /
/// `myReaction` when a Device Token exists, writes require one.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt
/// @parity /modules/vescape-core/src/index.ts `MapPoint`
final class MapPointApi {
  static let shared = MapPointApi(api: VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl))

  private static let path = "/map-points"
  private static let writableFields = ["category", "latitude", "longitude", "name", "description"]

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  func nearby(
    latitude: Double,
    longitude: Double,
    radiusMeters: Int
  ) async throws -> [String: Any?] {
    try unwrap(
      await api.request(
        .get,
        path: Self.path,
        query: [
          "latitude": String(latitude),
          "longitude": String(longitude),
          "radiusMeters": String(radiusMeters),
        ],
        auth: .optional
      ) { body in
        let json = try Self.object(body)
        let items = json["items"] as? [[String: Any]] ?? []
        return [
          "items": try items.map { try Self.mapPoint($0) },
          "truncated": json["truncated"] as? Bool ?? false,
        ]
      }
    )
  }

  func create(_ values: [String: Any?]) async throws -> [String: Any?] {
    try unwrap(
      await api.request(.post, path: Self.path, body: Self.payload(values), auth: .required) {
        try Self.mapPoint(try Self.object($0))
      }
    )
  }

  func update(_ id: String, patch: [String: Any?]) async throws -> [String: Any?] {
    try unwrap(
      await api.request(
        .patch,
        path: "\(Self.path)/\(id)",
        body: Self.payload(patch),
        auth: .required
      ) { try Self.mapPoint(try Self.object($0)) }
    )
  }

  func delete(_ id: String) async throws {
    try unwrap(await api.request(.delete, path: "\(Self.path)/\(id)", auth: .required) { _ in () })
  }

  /// `nil` removes the reaction; the server keeps at most one per Account and Map Point.
  func setReaction(_ id: String, reaction: String?) async throws {
    let path = "\(Self.path)/\(id)/reaction"
    let result: ApiResult<Void>
    if let reaction {
      result = await api.request(
        .put,
        path: path,
        body: ["reaction": reaction],
        auth: .required
      ) { _ in () }
    } else {
      result = await api.request(.delete, path: path, auth: .required) { _ in () }
    }
    try unwrap(result)
  }

  /// Only the fields the caller set are sent: a patch without `name` must not clear the name.
  private static func payload(_ values: [String: Any?]) -> [String: Any] {
    var body: [String: Any] = [:]
    for field in writableFields where values.index(forKey: field) != nil {
      body[field] = values[field].flatMap { $0 } ?? NSNull()
    }
    return body
  }

  private static func object(_ body: String) throws -> [String: Any] {
    guard let data = body.data(using: .utf8),
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw MapPointApiError(code: MapPointApiError.refused, message: "Unreadable response") }
    return json
  }

  private static func mapPoint(_ json: [String: Any]) throws -> [String: Any?] {
    guard let id = json["id"] as? String,
          let category = json["category"] as? String,
          let latitude = json["latitude"] as? Double,
          let longitude = json["longitude"] as? Double,
          let score = json["score"] as? Int,
          let ownedByMe = json["ownedByMe"] as? Bool,
          let distanceMeters = json["distanceMeters"] as? Int,
          let createdAt = json["createdAt"] as? String,
          let updatedAt = json["updatedAt"] as? String
    else { throw MapPointApiError(code: MapPointApiError.refused, message: "Unreadable Map Point") }
    return [
      "id": id,
      "category": category,
      "latitude": latitude,
      "longitude": longitude,
      "name": json["name"] as? String,
      "description": json["description"] as? String,
      "score": score,
      "myReaction": json["myReaction"] as? String,
      "ownedByMe": ownedByMe,
      "distanceMeters": distanceMeters,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
    ]
  }

  private func unwrap<T>(_ result: ApiResult<T>) throws -> T {
    switch result {
    case .ok(let value): return value
    case .unauthorized:
      throw MapPointApiError(code: MapPointApiError.signInRequired, message: "Sign-in required")
    case .forbidden:
      throw MapPointApiError(
        code: MapPointApiError.notYours,
        message: "Map Point belongs to someone else"
      )
    case .notFound:
      throw MapPointApiError(code: MapPointApiError.gone, message: "Map Point no longer exists")
    case .invalid(let error):
      throw MapPointApiError(code: MapPointApiError.refused, message: error)
    case .malformed(let cause):
      throw MapPointApiError(code: MapPointApiError.refused, message: cause)
    case .unavailable(let cause):
      throw MapPointApiError(code: MapPointApiError.unreachable, message: cause)
    case .cancelled:
      throw CancellationError()
    }
  }
}
