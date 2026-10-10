import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/ClearancePreviewLogTest.kt
final class ClearancePreviewLogTests: XCTestCase {
  func testInvalidAndMissingSamplesBreakChartWithoutInventingDistance() {
    let log = ClearancePreviewLog()
    log.record(at: 0, time: 0, seq: 1, value: 10)
    log.record(at: 50, time: 50, seq: 2, value: nil)
    log.record(at: 100, time: 100, seq: 3, value: 12)
    log.record(at: 200, time: 200, seq: 5, value: 14)
    let snapshot = log.snapshot(at: 200)!
    XCTAssertEqual(snapshot["segments"] as? [[Double]], [[0, 10], [100, 12], [200, 14]])
    XCTAssertEqual(snapshot["dropped"] as? Int64, 1)
    XCTAssertEqual(snapshot["invalid"] as? Int, 1)
    XCTAssertEqual(snapshot["deliveredHz"] as? Double, 15)
  }
  func testDisplayThrottleDoesNotDropHistoryAndResetStartsFresh() {
    let log = ClearancePreviewLog()
    for i: Int64 in 0...6 {
      log.record(at: i * 50, time: i * 50, seq: i + 1, value: 10)
      XCTAssertEqual(log.shouldEmit(at: i * 50), i % 2 == 0)
    }
    XCTAssertEqual(log.snapshot(at: 300)!["samples"] as? Int, 7)
    XCTAssertNil(log.snapshot(at: 400))
    log.reset()
    log.record(at: 450, time: 0, seq: 1, value: 8)
    XCTAssertTrue(log.shouldEmit(at: 450))
    XCTAssertEqual(log.snapshot(at: 450)!["samples"] as? Int, 1)
  }
  func testWindowAndCapacityBoundMemory() {
    let log = ClearancePreviewLog()
    for i: Int64 in 0...1000 { log.record(at: i * 50, time: i * 50, seq: i + 1, value: 10) }
    XCTAssertEqual(log.snapshot(at: 50_000)!["samples"] as? Int, 401)
    log.reset()
    for i: Int64 in 0...1000 { log.record(at: i, time: i, seq: i + 1, value: 10) }
    XCTAssertEqual(log.snapshot(at: 1000)!["samples"] as? Int, 601)
  }
}
