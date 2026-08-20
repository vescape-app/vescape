import UIKit
import XCTest

@testable import VescapeCore

/// The foreground→lock handoff for a Board Presence Scan (#405). The task must cover the scan and
/// nothing more: no keep-alive, no double-begin, and no orphaned identifier when the scan ends
/// twice or expires first.
final class PresenceScanBackgroundTaskTests: XCTestCase {
  private var begun: [String] = []
  private var ended: [UIBackgroundTaskIdentifier] = []
  private var events: [String] = []
  private var expiry: (() -> Void)?
  private var nextId: Int = 7

  private func makeTask() -> PresenceScanBackgroundTask {
    PresenceScanBackgroundTask(
      begin: { name, expiration in
        self.begun.append(name)
        self.expiry = expiration
        return UIBackgroundTaskIdentifier(rawValue: self.nextId)
      },
      end: { self.ended.append($0) },
      onEvent: { self.events.append($0) }
    )
  }

  func testStartBeginsExactlyOneTask() {
    let task = makeTask()

    task.start()

    XCTAssertEqual(begun.count, 1)
    XCTAssertTrue(task.isRunning)
    XCTAssertEqual(events, [ConnectionTraceEvent.backgroundTaskStarted])
  }

  func testSecondStartDoesNotOrphanTheFirstIdentifier() {
    let task = makeTask()

    task.start()
    task.start()

    XCTAssertEqual(begun.count, 1)
    task.end()
    XCTAssertEqual(ended.count, 1)
  }

  func testEndReleasesTheTaskOnceOnly() {
    let task = makeTask()
    task.start()

    task.end()
    task.end()

    XCTAssertEqual(ended, [UIBackgroundTaskIdentifier(rawValue: 7)])
    XCTAssertFalse(task.isRunning)
    XCTAssertEqual(
      events,
      [ConnectionTraceEvent.backgroundTaskStarted, ConnectionTraceEvent.backgroundTaskEnded]
    )
  }

  func testEndingBeforeStartIsANoOp() {
    let task = makeTask()

    task.end()

    XCTAssertTrue(ended.isEmpty)
    XCTAssertTrue(events.isEmpty)
  }

  func testExpirationEndsTheTaskAndIsNamed() {
    let task = makeTask()
    task.start()

    expiry?()

    XCTAssertEqual(ended.count, 1)
    XCTAssertFalse(task.isRunning)
    XCTAssertEqual(
      events,
      [
        ConnectionTraceEvent.backgroundTaskStarted,
        ConnectionTraceEvent.backgroundTaskExpired,
        ConnectionTraceEvent.backgroundTaskEnded,
      ]
    )
  }

  func testAStaleEndAfterExpiryCannotReleaseANewerTask() {
    let task = makeTask()
    task.start()
    expiry?()

    // The scan's own terminal phase arrives after iOS already reclaimed the task.
    task.end()
    // A later scan takes a fresh identifier, untouched by the stale end above.
    nextId = 9
    task.start()

    XCTAssertEqual(ended, [UIBackgroundTaskIdentifier(rawValue: 7)])
    XCTAssertTrue(task.isRunning)
    task.end()
    XCTAssertEqual(ended.last, UIBackgroundTaskIdentifier(rawValue: 9))
  }

  func testAFailedBeginLeavesNothingRunning() {
    let task = PresenceScanBackgroundTask(
      begin: { _, _ in .invalid },
      end: { self.ended.append($0) },
      onEvent: { self.events.append($0) }
    )

    task.start()

    XCTAssertFalse(task.isRunning)
    XCTAssertTrue(events.isEmpty)
    task.end()
    XCTAssertTrue(ended.isEmpty)
  }
}
