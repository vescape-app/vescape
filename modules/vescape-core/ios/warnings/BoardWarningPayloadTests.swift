import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/warnings/BoardWarningKindTest.kt
final class BoardWarningPayloadTests: XCTestCase {

  func testRound4RoundsTiesAwayFromZero() {
    XCTAssertEqual(BoardWarningPayload.round4(0.12345), 0.1235)
    XCTAssertEqual(BoardWarningPayload.round4(-0.12345), -0.1235)
  }

  func testRound4StripsFloatNoise() {
    XCTAssertEqual(BoardWarningPayload.round4(3.92 - 3.80), 0.12)
    XCTAssertEqual(BoardWarningPayload.round4(3.80 - 3.92), -0.12)
  }
}
