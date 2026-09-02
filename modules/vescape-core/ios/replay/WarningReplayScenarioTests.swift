import XCTest
@testable import VescapeCore

/// Fault-injection scenarios on the replay harness (ADR 0024): decode-level transforms layered onto
/// the clean fixture's decoded frames — never byte mutation, never a second fixture. Fault windows
/// are anchored relative to the fixture's own first timestamp, so swapping the placeholder fixture
/// for a real recording keeps every scenario valid.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/WarningReplayScenarioTest.kt
final class WarningReplayScenarioTests: XCTestCase {
  private var jsonl = ""

  /// The fixture's known cell-group count; scenario counts are chosen distinct from it.
  private let fixtureSeries = 16

  /// First recorded timestamp — all fault windows anchor relative to this, not absolute ms.
  private var t0: Int64 = 0

  override func setUpWithError() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // replay
      .deletingLastPathComponent() // ios
      .deletingLastPathComponent() // vescape-core
      .deletingLastPathComponent() // modules
      .deletingLastPathComponent() // repo root
    jsonl = try String(
      contentsOf: root.appendingPathComponent("shared/fixtures/replay-synthetic-bms.jsonl"),
      encoding: .utf8
    )
    t0 = ReplayChunkDecoder.bmsFrames(jsonl).first?.capturedAt ?? 0
  }

  private func window(_ startMs: Int64, _ endMs: Int64) -> ClosedRange<Int64> {
    (t0 + startMs)...(t0 + endMs)
  }

  /// Lift one cell group by `deltaV` inside `range` — the canonical spread fault.
  private func spread(
    _ range: ClosedRange<Int64>, group: Int, deltaV: Double
  ) -> (BmsTelemetry, Int64) -> BmsTelemetry {
    { bms, t in
      guard range.contains(t) else { return bms }
      return bms.with(
        cellVoltages: bms.cellVoltages.enumerated().map { $0.offset == group ? $0.element + deltaV : $0.element }
      )
    }
  }

  private func payloadFields(_ json: String) -> [String: Any] {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return obj
  }

  func testSustainedSpreadFiresWarnWithWorstGroup() {
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: fixtureSeries,
      transform: spread(window(10_000, 20_000), group: 3, deltaV: 0.30)
    )
    XCTAssertFalse(result.cellSpreadFindings.isEmpty, "fault window produced no findings")
    XCTAssertTrue(result.cellSpreadFindings.allSatisfy { $0.severity == .warn })
    let payload = payloadFields(result.cellSpreadFindings.last!.payloadJson)
    XCTAssertGreaterThanOrEqual(payload["peakSpread"] as? Double ?? 0, 0.30)
    XCTAssertEqual(payload["worstGroup"] as? Int, 3)
    XCTAssertEqual(payload["charging"] as? Bool, false)
    XCTAssertFalse(result.cellSpreadSessionEndClean)
    XCTAssertTrue(result.mismatchFindings.isEmpty)
  }

  func testSpreadGrowingPastCriticalEscalatesAndPeakIsMonotonic() {
    let warn = spread(window(10_000, 20_000), group: 3, deltaV: 0.30)
    let critical = spread(window(40_000, 50_000), group: 3, deltaV: 0.60)
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: fixtureSeries,
      transform: { bms, t in critical(warn(bms, t), t) }
    )
    XCTAssertGreaterThanOrEqual(result.cellSpreadFindings.count, 2)
    XCTAssertEqual(result.cellSpreadFindings.first?.severity, .warn)
    XCTAssertEqual(result.cellSpreadFindings.last?.severity, .critical)
    // Severity is monotonic: once critical, no later finding may downgrade back to warn.
    let firstCritical = result.cellSpreadFindings.firstIndex { $0.severity == .critical } ?? 0
    XCTAssertTrue(result.cellSpreadFindings[firstCritical...].allSatisfy { $0.severity == .critical })
    let peaks = result.cellSpreadFindings.map { payloadFields($0.payloadJson)["peakSpread"] as? Double ?? 0 }
    XCTAssertTrue(zip(peaks, peaks.dropFirst()).allSatisfy { $1 >= $0 }, "peak must only rise")
    XCTAssertGreaterThanOrEqual(peaks.last ?? 0, 0.60)
  }

  func testSingleFrameSpikeNeverFires() {
    var spiked = false
    let anchor = t0 + 10_000
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: fixtureSeries,
      transform: { bms, t in
        guard !spiked, t >= anchor else { return bms }
        spiked = true
        return bms.with(
          cellVoltages: bms.cellVoltages.enumerated().map { $0.offset == 3 ? $0.element + 0.6 : $0.element }
        )
      }
    )
    XCTAssertTrue(spiked, "spike was never injected")
    XCTAssertTrue(result.cellSpreadFindings.isEmpty)
    XCTAssertTrue(result.cellSpreadSessionEndClean)
  }

  func testConfigMismatchFiresOnceAfterStableFrames() {
    // 18 BMS groups vs 15 configured — both distinct from the fixture's 16. Padding repeats the
    // frame's own last group value so the spread detector sees an unchanged spread.
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: 15,
      transform: { bms, _ in
        bms.with(
          cellVoltages: bms.cellVoltages + Array(repeating: bms.cellVoltages.last ?? 0, count: 2),
          balancing: bms.balancing + Array(repeating: false, count: 2)
        )
      }
    )
    XCTAssertEqual(result.mismatchFindings.count, 1)
    let payload = payloadFields(result.mismatchFindings.first ?? "")
    XCTAssertEqual(payload["bmsCellCount"] as? Int, 18)
    XCTAssertEqual(payload["configuredSeries"] as? Int, 15)
    XCTAssertFalse(result.mismatchSessionEndClean)
    XCTAssertTrue(result.cellSpreadFindings.isEmpty)
  }

  func testFlappingCellCountNeverFires() {
    var frameIndex = 0
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: 15,
      transform: { bms, _ in
        // Alternate 16/15 groups every frame — the count is never stable for 3 consecutive frames.
        defer { frameIndex += 1 }
        return frameIndex % 2 == 0 ? bms : bms.with(cellVoltages: Array(bms.cellVoltages.dropLast()))
      }
    )
    XCTAssertTrue(result.mismatchFindings.isEmpty)
    // Never stable means never evaluated — not a clean pass that would clear a stored warning.
    XCTAssertFalse(result.mismatchSessionEndClean)
  }

  func testChargingSpreadRecordsChargingContext() {
    let range = window(10_000, 20_000)
    let liftGroup = spread(range, group: 3, deltaV: 0.30)
    let result = WarningReplayHarness.run(
      jsonl, configuredSeries: fixtureSeries,
      transform: { bms, t in
        let lifted = liftGroup(bms, t)
        return range.contains(t) ? lifted.with(vCharge: 42.0) : lifted
      }
    )
    XCTAssertFalse(result.cellSpreadFindings.isEmpty)
    let payload = payloadFields(result.cellSpreadFindings.last!.payloadJson)
    XCTAssertEqual(payload["charging"] as? Bool, true)
    XCTAssertEqual(payload["worstGroup"] as? Int, 3)
  }
}

private extension BmsTelemetry {
  /// Scenario copy helper — Kotlin's `data class copy` peer for the fields transforms touch.
  func with(cellVoltages: [Double]? = nil, balancing: [Bool]? = nil, vCharge: Double? = nil) -> BmsTelemetry {
    BmsTelemetry(
      capturedAt: capturedAt,
      voltageTotal: voltageTotal,
      vCharge: vCharge ?? self.vCharge,
      current: current,
      currentIc: currentIc,
      ampHours: ampHours,
      wattHours: wattHours,
      soc: soc,
      soh: soh,
      cellVoltages: cellVoltages ?? self.cellVoltages,
      balancing: balancing ?? self.balancing,
      temps: temps,
      tempIc: tempIc,
      tempHum: tempHum,
      humidity: humidity,
      tempMaxCell: tempMaxCell,
      canId: canId
    )
  }
}
