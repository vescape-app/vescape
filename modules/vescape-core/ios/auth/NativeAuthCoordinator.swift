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

  func stateMap() -> [String: Any?] {
    let credential = store.read()
    return [
      "state": store.state().rawValue,
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
    default:
      throw NSError(domain: "NativeAuth", code: -5)
    }

    // The database is claimed before the credential is stored: a second Account must not be able to
    // upload from a database full of the first Account's Boards, Ride History and locations. The
    // Rider confirms the destructive reset, and only then does `confirmAccountReset` finish this.
    guard SyncCoordinator.shared.bindAccount(accountId) else {
      var state = stateMap()
      state["accountChangeRequiresReset"] = true
      return state
    }

    try store.write(
      DeviceCredential(serverUrl: origin, token: token, accountId: accountId, expiresAt: nil)
    )
    await MainActor.run {
      AppStatusCoordinator.shared.refresh()
    }
    SyncCoordinator.shared.start()
    return stateMap()
  }

  /// The Rider confirmed that all local app data is erased and cannot yet be restored.
  ///
  /// One ordered transition: stop the uploader, invalidate in-flight work, replace the app-data
  /// database, clear Sync Cursors and pending Sync Actions, bind the fresh database to the new
  /// Account, install the new Device Token, start the uploader. Cancelling never reaches here, so
  /// the old database and Account binding stay untouched.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/auth/NativeAuthCoordinator.kt `confirmAccountReset`
  func confirmAccountReset(
    serverUrl: String,
    token: String,
    accountId: String
  ) async throws -> [String: Any?] {
    let origin = serverUrl.hasSuffix("/") ? String(serverUrl.dropLast()) : serverUrl
    try await SyncCoordinator.shared.resetForAccount(accountId)
    // The token is installed before the uploader starts: a loop running on the previous Account's
    // credential against the new Account's database is exactly what this ordering exists to prevent.
    try store.write(
      DeviceCredential(serverUrl: origin, token: token, accountId: accountId, expiresAt: nil)
    )
    await MainActor.run {
      AppStatusCoordinator.shared.refresh()
    }
    SyncCoordinator.shared.start()
    return stateMap()
  }

  /// Revokes server-side before the local copy goes away. A `401` means the server already considers
  /// it gone, which is the same end state.
  func revoke() async throws {
    guard let credential = store.read() else { return }
    let result: ApiResult<Void> = await VescapeApi.forOrigin(credential.serverUrl).request(
      .delete,
      path: Self.revokePath,
      auth: .required
    ) { _ in () }

    switch result {
    case .ok, .unauthorized: break
    default: throw NSError(domain: "NativeAuth", code: -6)
    }
    store.clear()
  }

  func clear() {
    store.clear()
    // Signing out stops the uploader but keeps the Account binding, so data recorded while signed
    // out stays protected from retention for the same Account.
    SyncCoordinator.shared.stop()
  }
}
