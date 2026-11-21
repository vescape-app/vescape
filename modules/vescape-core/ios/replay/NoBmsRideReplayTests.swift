import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/NoBmsRideReplayTest.kt
final class NoBmsRideReplayTests: XCTestCase {
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

  func testRealRideHasInboundTrafficButNoBmsFrames() throws {
    XCTAssertFalse(ReplayChunkDecoder.rxChunks(jsonl).isEmpty, "expected recorded rx chunks")
    XCTAssertTrue(ReplayChunkDecoder.bmsFrames(jsonl).isEmpty, "no-BMS ride must yield zero BMS frames")
  }

  func testNoBmsRideKeepsDetectorsSilent() throws {
    let result = try WarningReplayHarness.run(jsonl, configuredSeries: 16)
    XCTAssertEqual(result.frameCount, 0)
    XCTAssertTrue(result.cellSpreadFindings.isEmpty)
    XCTAssertTrue(result.mismatchFindings.isEmpty)
    XCTAssertFalse(result.cellSpreadSessionEndClean, "no BMS data must not assert a healthy session")
    XCTAssertFalse(result.mismatchSessionEndClean, "no BMS data must not assert a healthy session")
  }
}
