import XCTest
@testable import VescapeCore

/// Battery-config-mismatch detector behavior: stable-count gating (a single odd frame never fires),
/// one warn payload carrying both counts, matching-count clean evaluation, and the no-data /
/// no-config contracts that leave a stored warning untouched. Payload assertions decode the JSON (its
/// key order is serializer-dependent) rather than matching an exact string.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/warnings/BatteryConfigMismatchDetectorTest.kt
final class BatteryConfigMismatchDetectorTests: XCTestCase {

  private func assertPayload(
    _ json: String?,
    bmsCellCount: Int,
    configuredSeries: Int,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let json, let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return XCTFail("missing or invalid payload", file: file, line: line) }
    XCTAssertEqual(obj["bmsCellCount"] as? Int, bmsCellCount, file: file, line: line)
    XCTAssertEqual(obj["configuredSeries"] as? Int, configuredSeries, file: file, line: line)
  }

  func testStableMismatchFiresOneWarnWithBothCounts() throws {
    let detector = BatteryConfigMismatchDetector()
    // First two stable frames are not yet stable enough to compare.
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15), bmsCellCount: 18, configuredSeries: 15)
    // Already reported this mismatch — no repeat on later identical frames.
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testLiveConfigChangeReReportsWithNewSeries() throws {
    let detector = BatteryConfigMismatchDetector()
    // Stable 18 vs 15S fires once.
    for _ in 0..<2 { XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15)) }
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15), bmsCellCount: 18, configuredSeries: 15)
    // Config changes to 16S mid-session, BMS count unchanged — a different mismatch must re-report
    // so the stored payload does not keep the stale series count.
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 16), bmsCellCount: 18, configuredSeries: 16)
    // Same pair again is deduped.
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 16))
  }

  func testSingleOddFrameDoesNotFire() throws {
    let detector = BatteryConfigMismatchDetector()
    // A one-off wrong count between matching frames never reaches stability, so it never fires.
    XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15))
    XCTAssertTrue(detector.sessionEndClean())
  }

  func testStableMatchIsCleanEvaluation() throws {
    let detector = BatteryConfigMismatchDetector()
    for _ in 0..<4 { XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15)) }
    XCTAssertTrue(detector.sessionEndClean())
  }

  func testNoBmsDataIsNotClean() throws {
    let detector = BatteryConfigMismatchDetector()
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testNoConfiguredSeriesIsNotClean() throws {
    let detector = BatteryConfigMismatchDetector()
    // Stable BMS count but no configured series to compare against — no evaluation at all.
    for _ in 0..<4 { XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: nil)) }
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testZeroBmsCountIgnored() throws {
    let detector = BatteryConfigMismatchDetector()
    for _ in 0..<4 { XCTAssertNil(try detector.onFrame(bmsCellCount: 0, configuredSeries: 15)) }
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testResetClearsState() throws {
    let detector = BatteryConfigMismatchDetector()
    for _ in 0..<3 { _ = try detector.onFrame(bmsCellCount: 18, configuredSeries: 15) }
    XCTAssertFalse(detector.sessionEndClean())
    detector.reset()
    XCTAssertFalse(detector.sessionEndClean())
    for _ in 0..<3 { XCTAssertNil(try detector.onFrame(bmsCellCount: 15, configuredSeries: 15)) }
    XCTAssertTrue(detector.sessionEndClean())
  }
}
