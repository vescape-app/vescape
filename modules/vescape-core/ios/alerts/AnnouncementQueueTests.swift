import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/AnnouncementQueueTest.kt
final class AnnouncementQueueTests: XCTestCase {
  private final class Item {
    let name: String
    init(_ name: String) { self.name = name }
  }

  private enum Step: Equatable {
    case play(String)
    case wait(Int64)
    case idle
  }

  private var queue = AnnouncementQueue<Item>(settleMs: 4_000, quietGapMs: 2_000)
  private var dropped: [String] = []

  override func setUp() {
    queue = AnnouncementQueue<Item>(settleMs: 4_000, quietGapMs: 2_000)
    dropped = []
  }

  private func next(_ now: Int64) -> Step {
    switch queue.next(now: now, onDrop: { self.dropped.append($0.name) }) {
    case .play(let item): return .play(item.name)
    case .waitUntil(let at): return .wait(at)
    case .idle: return .idle
    }
  }

  private func enqueue(_ name: String, _ priority: AnnouncementPriority, now: Int64 = 0, ttlMs: Int64 = 60_000) {
    queue.enqueue(Item(name), priority: priority, now: now, ttlMs: ttlMs)
  }

  func testPlaysOneAtATimeInPriorityOrderOldestFirst() {
    enqueue("social", .social)
    enqueue("ride end", .advisory)
    enqueue("weather", .advisory)
    enqueue("on", .connection)
    XCTAssertEqual(next(0), .play("on"))
    XCTAssertEqual(next(0), .idle)
    _ = queue.finished(.completed, now: 100)
    XCTAssertEqual(next(100), .play("ride end"))
    _ = queue.finished(.failed, now: 200)
    XCTAssertEqual(next(200), .play("weather"))
    _ = queue.finished(.completed, now: 300)
    XCTAssertEqual(next(300), .play("social"))
  }

  func testSettleWindowHoldsAllButConnectionItemsAndTheConnectCue() {
    queue.connected(now: 0)
    enqueue("on", .connection)
    enqueue("joined", .social, now: 500)
    XCTAssertEqual(next(500), .play("on"))
    _ = queue.finished(.completed, now: 1_000)
    XCTAssertEqual(next(1_000), .wait(4_000))
    XCTAssertEqual(next(4_000), .play("joined"))
  }

  func testCriticalPreemptsRequeuesOnceAndResumesAfterQuietGap() {
    let first = Item("ride end")
    queue.enqueue(first, priority: .advisory, now: 0, ttlMs: 60_000)
    XCTAssertEqual(next(0), .play("ride end"))
    XCTAssertTrue(queue.criticalStarted() === first)
    XCTAssertNil(queue.finished(.cancelled, now: 10))
    XCTAssertEqual(next(10), .idle)
    queue.criticalEnded(now: 1_000)
    XCTAssertEqual(next(1_000), .wait(3_000))
    XCTAssertEqual(next(3_000), .play("ride end"))
    _ = queue.criticalStarted()
    XCTAssertTrue(queue.finished(.cancelled, now: 3_100) === first)
    queue.criticalEnded(now: 3_200)
    XCTAssertEqual(next(10_000), .idle)
  }

  func testOverlappingCriticalAlertsHoldUntilTheLastEnds() {
    enqueue("joined", .social)
    _ = queue.criticalStarted()
    _ = queue.criticalStarted()
    queue.criticalEnded(now: 100)
    XCTAssertEqual(next(100), .idle)
    queue.criticalEnded(now: 500)
    XCTAssertEqual(next(500), .wait(2_500))
  }

  func testPreemptedItemThatExpiredMeanwhileIsDropped() {
    let item = Item("joined")
    queue.enqueue(item, priority: .social, now: 0, ttlMs: 1_000)
    XCTAssertEqual(next(0), .play("joined"))
    _ = queue.criticalStarted()
    XCTAssertTrue(queue.finished(.cancelled, now: 1_500) === item)
  }

  func testExpiredItemsAreDroppedNeverPlayedLate() {
    enqueue("joined", .social, ttlMs: 1_000)
    enqueue("left", .social, ttlMs: 9_000)
    _ = queue.criticalStarted()
    queue.criticalEnded(now: 0)
    XCTAssertEqual(next(0), .wait(1_000))
    XCTAssertEqual(next(1_000), .wait(2_000))
    XCTAssertEqual(dropped, ["joined"])
    XCTAssertEqual(next(2_000), .play("left"))
  }

  func testClearReturnsPlayingAndPendingAndEndsSettle() {
    queue.connected(now: 0)
    enqueue("on", .connection)
    enqueue("joined", .social)
    XCTAssertEqual(next(0), .play("on"))
    XCTAssertEqual(queue.clear().map(\.name), ["on", "joined"])
    XCTAssertNil(queue.playing)
    enqueue("joined", .social, now: 10)
    XCTAssertEqual(next(10), .play("joined"))
  }
}
