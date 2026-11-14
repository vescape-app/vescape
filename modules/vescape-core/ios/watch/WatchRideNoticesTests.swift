import XCTest
@testable import VescapeCore

/// The wrist's Ride Notice card and buzz rules, through the intake the watchOS Mirror runs.
///
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchRideNoticesTest.kt
final class WatchRideNoticesTests: XCTestCase {
  private var now: Int64 = 1_000
  private var intake = WatchMirrorIntake()
  private var sentAt: Int64 = 0

  override func setUp() {
    super.setUp()
    now = 1_000
    sentAt = 0
    intake = WatchMirrorIntake()
    intake.wallClockMs = { [unowned self] in self.now }
  }

  private func notice(_ id: Int, rev: Int = 1, title: String = "Rider down", expiresAtMs: Int64? = nil) -> RideNoticeFrameItem {
    RideNoticeFrameItem(id: id, rev: rev, severity: .critical, title: title, details: "Ola", expiresAtMs: expiresAtMs)
  }

  private func encoded(_ notices: [RideNoticeFrameItem], sentAtMs: Int64) -> Data {
    RideNoticeFrameCodec.encode(RideNoticeFrame(sentAtMs: sentAtMs, notices: notices))
  }

  @discardableResult
  private func push(_ notices: RideNoticeFrameItem...) -> Bool {
    sentAt += 1
    return intake.acceptRideNotices(encoded(notices, sentAtMs: sentAt))
  }

  func testANewPairBuzzesAndShowsAnUpdateInPlaceDoesNeither() {
    XCTAssertTrue(push(notice(1)))
    XCTAssertEqual(intake.rideNoticeCard?.id, 1)

    XCTAssertFalse(push(notice(1, title: "Rider down · 200 m")))
    XCTAssertEqual(intake.rideNoticeCard?.title, "Rider down · 200 m")
  }

  func testANewRevisionOrAReusedIdBuzzesAgainAndBringsBackAHiddenCard() {
    push(notice(1))
    intake.hideRideNotice(id: 1, rev: 1)
    XCTAssertNil(intake.rideNoticeCard)
    XCTAssertFalse(push(notice(1)))
    XCTAssertNil(intake.rideNoticeCard)

    XCTAssertTrue(push(notice(1, rev: 2)))
    XCTAssertEqual(intake.rideNoticeCard?.rev, 2)

    push()
    XCTAssertNil(intake.rideNoticeCard)
    XCTAssertTrue(push(notice(1, rev: 2)))
  }

  func testHidingTheTopCardShowsTheNextOne() {
    push(notice(1), notice(2))
    intake.hideRideNotice(id: 1, rev: 1)

    XCTAssertEqual(intake.rideNoticeCard?.id, 2)
  }

  func testExpiredNoticesLeaveWithoutAPhonePush() {
    push(notice(1, expiresAtMs: 5_000))
    now = 5_000
    intake.refresh(nowMs: 0)

    XCTAssertNil(intake.rideNoticeCard)
  }

  func testTheRetainedCopyOfALiveMessageAndOlderFramesAreIgnored() {
    let bytes = encoded([notice(1)], sentAtMs: 10)
    XCTAssertTrue(intake.acceptRideNotices(bytes))
    XCTAssertFalse(intake.restoreColdState([watchRideNoticesChannel: [watchRideNoticesFrameKey: bytes]]))

    XCTAssertFalse(intake.acceptRideNotices(encoded([], sentAtMs: 5)))
    XCTAssertEqual(intake.rideNoticeCard?.id, 1)
  }

  func testAContextWithoutTheChannelOrAnUnreadableFrameKeepsTheList() {
    push(notice(1))
    var newer = [UInt8](encoded([], sentAtMs: 99))
    newer[0] = UInt8(WATCH_RIDE_NOTICES_VERSION + 1)

    XCTAssertFalse(intake.acceptRideNotices(Data(newer)))
    XCTAssertFalse(intake.restoreColdState([:]))
    XCTAssertEqual(intake.rideNoticeCard?.id, 1)
  }
}
