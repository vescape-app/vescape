import XCTest
@testable import VescapeCore

/// Config-scoped replay guard (ADR 0024): reconstruct Thor301's real Refloat config read through the
/// live `ConfigRWController` + decoder and assert (1) the byte→schema→decode pipeline yields its known
/// values from the recorded bytes, and (2) the config-safety detector surfaces the board's
/// genuinely-unsafe settings on real data. Config-scoped analogue of the BMS clean-run test.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ConfigReplayHarnessTest.kt
final class ConfigReplayHarnessTests: XCTestCase {
  private var jsonl = ""

  override func setUpWithError() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // replay
      .deletingLastPathComponent() // ios
      .deletingLastPathComponent() // vescape-core
      .deletingLastPathComponent() // modules
      .deletingLastPathComponent() // repo root
    jsonl = try String(
      contentsOf: root.appendingPathComponent("shared/fixtures/replay-thor301.jsonl"),
      encoding: .utf8
    )
  }

  func testRealRecordingDecodesKnownSafetyValues() throws {
    let values = try XCTUnwrap(
      ConfigReplayHarness.decodeBoardConfigValues(jsonl), "config read must decode from the real recording"
    )
    XCTAssertEqual(try XCTUnwrap(values.number("fault_adc1")), 2.0, accuracy: 1e-9)
    XCTAssertEqual(try XCTUnwrap(values.number("fault_adc2")), 2.0, accuracy: 1e-9)
    XCTAssertEqual(try XCTUnwrap(values.number("tiltback_lv")), 62.0, accuracy: 1e-9)
    XCTAssertEqual(try XCTUnwrap(values.number("tiltback_hv")), 86.0, accuracy: 1e-9)
    XCTAssertEqual(try XCTUnwrap(values.number("tiltback_duty")), 1.0, accuracy: 1e-9)
    // Refloat types its on/off params as numbers, so a flag id is never decoded as a Bool.
    XCTAssertNil(values.bool("fault_moving_fault_disabled"))
    // The read retains its own write base and is fresh; the decoded map spans the whole schema, not
    // just the curated tune groups.
    XCTAssertEqual(values.freshness, .fresh)
    XCTAssertNotNil(values.writeBase)
    XCTAssertGreaterThan(values.values.count, 6)
  }

  // Thor301 runs 20s pack-mode Refloat: the tiltback voltages are pack totals, not per-cell.
  func testRealConfigSurfacesUnsafeDutyPushback() throws {
    let values = try XCTUnwrap(ConfigReplayHarness.decodeBoardConfigValues(jsonl))
    let report = ConfigSafetyDetector.evaluate(values, seriesCount: 20, perCell: false)
    // Duty pushback recorded at 1.0 (100%) — a genuinely unsafe setting on the real board.
    XCTAssertTrue(report.findings.contains { $0.kind == .dutyPushbackHigh })
    // Footpad configured (ADC != 0) and LV pushback above the floor -> those rules evaluate clean.
    XCTAssertTrue(report.cleanKinds.contains(.footpadDisabled))
    XCTAssertTrue(report.cleanKinds.contains(.lvPushbackLow))
  }
}
