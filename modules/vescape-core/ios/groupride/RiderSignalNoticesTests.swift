import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RiderSignalNoticesTest.kt
final class RiderSignalNoticesTests: XCTestCase {
  private var notices = RiderSignalNotices()
  private let engine = RideNoticeEngine()

  private func signal(_ kind: RiderSignalKind, startedAt: Int64 = 1_000, expiresAt: Int64 = 601_000) -> RiderSignal {
    RiderSignal(kind: kind, lat: 50, lng: 19, startedAt: startedAt, expiresAt: expiresAt)
  }

  private func rider(_ id: String, _ name: String, _ signal: RiderSignal?) -> SignalRider {
    SignalRider(id: id, name: name, signal: signal)
  }

  /// A roster at relay `now` 10_000 seen at phone time 5_010_000: offset +5_000_000.
  @discardableResult
  private func roster(_ riders: SignalRider..., relayNow: Int64? = 10_000, localNow: Int64 = 5_010_000) -> RiderSignalNotices.Update {
    let update = notices.roster(riders, ownRiderId: "me", relayNow: relayNow, localNow: localNow)
    update.clears.forEach { _ = engine.clear(key: $0) }
    update.posts.forEach { _ = engine.post(key: $0.key, content: $0.content, revision: $0.revision, nowMs: localNow) }
    return update
  }

  func testAnotherRidersSignalPostsALocatedNoticeOnThePhoneClock() throws {
    let post = try XCTUnwrap(roster(rider("ola", "Ola", signal(.board))).posts.first)

    XCTAssertEqual(post.key, "riderSignal:ola")
    XCTAssertEqual(post.revision, "1000")
    XCTAssertEqual(post.content.title, "Ola: Board problem")
    XCTAssertEqual(post.content.details, "")
    XCTAssertEqual(post.content.severity, .warning)
    XCTAssertEqual(post.content.location, RideNoticeLocation(lat: 50, lng: 19))
    XCTAssertEqual(post.content.postedAt, 5_001_000)
    XCTAssertEqual(post.content.expiresAt, 5_601_000)
  }

  func testDownAndHelpAreCritical() {
    let posts = roster(rider("a", "A", signal(.down)), rider("b", "B", signal(.help)), rider("c", "C", signal(.wait))).posts
    XCTAssertEqual(posts.map(\.content.severity), [.critical, .critical, .warning])
  }

  func testTheRidersOwnSignalPostsNothing() {
    XCTAssertTrue(roster(rider("me", "Me", signal(.help))).posts.isEmpty)
  }

  func testAReSentRosterWithAnotherRelayNowKeepsTheFirstConversion() {
    let first = roster(rider("ola", "Ola", signal(.board))).posts
    let again = roster(rider("ola", "Ola", signal(.board)), relayNow: 11_000, localNow: 5_011_250).posts
    XCTAssertEqual(first, again)
  }

  func testClearingTheSignalOrLeavingClearsTheNotice() {
    roster(rider("ola", "Ola", signal(.board)), rider("kai", "Kai", signal(.wait)))

    XCTAssertEqual(roster(rider("ola", "Ola", nil), rider("kai", "Kai", signal(.wait))).clears, ["riderSignal:ola"])
    XCTAssertEqual(roster().clears, ["riderSignal:kai"])
    XCTAssertTrue(engine.active.isEmpty)
  }

  func testResetClearsEveryPostedNotice() {
    roster(rider("ola", "Ola", signal(.board)), rider("kai", "Kai", signal(.wait)))

    XCTAssertEqual(Set(notices.reset()), ["riderSignal:ola", "riderSignal:kai"])
    XCTAssertTrue(notices.reset().isEmpty)
  }

  func testADismissedNoticeStaysHiddenAcrossReSendsAndARenameAndShowsAgainOnANewStartedAt() throws {
    roster(rider("ola", "Ola", signal(.board)))
    let shown = try XCTUnwrap(engine.active.first)
    _ = engine.dismiss(id: shown.id, rev: shown.rev)

    roster(rider("ola", "Ola", signal(.board)))
    roster(rider("ola", "Ola K", signal(.board)))
    XCTAssertTrue(engine.active.isEmpty)

    roster(rider("ola", "Ola K", signal(.down, startedAt: 9_000)))
    XCTAssertEqual(engine.active.map(\.content.title), ["Ola K: Rider down"])
  }

  func testARosterWithoutRelayNowUsesSignalTimesAsTheyAre() throws {
    let post = try XCTUnwrap(roster(rider("ola", "", signal(.wait)), relayNow: nil, localNow: 2_000).posts.first)
    XCTAssertEqual(post.content.title, "Rider: Wait for me")
    XCTAssertEqual(post.content.postedAt, 1_000)
  }
}
