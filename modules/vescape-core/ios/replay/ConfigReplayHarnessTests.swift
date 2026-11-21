import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ConfigReplayHarnessTest.kt
final class ConfigReplayHarnessTests: XCTestCase {
  private var jsonl = ""

  override func setUpWithError() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
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
    XCTAssertNil(values.bool("fault_moving_fault_disabled"))
    XCTAssertEqual(values.freshness, .fresh)
    XCTAssertNotNil(values.writeBase)
    XCTAssertGreaterThan(values.values.count, 6)
  }

  func testRealConfigSurfacesUnsafeDutyPushback() throws {
    let values = try XCTUnwrap(ConfigReplayHarness.decodeBoardConfigValues(jsonl))
    let report = try ConfigSafetyDetector.evaluate(values, seriesCount: 20, perCell: false)
    XCTAssertTrue(report.findings.contains { $0.kind == .dutyPushbackHigh })
    XCTAssertTrue(report.cleanKinds.contains(.footpadDisabled))
    XCTAssertTrue(report.cleanKinds.contains(.lvPushbackLow))
  }
}
