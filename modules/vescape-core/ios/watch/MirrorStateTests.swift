import XCTest
@testable import VescapeCore

/// The wrist's own reducer, checked against the Android one case for case. Both wrists have to
/// decide "live / stale / waiting / disconnected" from the same frame and the same clock, or the
/// rectangular layout would be free to disagree about when a reading stopped being true.
///
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
    // Default cadence when nothing has been observed yet, and its own floor.
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: nil), 750)
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 50), 750)
    // A rider-chosen slower cadence widens the window instead of pinning the mirror offline.
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 1_000), 3_000)
    // A long stall cannot widen it without bound.
    XCTAssertEqual(MirrorStateReducer.disconnectedTimeoutMs(frameGapMs: 600_000), 30_000)
  }

  func testNoFrameIsDisconnected() {
    let state = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)

    XCTAssertEqual(state.status, .disconnected)
    XCTAssertNil(state.frame)
  }

  /// The waiting bit is never set by this phone side, but it is part of the wire format. A decoder
  /// that dropped it would hand the reducer a `live` frame full of empty lanes.
  func testTheWaitingFlagSurvivesTheWire() throws {
    let decoded = try XCTUnwrap(
      WatchFrameBuilder.decode(WatchFrameBuilder.encode(frame(stale: false, waiting: true)))
    )

    XCTAssertTrue(decoded.waiting)
    XCTAssertFalse(decoded.stale)
    XCTAssertEqual(MirrorStateReducer.reduce(frame: decoded, lastFrameAtMs: 0, nowMs: 0).status, .waiting)
  }
}
