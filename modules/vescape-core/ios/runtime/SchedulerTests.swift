import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/runtime/TestSchedulerTest.kt
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/runtime/SessionGuardedSchedulerTest.kt
final class SchedulerTests: XCTestCase {
  func testPostDelayedFiresAfterExactDelay() {
    let scheduler = TestScheduler()
    var fired = false
    scheduler.postDelayed(100) { fired = true }

    scheduler.advance(99)
    XCTAssertFalse(fired)

    scheduler.advance(1)
    XCTAssertTrue(fired)
  }

  func testTasksRunByDueTimeThenSubmissionOrder() {
    let scheduler = TestScheduler()
    var order: [String] = []
    scheduler.postDelayed(200) { order.append("b") }
    scheduler.postDelayed(100) { order.append("first") }
    scheduler.postDelayed(100) { order.append("second") }
    scheduler.postDelayed(300) { order.append("c") }

    scheduler.advance(500)

    XCTAssertEqual(["first", "second", "b", "c"], order)
  }

  func testCancellationPreventsExecution() {
    let scheduler = TestScheduler()
    var fired = false
    let handle = scheduler.postDelayed(100) { fired = true }

    handle.cancel()
    scheduler.advance(200)

    XCTAssertFalse(fired)
    XCTAssertEqual(0, scheduler.pendingCount)
  }

  func testReentrantSchedulingRunsWithinSameAdvance() {
    let scheduler = TestScheduler()
    var count = 0
    func reschedule() {
      scheduler.postDelayed(50) {
        count += 1
        if count < 3 { reschedule() }
      }
    }

    reschedule()
    scheduler.advance(200)

    XCTAssertEqual(3, count)
    XCTAssertEqual(200, scheduler.currentTimeMs)
  }

  func testPostRunsAtCurrentTime() {
    let scheduler = TestScheduler()
    var firedAt: Int64?
    scheduler.post { firedAt = scheduler.currentTimeMs }

    scheduler.advance(0)

    XCTAssertEqual(0, firedAt)
  }

  func testCancellationDuringAdvanceSkipsLaterTask() {
    let scheduler = TestScheduler()
    var laterRan = false
    var later: Cancellable?
    scheduler.postDelayed(50) { later?.cancel() }
    later = scheduler.postDelayed(100) { laterRan = true }

    scheduler.advance(200)

    XCTAssertFalse(laterRan)
  }

  func testSessionGuardRunsForActiveCurrentSession() {
    let scheduler = TestScheduler()
    let session = BoardSession(id: 1)
    var calls = 0

    scheduler.postDelayedForSession(session, delayMs: 10, isCurrent: { $0 === session }) { _ in
      calls += 1
    }
    scheduler.advance(10)

    XCTAssertEqual(1, calls)
  }

  func testSessionGuardSkipsInvalidatedAndStaleSessions() {
    let scheduler = TestScheduler()
    let invalidated = BoardSession(id: 1)
    let stale = BoardSession(id: 2)
    let current = BoardSession(id: 3)
    var calls = 0

    scheduler.postDelayedForSession(invalidated, delayMs: 10, isCurrent: { _ in true }) { _ in
      calls += 1
    }
    scheduler.postDelayedForSession(stale, delayMs: 10, isCurrent: { $0 === current }) { _ in
      calls += 1
    }
    invalidated.invalidate()
    scheduler.advance(10)

    XCTAssertEqual(0, calls)
  }
}
