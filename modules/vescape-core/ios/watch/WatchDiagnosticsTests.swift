import XCTest
@testable import VescapeCore

/// The wrist's field readout. What is worth pinning is not the counting — it is the three things
/// that decide whether the ring is still readable during the incident it exists to explain: the
/// streak guards, the cap, and the fact that leaving the app writes its own line.
final class WatchDiagnosticsTests: XCTestCase {
  func testFirstFrameIsAnnouncedOnceAndLaterFramesOnlyCount() {
    var log = WatchDiagnosticsLog()
    log.recordFrame(nowMs: 1_000)
    log.recordFrame(nowMs: 1_250)
    log.recordFrame(nowMs: 1_500)

    XCTAssertEqual(log.framesDecoded, 3)
    XCTAssertEqual(log.events.count, 1)
    XCTAssertEqual(log.events.first?.text, "first frame received")
    XCTAssertEqual(log.events.first?.atMs, 1_000)
    XCTAssertEqual(log.events.first?.warn, false)
  }

  /// A 4 Hz stream of undecodable frames must not flush the ring: the line that explains the
  /// mismatch is the first one, and everything before it is the context for why it started.
  func testDecodeFailuresEmitOneEventPerStreakButCountEveryFrame() {
    var log = WatchDiagnosticsLog()
    log.recordLink("reachable", nowMs: 500)
    for tick in 0..<20 {
      log.recordDecodeFailure(byteCount: 13, lanes: 6, nowMs: 1_000 + Int64(tick) * 250)
    }

    XCTAssertEqual(log.decodeFailures, 20)
    XCTAssertEqual(log.events.count, 2)
    XCTAssertEqual(log.events.first?.text, "decode fail 13B v6")
    XCTAssertEqual(log.events.first?.warn, true)
    XCTAssertEqual(log.events.last?.text, "link reachable")

    // A frame that decodes ends the streak, so the next failure is a new finding rather than a
    // continuation of the old one.
    log.recordFrame(nowMs: 7_000)
    log.recordDecodeFailure(byteCount: 9, lanes: nil, nowMs: 7_250)
    XCTAssertEqual(log.events.first?.text, "decode fail 9B v-1")
    XCTAssertEqual(log.decodeFailures, 21)
  }

  func testLinkAndWakeLevelAreDeduplicated() {
    var log = WatchDiagnosticsLog()
    log.recordLink("reachable", nowMs: 1_000)
    log.recordLink("reachable", nowMs: 2_000)
    log.recordLink("unreachable", nowMs: 3_000)
    log.recordWakeLevel(.active, nowMs: 4_000)
    log.recordWakeLevel(.active, nowMs: 5_000)
    log.recordWakeLevel(.ambient, nowMs: 6_000)
    log.recordWakeLevel(.asleep, nowMs: 7_000)

    XCTAssertEqual(
      Array(log.events.map(\.text).reversed()),
      ["link reachable", "link unreachable", "wake active", "wake ambient", "wake asleep"]
    )
  }

  /// Leaving the app is the one lifecycle fact the rider cannot otherwise see from the wrist, and
  /// it is checked by coming back to a ring that already says it happened.
  func testLeavingAndReturningLeavesBothTransitionsInTheRing() {
    var log = WatchDiagnosticsLog()
    log.recordWakeLevel(.active, nowMs: 1_000)
    log.recordWakeLevel(.asleep, nowMs: 2_000)
    log.recordWakeLevel(.active, nowMs: 9_000)

    XCTAssertEqual(log.events.map(\.text), ["wake active", "wake asleep", "wake active"])
    XCTAssertEqual(log.events.first?.atMs, 9_000)
  }

  func testRingKeepsTheNewestEventsAndDropsTheOldest() {
    var log = WatchDiagnosticsLog()
    for tick in 0..<(WatchDiagnosticsLog.maxEvents + 10) {
      log.recordRadarFailure(nowMs: Int64(tick))
    }

    XCTAssertEqual(log.events.count, WatchDiagnosticsLog.maxEvents)
    XCTAssertEqual(log.events.first?.atMs, Int64(WatchDiagnosticsLog.maxEvents + 9))
    XCTAssertEqual(log.events.last?.atMs, 10)
    XCTAssertTrue(log.events.allSatisfy(\.warn))
  }

  func testReplayNamesItselfSoGaugesAreNotMistakenForARide() {
    var log = WatchDiagnosticsLog()
    log.recordReplay(fixture: "ride", sampleCount: 240, nowMs: 1_000)

    XCTAssertEqual(log.events.first?.text, "replay ride (240 samples)")
    XCTAssertEqual(log.events.first?.warn, false)
  }
  func testCadenceExpiresDuringSilenceAndRecoversAfterReconnect() {
    var rate = WatchFrameRate()
    for timestamp: Int64 in [0, 250, 500, 750, 1_000] { rate.record(nowMs: timestamp) }
    XCTAssertEqual(rate.hertz(nowMs: 1_000), 4, accuracy: 0.001)
    XCTAssertEqual(rate.hertz(nowMs: 2_000), 2, accuracy: 0.001)
    XCTAssertEqual(rate.hertz(nowMs: 6_001), 0)

    rate.record(nowMs: 10_000)
    XCTAssertEqual(rate.hertz(nowMs: 10_000), 0)
    rate.record(nowMs: 10_500)
    XCTAssertEqual(rate.hertz(nowMs: 10_500), 2, accuracy: 0.001)
  }

  func testCadenceDistinguishesArrivalFromDelayedApplication() {
    var received = WatchFrameRate()
    var applied = WatchFrameRate()
    for timestamp: Int64 in [0, 250, 500] { received.record(nowMs: timestamp) }
    // A busy main queue applies all three queued frames at once.
    for _ in 0..<3 { applied.record(nowMs: 1_000) }
    XCTAssertEqual(received.hertz(nowMs: 1_000), 2, accuracy: 0.001)
    XCTAssertEqual(applied.hertz(nowMs: 1_000), 0)
  }
}
