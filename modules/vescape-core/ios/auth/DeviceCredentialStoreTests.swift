import Security
import XCTest

@testable import VescapeCore

final class DeviceCredentialStoreTests: XCTestCase {
  private final class MemoryStorage: DeviceCredentialStorage {
    var status: OSStatus = errSecItemNotFound
    var data: Data?
    var writeStatus: OSStatus = errSecSuccess
    var deleteStatus: OSStatus = errSecSuccess
    var state: String?

    func read() -> (OSStatus, Data?) { (status, data) }
    func write(_ data: Data) -> OSStatus {
      guard writeStatus == errSecSuccess else { return writeStatus }
      self.data = data
      status = errSecSuccess
      return errSecSuccess
    }
    func delete() -> OSStatus {
      guard deleteStatus == errSecSuccess else { return deleteStatus }
      data = nil
      status = errSecItemNotFound
      return errSecSuccess
    }
  }

  private let old = DeviceCredential(
    serverUrl: "https://old.example", token: "old-token", accountId: "old-account", expiresAt: nil
  )

  func testMissingCredentialIsQuiet() throws {
    XCTAssertNil(try DeviceCredentialStore(storage: MemoryStorage()).read())
  }

  func testReadFailureAndMalformedDataPreserveStoredBytes() throws {
    let storage = MemoryStorage()
    storage.status = errSecInteractionNotAllowed
    storage.data = Data("ciphertext".utf8)
    let original = storage.data
    XCTAssertThrowsError(try DeviceCredentialStore(storage: storage).read())
    XCTAssertEqual(storage.data, original)

    storage.status = errSecSuccess
    XCTAssertThrowsError(try DeviceCredentialStore(storage: storage).read())
    XCTAssertEqual(storage.data, original)
  }

  func testFailedWriteDeleteAndExpiryPreserveCredentialAndState() throws {
    let storage = MemoryStorage()
    let store = DeviceCredentialStore(storage: storage)
    try store.write(old)
    let original = storage.data

    storage.writeStatus = errSecNotAvailable
    XCTAssertThrowsError(try store.write(.init(
      serverUrl: "https://new.example", token: "new-token", accountId: "new-account", expiresAt: nil
    )))
    XCTAssertEqual(storage.data, original)
    XCTAssertEqual(storage.state, DeviceCredentialState.ready.rawValue)

    storage.deleteStatus = errSecNotAvailable
    XCTAssertThrowsError(try store.reject())
    XCTAssertEqual(storage.data, original)
    XCTAssertEqual(storage.state, DeviceCredentialState.ready.rawValue)

    XCTAssertThrowsError(try store.updateExpiry("tomorrow"))
    XCTAssertEqual(storage.data, original)
  }
}
