import XCTest
@testable import VescapeCore

final class RefloatConfigWriteVerifierTests: XCTestCase {

  func testAcceptsByteIdenticalConfig() {
    let result = RefloatConfigWriteVerifier.verifyExactBytes(expected: [1, 2, 3], actual: [1, 2, 3])
    guard case .success = result else { return XCTFail("expected success") }
  }

  func testRejectsSameLengthConfigWithHiddenByteMismatch() {
    let result = RefloatConfigWriteVerifier.verifyExactBytes(expected: [1, 2, 3, 4], actual: [1, 2, 99, 4])
    guard case .failure(let message) = result else { return XCTFail("expected failure") }
    XCTAssertEqual("Verification failed: first byte mismatch at offset 2", message)
  }

  func testRejectsDifferentLengthConfig() {
    let result = RefloatConfigWriteVerifier.verifyExactBytes(expected: [1, 2, 3], actual: [1, 2, 3, 4])
    guard case .failure(let message) = result else { return XCTFail("expected failure") }
    XCTAssertEqual("Verification failed: expected 3 bytes, read back 4 bytes", message)
  }
}
