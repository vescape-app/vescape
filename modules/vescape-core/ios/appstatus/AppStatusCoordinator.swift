import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `AppStatusTransport`
typealias AppStatusTransport = (
  _ url: String,
  _ appVersion: String,
  _ deviceToken: String?,
  _ onResult: @escaping (Data?) -> Void
) -> Void

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `OnlineCapability`
protocol OnlineCapability: AnyObject {
  var onlineBlocked: Bool { get }

  var appVersion: String { get }

  func refresh()

  func addListener(_ listener: @escaping () -> Void) -> () -> Void
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt
final class AppStatusCoordinator: OnlineCapability {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `APP_STATUS_PATH`
  static let appStatusPath = "/api/app-status"

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `APP_VERSION_HEADER`
  /// @parity /src/modules/profile/lib/deviceAuth.ts `APP_VERSION_HEADER`
  static let appVersionHeader = "Vescape-App-Version"

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `PRODUCTION_SERVER_BASE_URL`
  /// @parity /src/config/server.ts `SERVER_URL`
  static let productionServerBaseUrl = "https://api.vescape.app"

  /// @parity /plugins/withServerOrigin.ts `IOS_INFO_PLIST_KEY`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `SERVER_BASE_URL_METADATA`
  static let serverBaseUrlInfoKey = "VescapeServerBaseUrl"

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `serverBaseUrl`
  static let serverBaseUrl: String = {
    var baked = (Bundle.main.object(forInfoDictionaryKey: serverBaseUrlInfoKey) as? String) ?? ""
    while baked.hasSuffix("/") { baked.removeLast() }
    return baked.isEmpty ? productionServerBaseUrl : baked
  }()

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `androidDownloadUrl`
  static let iosDownloadUrl = "\(productionServerBaseUrl)/download/ios"

  private static let callTimeoutSeconds: TimeInterval = 10

  static let shared = AppStatusCoordinator(
    installedVersion: installedMarketingVersion(),
    baseUrl: serverBaseUrl,
    transport: urlSessionTransport()
  )

  private(set) var current: AppStatus?

  private var listeners: [Int: (AppStatus?) -> Void] = [:]
  private var nextListenerToken = 0

  var onlineBlocked: Bool { current?.version.status.blocksOnline ?? false }

  var appVersion: String { installedVersion }

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
      do { return try DeviceCredentialStore.shared.read()?.token }
      catch {
        UnexpectedNativeError.report(operation: "device_credential_read", category: "secure_store_read", error: error)
        return nil
      }
    }
  ) {
    self.installedVersion = installedVersion
    self.baseUrl = baseUrl
    self.transport = transport
    self.deviceTokenProvider = deviceTokenProvider
  }

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
      NSLog("[AppStatus] refresh failed; keeping \(current == nil ? "unknown" : "last") state")
      return
    }
    current = status
    applyDeviceTokenState(body)
    listeners.values.forEach { $0(status) }
  }

  private func applyDeviceTokenState(_ body: Data) {
    // intentional-suppression: device-token response subsection is optional
    guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let token = root["deviceToken"] as? [String: Any],
          let state = token["state"] as? String
    else { return }
    switch state {
    case "valid":
      if let expiresAt = token["expiresAt"] as? String {
        do { try DeviceCredentialStore.shared.updateExpiry(expiresAt) }
        catch { UnexpectedNativeError.report(operation: "device_credential_expiry_write", category: "secure_store_write", error: error) }
      }
    case "expired", "revoked":
      do { try DeviceCredentialStore.shared.reject() }
      catch { UnexpectedNativeError.report(operation: "device_credential_reject", category: "secure_store_delete", error: error) }
    default:
      break
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `installedMarketingVersion`
  static func installedMarketingVersion() -> String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  static func urlSessionTransport() -> AppStatusTransport {
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
