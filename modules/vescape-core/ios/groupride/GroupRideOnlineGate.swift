import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideOnlineGate.kt
internal enum GroupRideOnlineGate {
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

  /// @parity /src/config/server.ts `toGroupRideWebSocketUrl`
  static func webSocketUrl(serverBaseUrl: String) -> String {
    var url = serverBaseUrl
    if url.hasPrefix("http") { url = "ws" + url.dropFirst(4) }
    while url.hasSuffix("/") { url.removeLast() }
    return url + "/ws/group-rides"
  }

  static let versionRejectionCode = 426
}
