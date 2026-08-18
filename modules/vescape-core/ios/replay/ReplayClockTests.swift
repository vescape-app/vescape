import XCTest
@testable import VescapeCore

private let warmupMs: Int64 = 180_000
private let warmupSpeed = 30.0

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/replay/ReplayClockTest.kt
final class ReplayClockTests: XCTestCase {
  private func wallMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  /// The dev Replay UI's contract: a replay nobody asked to warm up is wall time, so a recorded ride
  /// plays back exactly as it happened.
  func testRunsAtWallTimeWhenNoWarmupWasAskedFor() {
    let clock = ReplayClock()
    clock.startPlayback(wallMs: wallMs())

    XCTAssertEqual(clock.speed, 1.0)
    XCTAssertEqual(Double(clock.nowMs()), Double(wallMs()), accuracy: 50)
    // 1x pacing: an event 5s into the recording is 5s of real waiting away.
    XCTAssertEqual(Double(clock.delayUntilRecorded(5_000)), 5_000, accuracy: 50)
  }

  func testStartsAFullWarmupWindowInThePast() {
    let clock = ReplayClock(warmupMs: warmupMs, warmupSpeed: warmupSpeed)
    let startedAt = wallMs()
    clock.startPlayback(wallMs: startedAt)

    XCTAssertEqual(Double(clock.nowMs()), Double(startedAt - warmupMs), accuracy: 50)
  }

  /// The point of the whole design: the warmup is delivered in a fraction of the real time it
  /// covers, but its samples still have to be stamped across the window they actually span, or the
  /// live charts stay empty.
  func testCompressesTheWarmupIntoWallTimeDividedBySpeed() {
    let clock = ReplayClock(warmupMs: warmupMs, warmupSpeed: warmupSpeed)
    clock.startPlayback(wallMs: wallMs())

    // Halfway through the recorded window arrives in half the compressed duration...
    XCTAssertEqual(
      Double(clock.delayUntilRecorded(warmupMs / 2)),
      Double(warmupMs / 2) / warmupSpeed,
      accuracy: 50
    )
    // ...and the end of it in the whole compressed duration: 3 recorded minutes in 6 seconds.
    XCTAssertEqual(
      Double(clock.delayUntilRecorded(warmupMs)),
      Double(warmupMs) / warmupSpeed,
      accuracy: 50
    )
  }

  /// Session time is what the live series bucket on, so it has to advance by the recorded span
  /// rather than by the real time the warmup took.
  func testAdvancesSessionTimeAtTheWarmupSpeed() {
    let clock = ReplayClock(warmupMs: warmupMs, warmupSpeed: warmupSpeed)
    clock.startPlayback(wallMs: wallMs())
    let before = clock.nowMs()

    Thread.sleep(forTimeInterval: 0.05)

    XCTAssertGreaterThan(clock.nowMs() - before, 50 * 10)
  }

  func testDropsTo1xOnceSessionTimeReachesTheEndOfTheWarmup() {
    // Short enough that the warmup really elapses inside the test.
    let clock = ReplayClock(warmupMs: 1_000, warmupSpeed: 20.0)
    clock.startPlayback(wallMs: wallMs())

    Thread.sleep(forTimeInterval: 0.08)  // 1000ms of session time at 20x needs 50ms of real time
    _ = clock.delayUntilRecorded(1_000)

    XCTAssertEqual(clock.speed, 1.0)
    // Past the boundary, playback is real time again: 2s of recording is 2s of waiting.
    let delayMs = clock.delayUntilRecorded(3_000) - clock.delayUntilRecorded(1_000)
    XCTAssertEqual(Double(delayMs), 2_000, accuracy: 100)
  }

  /// Freezing the lag rather than snapping it away is what keeps the timeline continuous; a jump
  /// back to wall time would tear a gap into every live series at the boundary.
  func testKeepsSessionTimeContinuousAcrossTheSpeedChange() {
    let clock = ReplayClock(warmupMs: 1_000, warmupSpeed: 20.0)
    clock.startPlayback(wallMs: wallMs())
    Thread.sleep(forTimeInterval: 0.08)

    let beforeDrop = clock.nowMs()
    _ = clock.delayUntilRecorded(1_000)
    let afterDrop = clock.nowMs()

    XCTAssertGreaterThanOrEqual(afterDrop, beforeDrop)
    XCTAssertEqual(Double(beforeDrop), Double(afterDrop), accuracy: 50)
  }
}
