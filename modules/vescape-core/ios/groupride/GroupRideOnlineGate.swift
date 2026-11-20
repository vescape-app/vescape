import Foundation

/// The Group Ride Online Capability contract with the relay: what an observe upgrade carries, and
/// how the server rejects a blocked app version. Kept out of `GroupRideObserver` so it is testable
/// without URLSession socket glue — the gate *decisions* themselves are one-liners over the
/// observer's own socket state and live inline there.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideOnlineGate.kt
internal enum GroupRideOnlineGate {
  /// Observe-socket upgrade request, stamped with the installed marketing version so the server can
  /// resolve its Release Policy. A blank version (unreadable bundle info) omits the header rather
  /// than sending an empty one — the server then treats the client version as unknown. A
  /// `deviceToken` names the Account for the public ride; without one rooms still work and the
  /// relay refuses public messages.
  static func buildObserveRequest(url: String, appVersion: String, deviceToken: String? = nil) -> URLRequest? {
    guard let target = URL(string: url) else { return nil }
    var request = URLRequest(url: target)
    if !appVersion.isEmpty {
      request.setValue(appVersion, forHTTPHeaderField: AppStatusCoordinator.appVersionHeader)
    }
    if let deviceToken, !deviceToken.isEmpty {
      request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
    }
    return request
  }

  /// The relay socket endpoint on the backend origin, for a public ride the native side starts on
  /// its own (board connect with the app in the background).
  /// @parity /src/config/server.ts `toGroupRideWebSocketUrl`
  static func webSocketUrl(serverBaseUrl: String) -> String {
    var url = serverBaseUrl
    if url.hasPrefix("http") { url = "ws" + url.dropFirst(4) }
    while url.hasSuffix("/") { url.removeLast() }
    return url + "/ws/group-rides"
  }

  /// HTTP 426 Upgrade Required — the server's release-block rejection of an app version.
  static let versionRejectionCode = 426
}
