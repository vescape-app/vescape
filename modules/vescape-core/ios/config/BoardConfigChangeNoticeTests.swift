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

  func testMergeKeepsOneEntryPerFieldWithTheNewerComparison() {
    let previous = [
      BoardConfigChangeDiff(fieldId: "fault_adc1", label: "Zone 1", unit: "V", oldValue: .number(1), newValue: .number(1.2)),
      BoardConfigChangeDiff(fieldId: "l_temp_fet_start", label: "l_temp_fet_start", unit: nil, oldValue: .number(70), newValue: .number(75)),
    ]
    let incoming = [
      BoardConfigChangeDiff(fieldId: "l_temp_fet_start", label: "l_temp_fet_start", unit: nil, oldValue: .number(75), newValue: .number(80)),
      BoardConfigChangeDiff(fieldId: "l_current_max", label: "l_current_max", unit: nil, oldValue: .number(160), newValue: .number(150)),
    ]

    let merged = BoardConfigChangeNotice.mergeDiffs(previous: previous, incoming: incoming)

    // The Refloat diff survives, the twice-diffed field keeps its slot with the newer values, and the
    // new field lands last.
    XCTAssertEqual(merged.map(\.fieldId), ["fault_adc1", "l_temp_fet_start", "l_current_max"])
    XCTAssertEqual(merged[1].oldValue, .number(75))
    XCTAssertEqual(merged[1].newValue, .number(80))
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
