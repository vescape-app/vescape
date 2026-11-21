import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/WarningReplayHarness.kt
enum WarningReplayHarness {
  struct Result {
    let frameCount: Int
    let cellSpreadFindings: [CellSpreadFinding]
    let mismatchFindings: [String]
    let cellSpreadSessionEndClean: Bool
    let mismatchSessionEndClean: Bool
  }

  static func run(
    _ jsonl: String,
    configuredSeries: Int?,
    transform: (BmsTelemetry, Int64) -> BmsTelemetry = { bms, _ in bms }
  ) throws -> Result {
    let cellSpread = CellSpreadDetector()
    let mismatch = BatteryConfigMismatchDetector()
    var cellSpreadFindings: [CellSpreadFinding] = []
    var mismatchFindings: [String] = []

    let frames = ReplayChunkDecoder.bmsFrames(jsonl)
    for frame in frames {
      let atMs = frame.capturedAt
      let bms = transform(frame, atMs)
      if let finding = try cellSpread.onFrame(
        cellVoltages: bms.cellVoltages, balancing: bms.balancing, vCharge: bms.vCharge, atMs: atMs
      ) {
        cellSpreadFindings.append(finding)
      }
      if let payload = try mismatch.onFrame(
        bmsCellCount: bms.cellVoltages.count, configuredSeries: configuredSeries
      ) {
        mismatchFindings.append(payload)
      }
    }

    return Result(
      frameCount: frames.count,
      cellSpreadFindings: cellSpreadFindings,
      mismatchFindings: mismatchFindings,
      cellSpreadSessionEndClean: cellSpread.sessionEndClean(),
      mismatchSessionEndClean: mismatch.sessionEndClean()
    )
  }
}

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/WarningReplayCleanRunTest.kt
final class WarningReplayHarnessTests: XCTestCase {
  private var jsonl = ""

  private let fixtureSeries = 16

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
  }

  func testDecoderYieldsOrderedBmsFramesFromRxChunksOnly() throws {
    let frames = ReplayChunkDecoder.bmsFrames(jsonl)
    XCTAssertFalse(frames.isEmpty, "fixture yielded zero BMS frames")
    XCTAssertEqual(frames.first?.cellVoltages.count, fixtureSeries)
    XCTAssertEqual(frames.count, 480)
    XCTAssertEqual(frames.first?.capturedAt, 250)
    XCTAssertEqual(frames.last?.capturedAt, 120_000)
    XCTAssertTrue(zip(frames, frames.dropFirst()).allSatisfy { $1.capturedAt - $0.capturedAt == 250 })
  }

  func testCleanFixtureProducesZeroFindingsAndCleanSessionEnd() throws {
    let result = try WarningReplayHarness.run(jsonl, configuredSeries: fixtureSeries)
    XCTAssertGreaterThan(result.frameCount, 0, "fixture yielded zero BMS frames")
    XCTAssertTrue(result.cellSpreadFindings.isEmpty)
    XCTAssertTrue(result.mismatchFindings.isEmpty)
    XCTAssertTrue(result.cellSpreadSessionEndClean)
    XCTAssertTrue(result.mismatchSessionEndClean)
  }
}
