import XCTest
@testable import VescapeCore

/// No-BMS ride guard: a real captured ride from a board with no smart BMS (`replay-thor301.jsonl`)
/// must decode to zero BMS frames and leave both telemetry-scoped detectors silent — the app must
/// never invent a warning (or crash) when a board reports no smart-BMS telemetry. Runs against real
/// inbound traffic, so it also proves the decoder does not misparse motor packets as BMS frames.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/NoBmsRideReplayTest.kt
final class NoBmsRideReplayTests: XCTestCase {
  private var jsonl = ""

  override func setUpWithError() throws {
    // Read the fixture straight from the shared source, located relative to this test file — the
    // WarningReplayHarnessTests pattern.
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

  func testRealRideHasInboundTrafficButNoBmsFrames() throws {
    // Real recording carries inbound BLE traffic...
    XCTAssertFalse(ReplayChunkDecoder.rxChunks(jsonl).isEmpty, "expected recorded rx chunks")
    // ...none of which decodes to smart-BMS telemetry.
    XCTAssertTrue(ReplayChunkDecoder.bmsFrames(jsonl).isEmpty, "no-BMS ride must yield zero BMS frames")
  }

  func testNoBmsRideKeepsDetectorsSilent() throws {
    // A configured series count is present, yet with no BMS frames there is nothing to evaluate:
    // both detectors stay silent (no false cell-spread, no false config-mismatch)...
    let result = try WarningReplayHarness.run(jsonl, configuredSeries: 16)
    XCTAssertEqual(result.frameCount, 0)
    XCTAssertTrue(result.cellSpreadFindings.isEmpty)
    XCTAssertTrue(result.mismatchFindings.isEmpty)
    // ...and, having seen no data, they make no "healthy" claim, so a previously stored warning is
    // left untouched (sessionEndClean stays false — it clears warnings only after observing data).
    XCTAssertFalse(result.cellSpreadSessionEndClean, "no BMS data must not assert a healthy session")
    XCTAssertFalse(result.mismatchSessionEndClean, "no BMS data must not assert a healthy session")
  }
}
