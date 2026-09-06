import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultLogReaderTest.kt
final class VescFaultLogReaderTests: XCTestCase {
  func testJoinsChunksAndCompletesAfterSilence() {
    var output: String?
    let reader = VescFaultLogReader(
      startedAtMs: 1_000,
      onSuccess: { output = $0 },
      onError: { _, _ in XCTFail("unexpected") }
    )
    reader.onPrintChunk(Array("Faults:\n".utf8), atMs: 1_100)
    reader.onPrintChunk(Array("NONE\n".utf8), atMs: 1_200)

    XCTAssertFalse(reader.poll(1_699))
    XCTAssertTrue(reader.poll(1_700))
    XCTAssertEqual(output, "Faults:\nNONE\n")
  }

  func testTimesOutWhenControllerPrintsNothing() {
    var code: String?
    let reader = VescFaultLogReader(
      startedAtMs: 1_000,
      onSuccess: { _ in XCTFail("unexpected") },
      onError: { value, _ in code = value }
    )

    XCTAssertTrue(reader.poll(5_000))
    XCTAssertEqual(code, "VESC_FAULT_LOG_TIMEOUT")
  }

  func testDisconnectCancelsTheRead() {
    var code: String?
    let reader = VescFaultLogReader(
      startedAtMs: 1_000,
      onSuccess: { _ in XCTFail("unexpected") },
      onError: { value, _ in code = value }
    )

    reader.cancel()
    XCTAssertEqual(code, "VESC_FAULT_LOG_DISCONNECTED")
  }
}
