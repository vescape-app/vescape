import XCTest
@testable import VescapeCore

final class BoardConfigChangeNoticeTests: XCTestCase {
  func testDiffPreservesTypesAndAddedRemovedFields() {
    let diffs = BoardConfigChangeNotice.diff(
      old: ["same": 1.0, "typed": 1.0, "removed": false],
      new: ["same": 1.0, "typed": true, "added": 2.0],
      schema: nil
    )
    XCTAssertEqual(diffs.map(\.fieldId), ["added", "removed", "typed"])
    XCTAssertNil(diffs[0].oldValue)
    XCTAssertEqual(diffs[0].newValue, .number(2))
    XCTAssertEqual(diffs[1].oldValue, .bool(false))
    XCTAssertNil(diffs[1].newValue)
    XCTAssertEqual(diffs[2].oldValue, .number(1))
    XCTAssertEqual(diffs[2].newValue, .bool(true))
  }

  func testDiffIgnoresFloatNoiseButKeepsRealEdits() {
    let diffs = BoardConfigChangeNotice.diff(
      old: ["noise": 0.026000000000002, "edit": 0.026, "big": 30000.0],
      new: ["noise": 0.026, "edit": 0.027, "big": 30000.000000001],
      schema: nil
    )
    XCTAssertEqual(diffs.map(\.fieldId), ["edit"])
  }
}
