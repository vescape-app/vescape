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

  func testDiffSkipsIgnoredAndVolatileMotorFields() {
    let old: [String: Any] = [
      "foc_offsets_current[0]": 2010.43,
      "foc_offsets_current[1]": 2031.32,
      "foc_offsets_current[2]": 2040.56,
      "foc_offsets_voltage[0]": -0.0062,
      "foc_offsets_voltage[1]": 0.001,
      "foc_offsets_voltage[2]": 0.0025,
      "foc_offsets_voltage_undriven[0]": 0.001,
      "foc_offsets_voltage_undriven[1]": 0.002,
      "foc_offsets_voltage_undriven[2]": 0.003,
      "foc_offsets_cal_on_boot": 1.0,
      "l_current_max": 160.0,
      "l_temp_fet_start": 70.0,
    ]
    let new: [String: Any] = [
      "foc_offsets_current[0]": 2010.67,
      "foc_offsets_current[1]": 2031.66,
      "foc_offsets_current[2]": 2040.22,
      "foc_offsets_voltage[0]": -0.0061,
      "foc_offsets_voltage[1]": 0.002,
      "foc_offsets_voltage[2]": 0.0024,
      "foc_offsets_voltage_undriven[0]": 0.004,
      "foc_offsets_voltage_undriven[1]": 0.005,
      "foc_offsets_voltage_undriven[2]": 0.006,
      "foc_offsets_cal_on_boot": 0.0,
      "l_current_max": 150.0,
      "l_temp_fet_start": 75.0,
    ]
    let diffs = BoardConfigChangeNotice.diff(
      old: old,
      new: new,
      schema: nil,
      ignoredFields: BoardConfigChangeNotice.volatileMotorFields.union(["l_current_max"])
    )
    XCTAssertEqual(diffs.map(\.fieldId), ["foc_offsets_cal_on_boot", "l_temp_fet_start"])
  }
}
