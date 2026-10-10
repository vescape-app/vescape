import Foundation

/// Device Token lifecycle: verify a freshly exchanged credential, store it, revoke it. The HTTP
/// boundary itself belongs to `VescapeApi` so every native caller shares one credential and one 401
/// policy.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/auth/NativeAuthCoordinator.kt
final class NativeAuthCoordinator {
  static let shared = NativeAuthCoordinator()
  private let store = DeviceCredentialStore.shared

  private static let accountPath = "/api/account"
  private static let revokePath = "/api/auth/device-tokens/current"

  func stateMap() throws -> [String: Any?] {
    let credential = try store.read()
    return [
      "state": store.state(credential: credential).rawValue,
      "accountId": credential?.accountId,
      "expiresAt": credential?.expiresAt,
    ]
  }

  /// Verifies the exchanged token against the Account it claims before storing it. The token is not
  /// in the store yet, so the call carries it explicitly.
  func provision(
    serverUrl: String,
    token: String,
    accountId: String
  ) async throws -> [String: Any?] {
    let origin = serverUrl.hasSuffix("/") ? String(serverUrl.dropLast()) : serverUrl
    let result: ApiResult<String> = await VescapeApi.forOrigin(origin).request(
      .get,
      path: Self.accountPath,
      auth: .bearer(token)
    ) { body in
      guard let data = body.data(using: .utf8),
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let id = json["id"] as? String
      else { throw NSError(domain: "NativeAuth", code: -3) }
      return id
    }

    switch result {
    case .ok(let returnedId):
      guard returnedId == accountId else { throw NSError(domain: "NativeAuth", code: -4) }
    // `VescapeApi` already rejected the stored credential and refreshed App Status.
    case .unauthorized:
      throw NSError(domain: "NativeAuth", code: 401)
    case .cancelled:
      throw CancellationError()
    default:
      throw NSError(domain: "NativeAuth", code: -5)
    }

    let credential = DeviceCredential(
      serverUrl: origin,
      token: token,
      accountId: accountId,
      expiresAt: nil
    )
    try store.write(credential)
    await MainActor.run {
      AppStatusCoordinator.shared.refresh()
    }
    return try stateMap()
  }

  /// Revokes server-side before the local copy goes away. A `401` means the server already considers
  /// it gone, which is the same end state.
  func revoke() async throws {
    guard let credential = try store.read() else { return }
    let result: ApiResult<Void> = await VescapeApi.forOrigin(credential.serverUrl).request(
      .delete,
      path: Self.revokePath,
      auth: .required
    ) { _ in () }

    switch result {
    case .ok, .unauthorized: break
    case .cancelled: throw CancellationError()
    default: throw NSError(domain: "NativeAuth", code: -6)
    }
    try store.clear()
  }

  func clear() throws { try store.clear() }
}
