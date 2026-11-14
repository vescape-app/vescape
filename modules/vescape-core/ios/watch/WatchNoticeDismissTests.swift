import XCTest
@testable import VescapeCore

/// Wrist dismiss: the wire bytes a wrist sends go through `BoardSessionController`'s real
/// command routing into the process-wide `RideNotices` the phone card dismisses, and nothing else.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchNoticeDismissTest.kt
final class WatchNoticeDismissTests: XCTestCase {
  private var controller: BoardSessionController!
  private let keys = ["watch-dismiss-a", "watch-dismiss-b"]

  override func setUp() {
    super.setUp()
    controller = BoardSessionController(scheduler: TestScheduler())
    keys.forEach { RideNotices.shared.clear(key: $0) }
  }

  override func tearDown() {
    keys.forEach { RideNotices.shared.clear(key: $0) }
    controller = nil
    super.tearDown()
  }

  private func post(_ key: String, revision: String = "r1") {
    RideNotices.shared.post(
      key: key,
      content: RideNoticeContent(
        severity: .info, title: key, details: "Details", postedAt: 0,
        location: RideNoticeLocation(lat: 52, lng: 21), expiresAt: nil
      ),
      revision: revision
    )
  }

  private func notice(_ key: String) -> RideNotice? {
    RideNotices.shared.current.first { $0.key == key }
  }

  private func relay(_ bytes: [UInt8]) {
    guard let command = WatchCommandCodec.decode(Data(bytes)) else { return }
    controller.acceptWatchCommand(command)
  }

  func testADismissRoundTripsItsIdAndRevOverTheWholeUnsignedByte() {
    XCTAssertEqual(WatchCommandCodec.decode(Data([6, 1, 2])), .dismissNotice(id: 1, rev: 2))
    XCTAssertEqual(WatchCommandCodec.decode(Data([6, 255, 255])), .dismissNotice(id: 255, rev: 255))
    XCTAssertEqual(WatchCommandCodec.encode(.dismissNotice(id: 7, rev: 3)), Data([6, 7, 3]))
  }

  func testADismissWithoutItsRevByteIsDropped() {
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.dismissNotice])))
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.dismissNotice, 1])))
  }

  func testAWristDismissRemovesTheNoticeHoldingThatIdAndLeavesTheRest() throws {
    post(keys[0])
    post(keys[1])
    let a = try XCTUnwrap(notice(keys[0]))
    relay([6, UInt8(a.id), UInt8(a.rev)])
    XCTAssertNil(notice(keys[0]))
    XCTAssertNotNil(notice(keys[1]))
  }

  func testADismissForTheRevisionTheWristSawLeavesAReSentRevisionShowing() throws {
    post(keys[0])
    let seen = try XCTUnwrap(notice(keys[0]))
    post(keys[0], revision: "r2")
    relay([6, UInt8(seen.id), UInt8(seen.rev)])
    XCTAssertEqual(notice(keys[0])?.rev, seen.rev + 1)
    relay([6, UInt8(seen.id), UInt8(seen.rev + 1)])
    XCTAssertNil(notice(keys[0]))
  }
}
