import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `ServiceConfig`
/// @parity /modules/vescape-core/src/index.ts `ServiceConfig`
struct ServiceConfig: Equatable {
  let mapboxToken: String?
  let mapyToken: String?

  func toMap() -> [String: Any?] { ["mapboxToken": mapboxToken, "mapyToken": mapyToken] }

  static func parse(_ body: Data) -> ServiceConfig? {
    // intentional-suppression: a malformed body is a failed refresh, which keeps the known config
    guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let tokens = root["tokens"] as? [String: Any]
    else { return nil }
    return ServiceConfig(mapboxToken: token(tokens["mapbox"]), mapyToken: token(tokens["mapy"]))
  }

  static func token(_ value: Any?) -> String? {
    guard let trimmed = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty
    else { return nil }
    return trimmed
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `ServiceConfigPersistence`
protocol ServiceConfigPersistence {
  func read() -> Data?
  func write(_ body: Data)
}

struct UserDefaultsServiceConfigPersistence: ServiceConfigPersistence {
  private static let bodyKey = "app.vescape.serviceConfig.body"

  func read() -> Data? { UserDefaults.standard.data(forKey: Self.bodyKey) }
  func write(_ body: Data) { UserDefaults.standard.set(body, forKey: Self.bodyKey) }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `ServiceConfigCoordinator`
final class ServiceConfigCoordinator {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `SERVICE_CONFIG_PATH`
  static let serviceConfigPath = "/api/service-config"

  /// @parity /plugins/withServiceTokens.ts `IOS_INFO_PLIST_KEYS`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `MAPBOX_SEED_METADATA`
  static let mapboxSeedInfoKey = "VescapeMapboxAccessToken"
  static let mapySeedInfoKey = "VescapeMapyApiKey"

  static let shared = ServiceConfigCoordinator(
    installedVersion: AppStatusCoordinator.installedMarketingVersion(),
    baseUrl: AppStatusCoordinator.serverBaseUrl,
    transport: AppStatusCoordinator.urlSessionTransport(),
    persistence: UserDefaultsServiceConfigPersistence(),
    seed: ServiceConfig(
      mapboxToken: ServiceConfig.token(Bundle.main.object(forInfoDictionaryKey: mapboxSeedInfoKey)),
      mapyToken: ServiceConfig.token(Bundle.main.object(forInfoDictionaryKey: mapySeedInfoKey))
    )
  )

  private(set) var current: ServiceConfig

  private let installedVersion: String
  private let baseUrl: String
  private let transport: AppStatusTransport
  private let persistence: ServiceConfigPersistence
  private var listeners: [Int: (ServiceConfig) -> Void] = [:]
  private var nextListenerToken = 0
  private var refreshing = false

  init(
    installedVersion: String,
    baseUrl: String,
    transport: @escaping AppStatusTransport,
    persistence: ServiceConfigPersistence,
    seed: ServiceConfig
  ) {
    self.installedVersion = installedVersion
    self.baseUrl = baseUrl
    self.transport = transport
    self.persistence = persistence
    current = persistence.read().flatMap(ServiceConfig.parse) ?? seed
  }

  func addChangeListener(_ listener: @escaping (ServiceConfig) -> Void) -> () -> Void {
    nextListenerToken += 1
    let token = nextListenerToken
    listeners[token] = listener
    return { [weak self] in self?.listeners.removeValue(forKey: token) }
  }

  func refresh() {
    guard !refreshing else { return }
    refreshing = true
    transport("\(baseUrl)\(Self.serviceConfigPath)", installedVersion, nil) { [weak self] body in
      self?.onFetched(body)
    }
  }

  private func onFetched(_ body: Data?) {
    refreshing = false
    guard let body, let config = ServiceConfig.parse(body) else { return }
    persistence.write(body)
    guard config != current else { return }
    current = config
    listeners.values.forEach { $0(config) }
  }
}
