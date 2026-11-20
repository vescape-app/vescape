import XCTest
@testable import VescapeCore

/// A real ride decodes into the hardware a Simulated Board presents and the replies it answers from
/// (ADR 0048), whether or not the recording kept its `tx` side.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ReplayRecordingTest.kt
final class ReplayRecordingTests: XCTestCase {
  private func fixture(_ name: String) throws -> ReplayRecording {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // replay
      .deletingLastPathComponent() // ios
      .deletingLastPathComponent() // vescape-core
      .deletingLastPathComponent() // modules
      .deletingLastPathComponent() // repo root
    let jsonl = try String(contentsOf: root.appendingPathComponent("shared/fixtures/\(name)"), encoding: .utf8)
    return ReplayRecording.parse(name: name, jsonl: jsonl)
  }

  func testRecordedRideCarriesItsOwnHardwareIdentity() throws {
    let hardware = try fixture("replay-thor301.jsonl").hardware

    XCTAssertEqual(hardware.transport, .can(98))
    XCTAssertFalse(hardware.firmware?.isEmpty ?? true)
    XCTAssertFalse(hardware.refloatVersion?.isEmpty ?? true)
    XCTAssertFalse(hardware.hasBms, "a ride with no BMS replies has no BMS")
    XCTAssertEqual(hardware.pollIntervalMs, 50)
  }

  func testRepliesAreIndexedByWhatTheyAnswer() throws {
    let recording = try fixture("replay-thor301.jsonl")
    let book = recording.replies

    XCTAssertNotNil(book.firmware)
    XCTAssertNotNil(book.refloatInfo)
    // Every recorded chunk lands in one blob: the reassembled XML has no unwritten tail.
    let xml = try XCTUnwrap(book.configXml[0])
    XCTAssertFalse(xml.isEmpty)
    XCTAssertNotEqual(xml.last, 0, "reassembled XML must be fully covered")
    XCTAssertFalse(book.configSnapshots[0]?.isEmpty ?? true)
    // Answers to requests never play on the timeline.
    XCTAssertFalse(recording.timeline.contains { event in
      guard case let .frame(_, payload) = event else { return false }
      return Int(payload[0]) == COMM_CUSTOM_APP_DATA && ReplayRecording.refloatCommand(payload) == REFLOAT_GET_INFO
    })
    XCTAssertTrue(zip(recording.timeline, recording.timeline.dropFirst()).allSatisfy { $0.t <= $1.t })
  }

  func testRecordingWithoutTxTakesTheHopFromItsMeta() throws {
    let recording = try fixture("replay-thor301-1hz.jsonl")

    XCTAssertEqual(recording.hardware.transport, .can(98))
    XCTAssertTrue(recording.timeline.contains { if case .fix = $0 { return true } else { return false } })
  }
}
