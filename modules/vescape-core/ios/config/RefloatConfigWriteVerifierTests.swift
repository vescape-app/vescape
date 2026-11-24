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

  func testDisabledStaysStrictlyVerified() {
    let withDisabled = RefloatConfigSchema(
      hash: "disabled",
      fields: [
        RefloatConfigSchemaField(id: "disabled", type: .bool, label: "Disabled", unit: nil, min: nil, max: nil, offset: 0, scale: nil),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "Default", unit: nil, min: nil, max: nil, offset: 1, scale: nil),
      ]
    )
    let written: [UInt8] = [1, 1]
    guard case .success = RefloatConfigWriteVerifier.verify(schema: withDisabled, written: written, readBack: [1, 0]) else {
      return XCTFail("disabled matching with cleared meta.is_default must verify")
    }
    guard case .failure(let message) = RefloatConfigWriteVerifier.verify(schema: withDisabled, written: written, readBack: [0, 0]) else {
      return XCTFail("disabled mismatch must fail verification")
    }
    XCTAssertEqual("Verification failed: first byte mismatch at offset 0", message)
  }
}
