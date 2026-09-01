import XCTest
@testable import VescapeCore

/// Config-safety rule boundaries: each rule fires with the right severity + payload, clears when the
/// setting is safe, per-cell rules skip (report nothing) when they cannot resolve their bound, and the
/// pushback voltage rules follow the firmware's per-cell (6.05+) vs pack units. Payload assertions
/// decode the JSON (its key order is serializer-dependent) rather than matching an exact string.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/warnings/ConfigSafetyDetectorTest.kt
final class ConfigSafetyDetectorTests: XCTestCase {
  private func values(
    faultAdc1: Double? = 2.0,
    faultAdc2: Double? = 2.0,
    tiltbackLv: Double? = 45.0,
    tiltbackHv: Double? = 64.5,
    tiltbackDuty: Double? = 0.80,
    movingFaultDisabled: Bool? = false
  ) -> BoardConfigValues {
    var map: [String: Any] = [:]
    map[ConfigSafetyDetector.faultAdc1Id] = faultAdc1
    map[ConfigSafetyDetector.faultAdc2Id] = faultAdc2
    map[ConfigSafetyDetector.tiltbackLvId] = tiltbackLv
    map[ConfigSafetyDetector.tiltbackHvId] = tiltbackHv
    map[ConfigSafetyDetector.tiltbackDutyId] = tiltbackDuty
    map[ConfigSafetyDetector.movingFaultDisabledId] = movingFaultDisabled
    return BoardConfigValues(
      boardId: "board",
      refloatBaseVersion: "2.0",
      capturedAtMs: 0,
      freshness: .fresh,
      values: map,
      writeBase: nil
    )
  }

  private func finding(_ report: ConfigSafetyReport, _ kind: BoardWarningKind) -> ConfigSafetyFinding? {
    report.findings.first { $0.kind == kind }
  }

