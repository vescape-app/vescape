import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/warnings/CellSpreadDetectorTest.kt
final class CellSpreadDetectorTests: XCTestCase {
  private let noBalance = [false, false]

  private func payloadFields(_ json: String?) -> [String: Any] {
    guard let json, let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return obj
  }

  func testSingleFrameSpikeDoesNotFire() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0))
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.90, 3.91], balancing: noBalance, vCharge: 0.0, atMs: 100))
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 5_000))
  }

  func testSustainedSpreadFiresWarnWithPayload() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0))
    let finding = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertNotNil(finding)
    XCTAssertEqual(finding?.severity, .warn)
    let fields = payloadFields(finding?.payloadJson)
    XCTAssertEqual(fields["peakSpread"] as? Double, 0.24)
    XCTAssertEqual(fields["worstGroup"] as? Int, 0)
    XCTAssertEqual(fields["charging"] as? Bool, false)
    XCTAssertEqual(fields["balancing"] as? Bool, false)
  }

  func testSustainedSpreadOverCriticalFiresCritical() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.40, 3.98], balancing: noBalance, vCharge: 0.0, atMs: 0))
    let finding = try detector.onFrame(cellVoltages: [3.40, 3.98], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertNotNil(finding)
    XCTAssertEqual(finding?.severity, .critical)
  }

  func testPayloadRecordsChargingAndBalancingContext() throws {
    let detector = CellSpreadDetector()
    let balancing = [false, true]
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: balancing, vCharge: 55.0, atMs: 0))
    let finding = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: balancing, vCharge: 55.0, atMs: 3_000)
    XCTAssertNotNil(finding)
    let fields = payloadFields(finding?.payloadJson)
    XCTAssertEqual(fields["peakSpread"] as? Double, 0.24)
    XCTAssertEqual(fields["worstGroup"] as? Int, 0)
    XCTAssertEqual(fields["charging"] as? Bool, true)
    XCTAssertEqual(fields["balancing"] as? Bool, true)
  }

  func testChargeDetectionMirrorsThreshold() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 9.5, atMs: 0))
    let finding = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 9.5, atMs: 3_000)
    XCTAssertEqual(payloadFields(finding?.payloadJson)["charging"] as? Bool, false)
  }

  func testRisingPeakReReportsAboveEpsilonOnly() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0))
    let first = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertEqual(payloadFields(first?.payloadJson)["peakSpread"] as? Double, 0.24)

    let second = try detector.onFrame(cellVoltages: [3.80, 4.12], balancing: noBalance, vCharge: 0.0, atMs: 3_100)
    XCTAssertEqual(payloadFields(second?.payloadJson)["peakSpread"] as? Double, 0.32)

    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.122], balancing: noBalance, vCharge: 0.0, atMs: 3_200))
  }

  func testEscalatesWarnToCritical() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0))
    let warn = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertEqual(warn?.severity, .warn)

    let critical = try detector.onFrame(cellVoltages: [3.40, 3.98], balancing: noBalance, vCharge: 0.0, atMs: 3_100)
    XCTAssertNotNil(critical)
    XCTAssertEqual(critical?.severity, .critical)
  }

  func testWorstGroupIsFurthestFromAverage() throws {
    let detector = CellSpreadDetector()
    let cells = [3.70, 3.85, 3.98]
    let balancing = [false, false, false]
    XCTAssertNil(try detector.onFrame(cellVoltages: cells, balancing: balancing, vCharge: 0.0, atMs: 0))
    let finding = try detector.onFrame(cellVoltages: cells, balancing: balancing, vCharge: 0.0, atMs: 3_000)
    XCTAssertEqual(payloadFields(finding?.payloadJson)["worstGroup"] as? Int, 0)
  }

  func testInvalidCellsAreFilteredAndCountAsNoData() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [0.0, Double.nan], balancing: noBalance, vCharge: 0.0, atMs: 0))
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testSingleValidCellIsNotUsableData() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 0.0], balancing: noBalance, vCharge: 0.0, atMs: 0))
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, -1.0], balancing: noBalance, vCharge: 0.0, atMs: 3_000))
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testLongGapBreaksSustainContinuity() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0))
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 5_000))
    let finding = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 8_000)
    XCTAssertNotNil(finding)
    XCTAssertEqual(finding?.severity, .warn)
  }

  func testLaterWeakerEpisodeDoesNotDowngrade() throws {
    let detector = CellSpreadDetector()
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.40, 3.98], balancing: noBalance, vCharge: 0.0, atMs: 0))
    let critical = try detector.onFrame(cellVoltages: [3.40, 3.98], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertEqual(critical?.severity, .critical)
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.90, 3.91], balancing: noBalance, vCharge: 0.0, atMs: 3_100))

    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 4_000))
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 7_000))
  }

  func testInFlightEpisodeAtSessionEndBlocksClean() throws {
    let detector = CellSpreadDetector()
    _ = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0)
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testSessionEndCleanOnlyWhenDataFlowedAndNeverFired() throws {
    let quietData = CellSpreadDetector()
    _ = try quietData.onFrame(cellVoltages: [3.90, 3.91], balancing: noBalance, vCharge: 0.0, atMs: 0)
    XCTAssertTrue(quietData.sessionEndClean())

    let noData = CellSpreadDetector()
    XCTAssertFalse(noData.sessionEndClean())

    let transientOnly = CellSpreadDetector()
    _ = try transientOnly.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0)
    _ = try transientOnly.onFrame(cellVoltages: [3.90, 3.91], balancing: noBalance, vCharge: 0.0, atMs: 100)
    XCTAssertTrue(transientOnly.sessionEndClean())

    let fired = CellSpreadDetector()
    _ = try fired.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0)
    _ = try fired.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertFalse(fired.sessionEndClean())
  }

  func testResetRestoresCleanState() throws {
    let detector = CellSpreadDetector()
    _ = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 0)
    _ = try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 3_000)
    XCTAssertFalse(detector.sessionEndClean())

    detector.reset()
    XCTAssertFalse(detector.sessionEndClean())
    XCTAssertNil(try detector.onFrame(cellVoltages: [3.80, 4.04], balancing: noBalance, vCharge: 0.0, atMs: 10_000))
  }
}
