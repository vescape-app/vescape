import Foundation
import Security

struct DeviceCredential: Codable, Equatable {
  let serverUrl: String
  let token: String
  let accountId: String
  var expiresAt: String?
}

enum DeviceCredentialState: String {
  case unavailable
  case ready
  case rejected
}

protocol DeviceCredentialStorage: AnyObject {
  func read() -> (OSStatus, Data?)
  func write(_ data: Data) -> OSStatus
  func delete() -> OSStatus
  var state: String? { get set }
}

/// Keychain-backed Device Token storage, readable after first unlock even while screen is locked.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/auth/DeviceCredentialStore.kt
final class DeviceCredentialStore {
  static let shared = DeviceCredentialStore()
  private let storage: DeviceCredentialStorage
  private let lock = NSRecursiveLock()

  convenience init() { self.init(storage: KeychainDeviceCredentialStorage()) }

  init(storage: DeviceCredentialStorage) {
    self.storage = storage
  }

  func read() throws -> DeviceCredential? {
    lock.lock()
    defer { lock.unlock() }
    let (status, data) = storage.read()
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw keychainError(status) }
    guard let data else { throw keychainError(errSecDecode) }
    return try JSONDecoder().decode(DeviceCredential.self, from: data)
  }

  func write(_ credential: DeviceCredential) throws {
    lock.lock()
    defer { lock.unlock() }
    let data = try JSONEncoder().encode(credential)
    let status = storage.write(data)
    guard status == errSecSuccess else { throw keychainError(status) }
    storage.state = DeviceCredentialState.ready.rawValue
  }

  func updateExpiry(_ expiresAt: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard var credential = try read() else { return }
    credential.expiresAt = expiresAt
    try write(credential)
  }

  func reject() throws {
    lock.lock()
    defer { lock.unlock() }
    try deleteCredential()
    storage.state = DeviceCredentialState.rejected.rawValue
  }

  func clear() throws {
    lock.lock()
    defer { lock.unlock() }
    try deleteCredential()
    storage.state = DeviceCredentialState.unavailable.rawValue
  }

  func state(credential: DeviceCredential?) -> DeviceCredentialState {
    lock.lock()
    defer { lock.unlock() }
    if credential != nil { return .ready }
    let stored = DeviceCredentialState(
      rawValue: storage.state ?? ""
    ) ?? .unavailable
    return stored == .ready ? .unavailable : stored
  }

  private func deleteCredential() throws {
    let status = storage.delete()
    guard status == errSecSuccess || status == errSecItemNotFound else { throw keychainError(status) }
  }

  private func keychainError(_ status: OSStatus) -> NSError {
    NSError(domain: NSOSStatusErrorDomain, code: Int(status))
  }

}

private final class KeychainDeviceCredentialStorage: DeviceCredentialStorage {
  private let service = "app.vescape.device-auth"
  private let account = "credential"
  private let stateKey = "vescape_device_auth_state"

  var state: String? {
    get { UserDefaults.standard.string(forKey: stateKey) }
    set { UserDefaults.standard.set(newValue, forKey: stateKey) }
  }

  func read() -> (OSStatus, Data?) {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    return (status, result as? Data)
  }

  func write(_ data: Data) -> OSStatus {
    let query = baseQuery()
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    guard status == errSecItemNotFound else { return status }
    var insert = query
    attributes.forEach { insert[$0.key] = $0.value }
    return SecItemAdd(insert as CFDictionary, nil)
  }

  func delete() -> OSStatus { SecItemDelete(baseQuery() as CFDictionary) }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}
