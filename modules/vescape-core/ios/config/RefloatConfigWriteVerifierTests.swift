import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/RefloatConfigWriteVerifierTest.kt
final class RefloatConfigWriteVerifierTests: XCTestCase {
  private let plain = RefloatConfigSchema(hash: "plain", fields: [])
  private let withMeta = RefloatConfigSchema(
    hash: "meta",
    fields: [RefloatConfigSchemaField(id: "meta.is_default", type: .int8, label: "Config is Default", unit: nil, min: nil, max: nil, offset: 2, scale: nil)]
  )

  func testAcceptsByteIdenticalConfig() {
    let result = RefloatConfigWriteVerifier.verify(schema: plain, written: [1, 2, 3], readBack: [1, 2, 3])
    guard case .success = result else { return XCTFail("expected success") }
  }

  func testRejectsSameLengthConfigWithHiddenByteMismatch() {
    let result = RefloatConfigWriteVerifier.verify(schema: plain, written: [1, 2, 3, 4], readBack: [1, 2, 99, 4])
    guard case .failure(let message) = result else { return XCTFail("expected failure") }
    XCTAssertEqual("Verification failed: first byte mismatch at offset 2", message)
  }

  func testRejectsDifferentLengthConfig() {
    let result = RefloatConfigWriteVerifier.verify(schema: plain, written: [1, 2, 3], readBack: [1, 2, 3, 4])
    guard case .failure(let message) = result else { return XCTFail("expected failure") }
    XCTAssertEqual("Verification failed: expected 3 bytes, read back 4 bytes", message)
  }

  func testExpectsBoardToClearMetaIsDefault() {
    let written: [UInt8] = [1, 2, 1, 4]
    guard case .success = RefloatConfigWriteVerifier.verify(schema: withMeta, written: written, readBack: [1, 2, 0, 4]) else {
      return XCTFail("cleared meta.is_default must verify")
    }
    guard case .failure(let message) = RefloatConfigWriteVerifier.verify(schema: withMeta, written: written, readBack: written) else {
      return XCTFail("a still-default config must not verify")
    }
    XCTAssertEqual("Verification failed: first byte mismatch at offset 2", message)
  }
}
