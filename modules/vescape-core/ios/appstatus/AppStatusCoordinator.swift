import Foundation

/// One App Status fetch attempt. `nil` body means "no usable response" (transport or HTTP error).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `AppStatusTransport`
typealias AppStatusTransport = (
  _ url: String,
  _ appVersion: String,
  _ deviceToken: String?,
  _ onResult: @escaping (Data?) -> Void
) -> Void

/// The slice of App Status the Group Ride relay socket gates on. Split out so the observer can be
/// exercised without a live coordinator, exactly like Android's `OnlineCapability`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `OnlineCapability`
protocol OnlineCapability: AnyObject {
  /// True while online work (Group Ride) is denied — Online Block or App Block. Unknown fails open.
  var onlineBlocked: Bool { get }

  /// Installed marketing version to stamp on app-originated requests (WebSocket upgrades included).
  var appVersion: String { get }

  /// Ask for a fresh App Status now — e.g. after a server version rejection (426).
  func refresh()

  /// Observe App Status changes; returns a remover. Invoked on the main thread.
  func addListener(_ listener: @escaping () -> Void) -> () -> Void
}

/// Process-owned App Status truth. Native reads the installed marketing version, fetches
/// `GET /api/app-status` on every foreground, and keeps the last **successful** result for the life
/// of the process.
///
/// Failure semantics (ADR 0025):
/// - No successful result yet -> stays `nil`: the app fails open and behaves as `current`.
/// - A successful result exists -> a later failure keeps it; losing the network never clears a
///   known state.
/// - Nothing is persisted, so a fresh process starts unknown again.
///
/// Main-thread affine: lifecycle hooks call in on the main thread and the URLSession transport hops
/// back there before touching state.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt
final class AppStatusCoordinator: OnlineCapability {
  /// Public App Status route on the Vescape server.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `APP_STATUS_PATH`
  static let appStatusPath = "/api/app-status"

  /// Carries the installed marketing version on every app-originated request. The server resolves
  /// its Release Policy ranges from it.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `APP_VERSION_HEADER`
  /// @parity /src/modules/profile/lib/deviceAuth.ts `APP_VERSION_HEADER`
  static let appVersionHeader = "Vescape-App-Version"

  /// Vescape backend origin for a shipped build, and the fallback whenever the baked Info.plist
  /// value is missing.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `PRODUCTION_SERVER_BASE_URL`
  /// @parity /src/config/server.ts `SERVER_URL`
  static let productionServerBaseUrl = "https://api.vescape.app"

  /// Info.plist key holding the backend origin. Native fetches App Status before JS is ready, so it
  /// cannot receive the URL from JS the way Group Ride does — prebuild bakes `EXPO_PUBLIC_SERVER_URL`
  /// in instead, which is what lets a dev build talk to a local server.
  /// @parity /plugins/withServerOrigin.ts `IOS_INFO_PLIST_KEY`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `SERVER_BASE_URL_METADATA`
  static let serverBaseUrlInfoKey = "VescapeServerBaseUrl"

  /// Baked backend origin, trailing slash trimmed so path concatenation stays single-slashed.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `serverBaseUrl`
  static let serverBaseUrl: String = {
    var baked = (Bundle.main.object(forInfoDictionaryKey: serverBaseUrlInfoKey) as? String) ?? ""
    while baked.hasSuffix("/") { baked.removeLast() }
    return baked.isEmpty ? productionServerBaseUrl : baked
  }()

  /// Stable iOS download route. Server-owned redirect, so the app never hardcodes the final store
  /// destination. Always production: a local server has no store redirect to serve.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `androidDownloadUrl`
  static let iosDownloadUrl = "\(productionServerBaseUrl)/download/ios"

  private static let callTimeoutSeconds: TimeInterval = 10

  /// Process singleton — its in-memory state must outlive JS runtime reloads.
  static let shared = AppStatusCoordinator(
    installedVersion: installedMarketingVersion(),
    baseUrl: serverBaseUrl,
    transport: urlSessionTransport()
  )

