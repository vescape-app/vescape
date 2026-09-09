import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryPipelineTest.kt `recentSnapshot`
final class LiveSeriesEmitterTests: XCTestCase {
  private func sample(ts: Int64, speed: Double) -> [String: Any?] {
    ["lastPacketAt": ts, "speed": speed]
  }

  func testEmptyByDefault() {
    XCTAssertTrue(LiveSeriesEmitter().recentSnapshot().isEmpty)
  }

  func testKeepsWindowInOrder() {
    let emitter = LiveSeriesEmitter()
    emitter.add(sample(ts: 1_000, speed: 10))
    emitter.add(sample(ts: 2_000, speed: 20))

    let snapshot = emitter.recentSnapshot()
    XCTAssertEqual(snapshot.count, 2)
    XCTAssertEqual(snapshot[0]["lastPacketAt"] as? Int64, 1_000)
    XCTAssertEqual(snapshot[1]["speed"] as? Double, 20)
  }

  func testPrunesOutsideWindow() {
    let emitter = LiveSeriesEmitter()
    emitter.setWindowMinutes(1) // 60_000 ms window
    emitter.add(sample(ts: 0, speed: 5))
    emitter.add(sample(ts: 70_000, speed: 9)) // 70s newer -> drops the ts=0 row

    let snapshot = emitter.recentSnapshot()
    XCTAssertEqual(snapshot.count, 1)
    XCTAssertEqual(snapshot[0]["lastPacketAt"] as? Int64, 70_000)
  }

  func testStopClears() {
    let emitter = LiveSeriesEmitter()
    emitter.add(sample(ts: 1_000, speed: 10))
    emitter.stop()
    XCTAssertTrue(emitter.recentSnapshot().isEmpty)
  }

  func testTickUsesVirtualTimeAndStopPreventsRescheduling() {
    let scheduler = TestScheduler()
    let emitter = LiveSeriesEmitter(scheduler: scheduler)
    var emissions = 0
    emitter.emit = { event, _ in
      if event == "onLiveSeries" { emissions += 1 }
    }

    emitter.start()
    emitter.add(sample(ts: 1_000, speed: 10))
    XCTAssertEqual(1, emissions)

    scheduler.advance(999)
    XCTAssertEqual(1, emissions)
    scheduler.advance(1)
    XCTAssertEqual(2, emissions)

    emitter.stop()
    scheduler.advance(1_000)
    XCTAssertEqual(2, emissions)
    XCTAssertEqual(0, scheduler.pendingCount)
  }
}
