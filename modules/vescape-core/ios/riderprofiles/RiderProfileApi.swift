import Foundation

/// Failure codes crossing the bridge.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `RiderProfileApiException`
/// @parity /modules/vescape-core/src/index.ts `RiderProfileErrorCode`
struct RiderProfileApiError: Error {
  let code: String
  let message: String

  static let signInRequired = "RIDER_PROFILE_SIGN_IN_REQUIRED"
  static let nickTaken = "RIDER_PROFILE_NICK_TAKEN"
  static let refused = "RIDER_PROFILE_REFUSED"
  static let unreachable = "RIDER_PROFILE_UNREACHABLE"
}

/// The signed-in Account's public Rider Profile (nick + nationality). Server-owned; native holds no
/// copy and only attaches the Device Token.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt
/// @parity /modules/vescape-core/src/index.ts `RiderProfile`
final class RiderProfileApi {
  static let shared = RiderProfileApi(api: VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl))

  private static let path = "/api/rider-profile"
  private static let nickTakenSlug = "nick-taken"

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  /// `nil` until the Account has picked a nick.
  func mine() async throws -> [String: Any?]? {
    try unwrap(
      await api.request(.get, path: Self.path, auth: .required) { body in
        let json = try Self.object(body)
        guard let profile = json["profile"] as? [String: Any] else { return nil }
        return try Self.profile(profile)
      }
    )
  }

  func save(nick: String, nationality: String?) async throws -> [String: Any?] {
    try unwrap(
      await api.request(
        .put,
        path: Self.path,
        body: ["nick": nick, "nationality": nationality ?? NSNull()],
        auth: .required
      ) { try Self.profile(try Self.object($0)) }
    )
  }

  private static func object(_ body: String) throws -> [String: Any] {
    guard let data = body.data(using: .utf8),
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable response") }
    return json
  }

  private static func profile(_ json: [String: Any]) throws -> [String: Any?] {
    guard let accountId = json["accountId"] as? String, let nick = json["nick"] as? String
    else {
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable Rider Profile")
    }
    return ["accountId": accountId, "nick": nick, "nationality": json["nationality"] as? String]
  }

  private func unwrap<T>(_ result: ApiResult<T>) throws -> T {
    switch result {
    case .ok(let value): return value
    case .unauthorized:
      throw RiderProfileApiError(code: RiderProfileApiError.signInRequired, message: "Sign-in required")
    case .forbidden, .notFound:
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Rider Profile refused")
    case .invalid(let error):
      let code = error == Self.nickTakenSlug ? RiderProfileApiError.nickTaken : RiderProfileApiError.refused
      throw RiderProfileApiError(code: code, message: error)
    case .malformed(let cause):
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: cause)
    case .unavailable(let cause):
      throw RiderProfileApiError(code: RiderProfileApiError.unreachable, message: cause)
    case .cancelled:
      throw CancellationError()
    }
  }
}
