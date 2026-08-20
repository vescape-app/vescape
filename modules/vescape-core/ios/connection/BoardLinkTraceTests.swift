import XCTest
@testable import VescapeCore

/// Board Link persistence trace (ADR 0035, #409): only Board writes that change the Board Link count
/// as linking events, so renames and battery edits stay out of the Event Log.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/BoardLinkTraceTest.kt
final class BoardLinkTraceTests: XCTestCase {
  func testANewBoardLinkIsALinkingEvent() {
    XCTAssertTrue(BoardLinkTrace.isLinkPersist(previousBleId: nil, nextBleId: "AA:BB"))
  }

  func testAChangedBoardLinkIsALinkingEvent() {
    XCTAssertTrue(BoardLinkTrace.isLinkPersist(previousBleId: "AA:BB", nextBleId: "CC:DD"))
  }

  func testAnUnchangedBoardLinkIsAnOrdinaryBoardWrite() {
    XCTAssertFalse(BoardLinkTrace.isLinkPersist(previousBleId: "AA:BB", nextBleId: "AA:BB"))
  }

  func testAnOfflineBoardIsNeverALinkingEvent() {
    XCTAssertFalse(BoardLinkTrace.isLinkPersist(previousBleId: nil, nextBleId: nil))
    XCTAssertFalse(BoardLinkTrace.isLinkPersist(previousBleId: "AA:BB", nextBleId: nil))
  }

  func testBleIdIsReadOutOfTheLinkValue() {
    XCTAssertEqual("AA:BB", BoardLinkTrace.bleId(ofLink: ["bleId": "AA:BB", "transport": 36]))
    XCTAssertNil(BoardLinkTrace.bleId(ofLink: nil))
    XCTAssertNil(BoardLinkTrace.bleId(ofLink: ["transport": 36]))
    XCTAssertNil(BoardLinkTrace.bleId(ofLink: ["bleId": ""]))
  }
}
