import XCTest
@testable import VescapeCore

/// Board Warning replay harness (ADR 0024): drives a `.jsonl` Debug Recording through the real
/// byte→reassemble→decode path and feeds every decoded BMS frame into the telemetry-scoped detectors,
/// using recorded timestamps as the clock so sustain windows run instantly, no wall-clock waits.
/// Fault scenarios layer a decode-level `transform` onto the clean frames — never byte mutation.
/// The configured series count is a scenario parameter because recordings do not carry it usably.
///
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

/// Clean-run false-positive guard: the committed clean Debug Recording fixture replayed through the
/// real byte→decode path must produce zero findings on every frame and a clean session-end result
/// from both telemetry-scoped detectors. A detector change that fires on this fixture is a CI failure
/// to investigate, not a snapshot to update (ADR 0024). Also pins the replay decoder contract: frame
/// count and pacing survive the reassembler, tx/meta/location/malformed lines are skipped.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/WarningReplayCleanRunTest.kt
final class WarningReplayHarnessTests: XCTestCase {
  private var jsonl = ""

  /// The fixture's known shape; matching the configured series makes the mismatch run comparable.
  private let fixtureSeries = 16

  override func setUpWithError() throws {
    // Read the fixture straight from the shared source (single source of truth), located relative
    // to this test file so no resource bundling is needed — the BatterySocEstimatorTests pattern.
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
  }

  func testDecoderYieldsOrderedBmsFramesFromRxChunksOnly() throws {
    let frames = ReplayChunkDecoder.bmsFrames(jsonl)
    // No vacuous green: a fixture that decodes to nothing must fail loudly.
    XCTAssertFalse(frames.isEmpty, "fixture yielded zero BMS frames")
    XCTAssertEqual(frames.first?.cellVoltages.count, fixtureSeries)
    // Every recorded frame survives the reassembler at the recorded 4 Hz pacing — a decoder that
    // silently drops frames must fail here, not stay vacuously green on the clean run.
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
