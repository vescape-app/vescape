import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/MirrorStateReducerTest.kt
final class MirrorStateTests: XCTestCase {
  private func frame(stale: Bool, waiting: Bool = false) -> WatchFrame {
    WatchFrame(
      speed: 18.5, duty: 42, battery: 83, motorTemp: 51, ctrlTemp: 48,
      stale: stale, waiting: waiting
    )
  }

  func testTransitionsLiveToStaleToDisconnectedToLiveOverTheClock() {
    let liveFrame = frame(stale: false)
    let staleFrame = frame(stale: true)

    let live = MirrorStateReducer.reduce(frame: liveFrame, lastFrameAtMs: 1_000, nowMs: 1_000)
    XCTAssertEqual(live.status, .live)
    XCTAssertEqual(live.frame, liveFrame)

    let stale = MirrorStateReducer.reduce(frame: staleFrame, lastFrameAtMs: 1_500, nowMs: 1_500)
    XCTAssertEqual(stale.status, .stale)
    XCTAssertEqual(stale.frame, staleFrame)

    let disconnected = MirrorStateReducer.reduce(
      frame: staleFrame,
      lastFrameAtMs: 1_500,
      nowMs: 1_500 + MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: nil) + 1
    )
    XCTAssertEqual(disconnected.status, .disconnected)
    XCTAssertNil(disconnected.frame)

    let recovered = MirrorStateReducer.reduce(frame: liveFrame, lastFrameAtMs: 3_500, nowMs: 3_500)
    XCTAssertEqual(recovered.status, .live)
    XCTAssertEqual(recovered.frame, liveFrame)
  }

  func testFreshLegacyWaitingFrameIsRenderableAndEmpty() {
    let waitingFrame = frame(stale: true, waiting: true)

    let waiting = MirrorStateReducer.reduce(frame: waitingFrame, lastFrameAtMs: 1_000, nowMs: 1_000)
    XCTAssertEqual(waiting.status, .waiting)
    XCTAssertNil(waiting.frame?.speed)
    XCTAssertNil(waiting.frame?.duty)
    XCTAssertNil(waiting.frame?.battery)

    let timedOut = MirrorStateReducer.reduce(
      frame: waitingFrame,
      lastFrameAtMs: 1_000,
      nowMs: 1_000 + MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: nil) + 1
    )
    XCTAssertEqual(timedOut.status, .disconnected)
  }

  func testTheDisconnectWindowFollowsTheObservedPushCadence() {
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: nil), 750)
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 50), 750)
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 1_000), 3_000)
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 600_000), 30_000)
  }

  func testNoFrameIsDisconnected() {
    let state = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)

    XCTAssertEqual(state.status, .disconnected)
    XCTAssertNil(state.frame)
  }

  func testAReachablePhoneAppThatIsNotPushingGetsNoNotice() {
    let disconnected = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)

    XCTAssertNil(MirrorStateReducer.linkNotice(status: disconnected.status, link: .appReachable))
  }

  func testPhoneLinkProblemsAreStillNamedWhileNoFramesArrive() {
    let disconnected = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0).status

    XCTAssertEqual(MirrorStateReducer.linkNotice(status: disconnected, link: .unknown), .connecting)
    XCTAssertEqual(MirrorStateReducer.linkNotice(status: disconnected, link: .noPhone), .noPhone)
    XCTAssertEqual(MirrorStateReducer.linkNotice(status: disconnected, link: .phoneOnly), .appMissing)
  }

  func testABoardlessNavigationFrameIsLiveWithItsNavLanesAndNoNotice() {
    let navOnly = WatchFrame(navBearing: 42, navDistanceM: 1_250)

    let state = MirrorStateReducer.reduce(frame: navOnly, lastFrameAtMs: 1_000, nowMs: 1_000)

    XCTAssertEqual(state.status, .live)
    XCTAssertEqual(state.frame?.navDistanceM, 1_250)
    XCTAssertNil(state.frame?.speed)
    for link in [MirrorPhoneLink.unknown, .noPhone, .phoneOnly, .appReachable] {
      XCTAssertNil(MirrorStateReducer.linkNotice(status: state.status, link: link))
    }
  }

  func testTheWaitingFlagSurvivesTheWire() throws {
    let decoded = try XCTUnwrap(
      WatchFrameBuilder.decode(WatchFrameBuilder.encode(frame(stale: false, waiting: true)))
    )

    XCTAssertTrue(decoded.waiting)
    XCTAssertFalse(decoded.stale)
    XCTAssertEqual(MirrorStateReducer.reduce(frame: decoded, lastFrameAtMs: 0, nowMs: 0).status, .waiting)
  }
}
