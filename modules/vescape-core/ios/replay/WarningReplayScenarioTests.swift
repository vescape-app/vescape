import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/WarningReplayScenarioTest.kt
final class WarningReplayScenarioTests: XCTestCase {
  private var jsonl = ""

  private let fixtureSeries = 16

  private var t0: Int64 = 0

  override func setUpWithError() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    jsonl = try String(
      contentsOf: root.appendingPathComponent("shared/fixtures/replay-synthetic-bms.jsonl"),
      encoding: .utf8
    )
    t0 = ReplayChunkDecoder.bmsFrames(jsonl).first?.capturedAt ?? 0
  }

  private func window(_ startMs: Int64, _ endMs: Int64) -> ClosedRange<Int64> {
    (t0 + startMs)...(t0 + endMs)
  }

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

  func testSustainedSpreadFiresWarnWithWorstGroup() throws {
    let result = try WarningReplayHarness.run(
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

  func testSpreadGrowingPastCriticalEscalatesAndPeakIsMonotonic() throws {
    let warn = spread(window(10_000, 20_000), group: 3, deltaV: 0.30)
    let critical = spread(window(40_000, 50_000), group: 3, deltaV: 0.60)
    let result = try WarningReplayHarness.run(
      jsonl, configuredSeries: fixtureSeries,
      transform: { bms, t in critical(warn(bms, t), t) }
    )
    XCTAssertGreaterThanOrEqual(result.cellSpreadFindings.count, 2)
    XCTAssertEqual(result.cellSpreadFindings.first?.severity, .warn)
    XCTAssertEqual(result.cellSpreadFindings.last?.severity, .critical)
    let firstCritical = result.cellSpreadFindings.firstIndex { $0.severity == .critical } ?? 0
    XCTAssertTrue(result.cellSpreadFindings[firstCritical...].allSatisfy { $0.severity == .critical })
    let peaks = result.cellSpreadFindings.map { payloadFields($0.payloadJson)["peakSpread"] as? Double ?? 0 }
    XCTAssertTrue(zip(peaks, peaks.dropFirst()).allSatisfy { $1 >= $0 }, "peak must only rise")
    XCTAssertGreaterThanOrEqual(peaks.last ?? 0, 0.60)
  }

  func testSingleFrameSpikeNeverFires() throws {
    var spiked = false
    let anchor = t0 + 10_000
    let result = try WarningReplayHarness.run(
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

  func testConfigMismatchFiresOnceAfterStableFrames() throws {
    let result = try WarningReplayHarness.run(
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

  func testFlappingCellCountNeverFires() throws {
    var frameIndex = 0
    let result = try WarningReplayHarness.run(
      jsonl, configuredSeries: 15,
      transform: { bms, _ in
        defer { frameIndex += 1 }
        return frameIndex % 2 == 0 ? bms : bms.with(cellVoltages: Array(bms.cellVoltages.dropLast()))
      }
    )
    XCTAssertTrue(result.mismatchFindings.isEmpty)
    XCTAssertFalse(result.mismatchSessionEndClean)
  }

  func testChargingSpreadRecordsChargingContext() throws {
    let range = window(10_000, 20_000)
    let liftGroup = spread(range, group: 3, deltaV: 0.30)
    let result = try WarningReplayHarness.run(
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
