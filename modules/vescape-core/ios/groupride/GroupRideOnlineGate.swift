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
  /// than sending an empty one — the server then treats the client version as unknown.
  static func buildObserveRequest(url: String, appVersion: String) -> URLRequest? {
    guard let target = URL(string: url) else { return nil }
    var request = URLRequest(url: target)
    if !appVersion.isEmpty {
      request.setValue(appVersion, forHTTPHeaderField: AppStatusCoordinator.appVersionHeader)
    }
    return request
  }

  /// HTTP 426 Upgrade Required — the server's release-block rejection of an app version.
  static let versionRejectionCode = 426
}
