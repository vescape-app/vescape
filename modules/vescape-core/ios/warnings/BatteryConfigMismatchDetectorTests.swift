import XCTest
@testable import VescapeCore

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
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15), bmsCellCount: 18, configuredSeries: 15)
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15))
    XCTAssertFalse(detector.sessionEndClean())
  }

  func testLiveConfigChangeReReportsWithNewSeries() throws {
    let detector = BatteryConfigMismatchDetector()
    for _ in 0..<2 { XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15)) }
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 15), bmsCellCount: 18, configuredSeries: 15)
    assertPayload(try detector.onFrame(bmsCellCount: 18, configuredSeries: 16), bmsCellCount: 18, configuredSeries: 16)
    XCTAssertNil(try detector.onFrame(bmsCellCount: 18, configuredSeries: 16))
  }

  func testSingleOddFrameDoesNotFire() throws {
    let detector = BatteryConfigMismatchDetector()
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