  /// Last successful App Status for this process, or `nil` while none has been fetched.
  private(set) var current: AppStatus?

  /// Notified on every state change so multiple process-scoped consumers stay in sync — the JS
  /// mirror (module) and the Group Ride online gate ([OnlineCapability]). Unlike the JS module, the
  /// gate can outlive the foreground runtime, so it subscribes here rather than through JS.
  private var listeners: [Int: (AppStatus?) -> Void] = [:]
  private var nextListenerToken = 0

  var onlineBlocked: Bool { current?.version.status.blocksOnline ?? false }

  var appVersion: String { installedVersion }

  /// Register a full-status listener (used by the JS mirror); returns a remover.
  func addChangeListener(_ listener: @escaping (AppStatus?) -> Void) -> () -> Void {
    nextListenerToken += 1
    let token = nextListenerToken
    listeners[token] = listener
    return { [weak self] in self?.listeners.removeValue(forKey: token) }
  }

  func addListener(_ listener: @escaping () -> Void) -> () -> Void {
    addChangeListener { _ in listener() }
  }

  private let installedVersion: String
  private let baseUrl: String
  private let transport: AppStatusTransport
  private let deviceTokenProvider: () -> String?
  private var refreshing = false

  init(
    installedVersion: String,
    baseUrl: String,
    transport: @escaping AppStatusTransport,
    deviceTokenProvider: @escaping () -> String? = {
      DeviceCredentialStore.shared.read()?.token
    }
  ) {
    self.installedVersion = installedVersion
    self.baseUrl = baseUrl
    self.transport = transport
    self.deviceTokenProvider = deviceTokenProvider
  }

  /// Fetch App Status now. Foreground events arrive repeatedly (and a cold start fires both create
  /// and foreground), so a refresh asked for while one is already in flight is dropped — the
  /// in-flight request answers it, and the next foreground picks up anything newer.
  func refresh() {
    guard !refreshing, !installedVersion.isEmpty else { return }
    refreshing = true
    transport(
      "\(baseUrl)\(Self.appStatusPath)",
      installedVersion,
      deviceTokenProvider()
    ) { [weak self] body in
      self?.onFetched(body)
    }
  }

  private func onFetched(_ body: Data?) {
    refreshing = false
    guard let body, let status = decodeAppStatus(body) else {
      // Fail open when nothing is known yet; keep the last success when something is.
      NSLog("[AppStatus] refresh failed; keeping \(current == nil ? "unknown" : "last") state")
      return
    }
    current = status
    applyDeviceTokenState(body)
    listeners.values.forEach { $0(status) }
  }

  private func applyDeviceTokenState(_ body: Data) {
    guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let token = root["deviceToken"] as? [String: Any],
          let state = token["state"] as? String
    else { return }
    switch state {
    case "valid":
      if let expiresAt = token["expiresAt"] as? String {
        DeviceCredentialStore.shared.updateExpiry(expiresAt)
      }
    case "expired", "revoked":
      DeviceCredentialStore.shared.reject()
    default:
      break
    }
  }

  /// Installed marketing version (`CFBundleShortVersionString`) — the same value Release Policy
  /// ranges match on both platforms. Build numbers are never used.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `installedMarketingVersion`
  static func installedMarketingVersion() -> String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  /// Default transport: one short-timeout GET, result handed back on the main thread.
  private static func urlSessionTransport() -> AppStatusTransport {
    { url, appVersion, deviceToken, onResult in
      guard let target = URL(string: url) else {
        DispatchQueue.main.async { onResult(nil) }
        return
      }
      var request = URLRequest(url: target)
      request.timeoutInterval = callTimeoutSeconds
      request.setValue(appVersion, forHTTPHeaderField: appVersionHeader)
      if let deviceToken {
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
      }
      URLSession.shared.dataTask(with: request) { data, response, _ in
        let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        DispatchQueue.main.async { onResult(ok ? data : nil) }
      }.resume()
    }
  }
}