  private func assertPayload(
    _ finding: ConfigSafetyFinding?,
    param: String,
    value: Double,
    bound: Double,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let json = finding?.payloadJson, let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return XCTFail("missing or invalid payload", file: file, line: line) }
    XCTAssertEqual(obj["param"] as? String, param, file: file, line: line)
    XCTAssertEqual(obj["value"] as? Double, value, file: file, line: line)
    XCTAssertEqual(obj["bound"] as? Double, bound, file: file, line: line)
  }

  func testSupportsPerCellVoltageResolvesFromFirmware() {
    XCTAssertEqual(ConfigSafetyDetector.supportsPerCellVoltage("FW 6.05 · hw · cfg"), true)
    XCTAssertEqual(ConfigSafetyDetector.supportsPerCellVoltage("FW 6.10"), true)
    XCTAssertEqual(ConfigSafetyDetector.supportsPerCellVoltage("FW 7.00"), true)
    XCTAssertEqual(ConfigSafetyDetector.supportsPerCellVoltage("FW 6.02"), false)
    XCTAssertEqual(ConfigSafetyDetector.supportsPerCellVoltage("FW 5.03"), false)
    XCTAssertNil(ConfigSafetyDetector.supportsPerCellVoltage(nil))
    XCTAssertNil(ConfigSafetyDetector.supportsPerCellVoltage("unknown"))
  }

  func testAllSafeReportsEveryKindClean() {
    let report = ConfigSafetyDetector.evaluate(values(), seriesCount: 15, perCell: false)
    XCTAssertTrue(report.findings.isEmpty)
    XCTAssertEqual(
      Set(report.cleanKinds),
      [
        .footpadDisabled,
        .lvPushbackLow,
        .hvPushbackHigh,
        .dutyPushbackHigh,
        .movingFaultDisabled,
      ]
    )
  }

  func testFootpadDisabledWhenBothAdcZero() {
    let report = ConfigSafetyDetector.evaluate(values(faultAdc1: 0.0, faultAdc2: 0.0), seriesCount: 15, perCell: false)
    let f = finding(report, .footpadDisabled)
    XCTAssertEqual(f?.severity, .critical)
    assertPayload(f, param: "fault_adc1/fault_adc2", value: 0.0, bound: 0.0)
  }

  func testFootpadCleanWhenOneAdcNonZero() {
    let report = ConfigSafetyDetector.evaluate(values(faultAdc1: 0.0, faultAdc2: 2.0), seriesCount: 15, perCell: false)
    XCTAssertNil(finding(report, .footpadDisabled))
    XCTAssertTrue(report.cleanKinds.contains(.footpadDisabled))
  }

  func testFootpadSkippedWhenAdcFieldMissing() {
    let report = ConfigSafetyDetector.evaluate(values(faultAdc2: nil), seriesCount: 15, perCell: false)
    XCTAssertNil(finding(report, .footpadDisabled))
    XCTAssertFalse(report.cleanKinds.contains(.footpadDisabled))
  }

  func testLvPushbackLowFiresBelowPackMinimum() {
    // Pack mode, 15s: safe minimum 45.0 V; 44.0 is unsafe.
    let report = ConfigSafetyDetector.evaluate(values(tiltbackLv: 44.0), seriesCount: 15, perCell: false)
    let f = finding(report, .lvPushbackLow)
    XCTAssertEqual(f?.severity, .critical)
    assertPayload(f, param: "tiltback_lv", value: 44.0, bound: 45.0)
  }

  func testLvPushbackAtBoundIsClean() {
    let report = ConfigSafetyDetector.evaluate(values(), seriesCount: 15, perCell: false)
    XCTAssertNil(finding(report, .lvPushbackLow))
    XCTAssertTrue(report.cleanKinds.contains(.lvPushbackLow))
  }

  func testHvPushbackHighFiresAbovePackMaximum() {
    // Pack mode, 15s: safe maximum 64.5 V; 66.0 is unsafe.
    let report = ConfigSafetyDetector.evaluate(values(tiltbackHv: 66.0), seriesCount: 15, perCell: false)
    let f = finding(report, .hvPushbackHigh)
    XCTAssertEqual(f?.severity, .warn)
    assertPayload(f, param: "tiltback_hv", value: 66.0, bound: 64.5)
  }

  func testPerCellFirmwareComparesRawVoltageWithoutSeries() {
    // Per-cell mode (6.05+): the bound is the per-cell constant directly; series count is irrelevant.
    let clean = ConfigSafetyDetector.evaluate(values(tiltbackLv: 3.0, tiltbackHv: 4.3), seriesCount: nil, perCell: true)
    XCTAssertTrue(clean.cleanKinds.contains(.lvPushbackLow))
    XCTAssertTrue(clean.cleanKinds.contains(.hvPushbackHigh))

    let lvLow = ConfigSafetyDetector.evaluate(values(tiltbackLv: 2.9, tiltbackHv: 4.3), seriesCount: nil, perCell: true)
    let lv = finding(lvLow, .lvPushbackLow)
    XCTAssertEqual(lv?.severity, .critical)
    assertPayload(lv, param: "tiltback_lv", value: 2.9, bound: 3.0)

    let hvHigh = ConfigSafetyDetector.evaluate(values(tiltbackLv: 3.0, tiltbackHv: 4.5), seriesCount: nil, perCell: true)
    let hv = finding(hvHigh, .hvPushbackHigh)
    XCTAssertEqual(hv?.severity, .warn)
    assertPayload(hv, param: "tiltback_hv", value: 4.5, bound: 4.3)
  }

  func testPerCellCapableFirmwareStillAcceptsPackVoltageThresholds() {
    // Refloat 1.2+ keeps legacy pack totals valid. It treats only values below 10 V as per-cell.
    let clean = ConfigSafetyDetector.evaluate(
      values(tiltbackLv: 57.0, tiltbackHv: 81.7),
      seriesCount: 19,
      perCell: true
    )
    XCTAssertNil(finding(clean, .lvPushbackLow))
    XCTAssertNil(finding(clean, .hvPushbackHigh))
    XCTAssertTrue(clean.cleanKinds.contains(.lvPushbackLow))
    XCTAssertTrue(clean.cleanKinds.contains(.hvPushbackHigh))

    let high = ConfigSafetyDetector.evaluate(
      values(tiltbackLv: 57.0, tiltbackHv: 82.0),
      seriesCount: 19,
      perCell: true
    )
    assertPayload(finding(high, .hvPushbackHigh), param: "tiltback_hv", value: 82.0, bound: 81.7)
  }

  func testPerCellRulesSkippedWithoutSeriesCountInPackMode() {
    // Pack mode, dangerous LV/HV values, but no series count — the two rules must report nothing.
    let report = ConfigSafetyDetector.evaluate(values(tiltbackLv: 10.0, tiltbackHv: 90.0), seriesCount: nil, perCell: false)
    XCTAssertNil(finding(report, .lvPushbackLow))
    XCTAssertNil(finding(report, .hvPushbackHigh))
    XCTAssertFalse(report.cleanKinds.contains(.lvPushbackLow))
    XCTAssertFalse(report.cleanKinds.contains(.hvPushbackHigh))
    // The non-cell rules still evaluate.
    XCTAssertTrue(report.cleanKinds.contains(.dutyPushbackHigh))
  }

  func testVoltageRulesSkippedWhenFirmwareModeUnknown() {
    // perCell nil (unparseable firmware): units are ambiguous, so LV/HV report nothing even with series.
    let report = ConfigSafetyDetector.evaluate(values(tiltbackLv: 10.0, tiltbackHv: 90.0), seriesCount: 15, perCell: nil)
    XCTAssertNil(finding(report, .lvPushbackLow))
    XCTAssertNil(finding(report, .hvPushbackHigh))
    XCTAssertFalse(report.cleanKinds.contains(.lvPushbackLow))
    XCTAssertFalse(report.cleanKinds.contains(.hvPushbackHigh))
    XCTAssertTrue(report.cleanKinds.contains(.dutyPushbackHigh))
    XCTAssertTrue(report.cleanKinds.contains(.movingFaultDisabled))
  }

  func testDutyPushbackHighFiresOverLimit() {
    let report = ConfigSafetyDetector.evaluate(values(tiltbackDuty: 0.90), seriesCount: 15, perCell: false)
    let f = finding(report, .dutyPushbackHigh)
    XCTAssertEqual(f?.severity, .warn)
    assertPayload(f, param: "tiltback_duty", value: 0.9, bound: 0.85)
  }

  func testMovingFaultDisabledFiresWhenOn() {
    let report = ConfigSafetyDetector.evaluate(values(movingFaultDisabled: true), seriesCount: 15, perCell: false)
    let f = finding(report, .movingFaultDisabled)
    XCTAssertEqual(f?.severity, .warn)
    assertPayload(f, param: "fault_moving_fault_disabled", value: 1.0, bound: 0.0)
  }

  /// Refloat declares the field as a numeric config param, so a real board decodes it to `1.0`, never
  /// to `true`. Reading it as a bool skipped the rule on every board — the warning could not fire.
  func testMovingFaultDisabledFiresForTheNumericValueRealBoardsDecodeTo() throws {
    let values = BoardConfigValues(
      boardId: "board",
      refloatBaseVersion: "2.0",
      capturedAtMs: 0,
      freshness: .fresh,
      values: [ConfigSafetyDetector.movingFaultDisabledId: 1.0],
      writeBase: nil
    )
    let report = ConfigSafetyDetector.evaluate(values, seriesCount: 15, perCell: false)
    let finding = try XCTUnwrap(report.findings.first { $0.kind == .movingFaultDisabled })
    XCTAssertEqual(finding.severity, .warn)
  }
}
