import XCTest
@testable import VescapeCore

/// Wrist dismiss (#652): the wire bytes a wrist sends land on the same engine dismiss the phone card
/// uses, and nothing else.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchNoticeDismissTest.kt
final class WatchNoticeDismissTests: XCTestCase {
  private var engine = RideNoticeEngine()

  override func setUp() {
    engine = RideNoticeEngine()
  }

  private func post(_ key: String) {
    _ = engine.post(
      key: key,
      content: RideNoticeContent(
        severity: .info, title: key, details: "Details", postedAt: 0,
        location: RideNoticeLocation(lat: 52, lng: 21), expiresAt: nil
      ),
      revision: "r1", nowMs: 0
    )
  }

  /// What `BoardSessionController.acceptWatchCommand` does with a decoded dismiss.
  private func relay(_ bytes: [UInt8]) -> Bool {
    guard case .dismissNotice(let id) = WatchCommandCodec.decode(Data(bytes)) else { return false }
    return engine.dismiss(id: id)
  }

  func testADismissRoundTripsItsIdOverTheWholeUnsignedByte() {
    XCTAssertEqual(WatchCommandCodec.decode(Data([WatchCommandKind.dismissNotice, 1])), .dismissNotice(1))
    XCTAssertEqual(WatchCommandCodec.decode(Data([WatchCommandKind.dismissNotice, 255])), .dismissNotice(255))
    XCTAssertEqual(WatchCommandCodec.encode(.dismissNotice(7)), Data([6, 7]))
  }

  func testADismissWithoutItsIdByteIsDropped() {
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.dismissNotice])))
  }

  func testAWristDismissRemovesTheNoticeHoldingThatIdAndLeavesTheRest() {
    post("a")
    post("b")
    let id = engine.active.first { $0.key == "a" }!.id
    XCTAssertTrue(relay([6, UInt8(id)]))
    XCTAssertEqual(engine.active.map(\.key), ["b"])
  }

  func testADismissForAnIdThatIsNotActiveIsIgnored() {
    post("a")
    XCTAssertFalse(relay([6, 42]))
    let id = engine.active[0].id
    _ = relay([6, UInt8(id)])
    XCTAssertFalse(relay([6, UInt8(id)]))
    XCTAssertTrue(engine.active.isEmpty)
  }
}
