import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/notices/RideNoticeEngineTest.kt
final class RideNoticeEngineTests: XCTestCase {
  private var engine = RideNoticeEngine()

  override func setUp() {
    engine = RideNoticeEngine()
  }

  private func content(
    _ severity: RideNoticeSeverity = .info,
    title: String = "Title",
    postedAt: Int64 = 1_000,
    expiresAt: Int64? = nil
  ) -> RideNoticeContent {
    RideNoticeContent(
      severity: severity, title: title, details: "Details", postedAt: postedAt,
      location: RideNoticeLocation(lat: 52, lng: 21), expiresAt: expiresAt
    )
  }

  private var keys: [String] { engine.active.map(\.key) }

  func testAPostShowsTheNoticeWithRev1() {
    XCTAssertEqual(engine.post(key: "a", content: content(), revision: "r1", nowMs: 0), .changed)
    let notice = engine.active.first
    XCTAssertEqual(engine.active.count, 1)
    XCTAssertEqual(notice?.id, 1)
    XCTAssertEqual(notice?.rev, 1)
    XCTAssertEqual(notice?.key, "a")
  }

  func testAnIdenticalRePostChangesNothing() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    XCTAssertEqual(engine.post(key: "a", content: content(), revision: "r1", nowMs: 0), .unchanged)
  }

  func testASameRevisionRePostUpdatesInPlaceWithoutBumpingRev() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    XCTAssertEqual(engine.post(key: "a", content: content(title: "New"), revision: "r1", nowMs: 0), .changed)
    XCTAssertEqual(engine.active.first?.content.title, "New")
    XCTAssertEqual(engine.active.first?.rev, 1)
    XCTAssertEqual(engine.active.first?.id, 1)
  }

  func testADismissedNoticeStaysHiddenOnASameRevisionUpdate() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    XCTAssertTrue(engine.dismiss(id: 1))
    XCTAssertEqual(engine.post(key: "a", content: content(title: "New"), revision: "r1", nowMs: 0), .unchanged)
    XCTAssertTrue(engine.active.isEmpty)
  }

  func testANewRevisionShowsADismissedNoticeAgainAndBumpsRev() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    _ = engine.dismiss(id: 1)
    XCTAssertEqual(engine.post(key: "a", content: content(), revision: "r2", nowMs: 0), .changed)
    XCTAssertEqual(engine.active.first?.rev, 2)
    XCTAssertEqual(engine.active.first?.id, 1)
  }

  func testRevWrapsFrom255To1() {
    _ = engine.post(key: "a", content: content(), revision: "r0", nowMs: 0)
    for revision in 1...254 { _ = engine.post(key: "a", content: content(), revision: "r\(revision)", nowMs: 0) }
    XCTAssertEqual(engine.active.first?.rev, 255)
    _ = engine.post(key: "a", content: content(), revision: "wrap", nowMs: 0)
    XCTAssertEqual(engine.active.first?.rev, 1)
  }

  func testDismissingAnUnknownOrAlreadyDismissedIdChangesNothing() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    XCTAssertFalse(engine.dismiss(id: 9))
    _ = engine.dismiss(id: 1)
    XCTAssertFalse(engine.dismiss(id: 1))
  }

  func testClearRemovesANoticeAndClearingADismissedOneEmitsNothing() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    _ = engine.post(key: "b", content: content(), revision: "r1", nowMs: 0)
    XCTAssertTrue(engine.clear(key: "a"))
    XCTAssertEqual(keys, ["b"])
    _ = engine.dismiss(id: 2)
    XCTAssertFalse(engine.clear(key: "b"))
    XCTAssertFalse(engine.clear(key: "missing"))
    // Cleared: a fresh post of the key shows again even with the old revision.
    XCTAssertEqual(engine.post(key: "b", content: content(), revision: "r1", nowMs: 0), .changed)
  }

  func testExpiredNoticesDropSilentlyOnTick() {
    _ = engine.post(key: "a", content: content(expiresAt: 5_000), revision: "r1", nowMs: 0)
    _ = engine.post(key: "b", content: content(expiresAt: 9_000), revision: "r1", nowMs: 0)
    XCTAssertEqual(engine.nextExpiryAt(), 5_000)
    XCTAssertFalse(engine.tick(nowMs: 4_999))
    XCTAssertTrue(engine.tick(nowMs: 5_000))
    XCTAssertEqual(keys, ["b"])
    _ = engine.dismiss(id: 2)
    XCTAssertFalse(engine.tick(nowMs: 9_000))
    XCTAssertNil(engine.nextExpiryAt())
  }

  func testAnAlreadyExpiredPostClearsTheKey() {
    _ = engine.post(key: "a", content: content(), revision: "r1", nowMs: 0)
    XCTAssertEqual(engine.post(key: "a", content: content(expiresAt: 10), revision: "r2", nowMs: 10), .changed)
    XCTAssertTrue(engine.active.isEmpty)
    XCTAssertEqual(engine.post(key: "b", content: content(expiresAt: 10), revision: "r1", nowMs: 10), .unchanged)
  }

  func testOrdersBySeverityThenNewestPostedAtNeverRePostTime() {
    _ = engine.post(key: "old-info", content: content(postedAt: 1_000), revision: "r1", nowMs: 0)
    _ = engine.post(key: "warning", content: content(.warning, postedAt: 500), revision: "r1", nowMs: 0)
    _ = engine.post(key: "new-info", content: content(postedAt: 2_000), revision: "r1", nowMs: 0)
    _ = engine.post(key: "critical", content: content(.critical, postedAt: 100), revision: "r1", nowMs: 0)
    // Re-posting the old notice later does not move it up.
    _ = engine.post(key: "old-info", content: content(postedAt: 1_000), revision: "r2", nowMs: 50_000)
    XCTAssertEqual(keys, ["critical", "warning", "new-info", "old-info"])
  }

  func testIdsAreRoundRobinAndSkipActiveIds() {
    _ = engine.post(key: "a", content: content(), revision: "r", nowMs: 0)
    _ = engine.post(key: "b", content: content(), revision: "r", nowMs: 0)
    _ = engine.clear(key: "a")
    // Freed id 1 is not reused straight away.
    _ = engine.post(key: "c", content: content(), revision: "r", nowMs: 0)
    XCTAssertEqual(engine.active.first { $0.key == "c" }?.id, 3)
  }

  func testIdsWrapPast255AndAFullTableDropsThePost() {
    for i in 1...255 {
      XCTAssertEqual(engine.post(key: "k\(i)", content: content(), revision: "r", nowMs: 0), .changed)
    }
    XCTAssertEqual(engine.post(key: "extra", content: content(), revision: "r", nowMs: 0), .dropped)
    _ = engine.clear(key: "k7")
    _ = engine.post(key: "extra", content: content(), revision: "r", nowMs: 0)
    XCTAssertEqual(engine.active.first { $0.key == "extra" }?.id, 7)
  }
}
