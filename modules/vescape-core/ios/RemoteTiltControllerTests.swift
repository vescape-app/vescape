import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RemoteTiltControllerTest.kt
final class RemoteTiltControllerTests: XCTestCase {
  private var sent: [[UInt8]] = []
  private var urgentSent: [[UInt8]] = []
  private var transport: BoardTransport? = .direct
  private var scheduler = TestScheduler()

  override func setUp() {
    super.setUp()
    sent = []
    urgentSent = []
    transport = .direct
    scheduler = TestScheduler()
  }

  private func makeController() -> RemoteTiltController {
    RemoteTiltController(
      transport: { self.transport },
      send: { payload, urgent in
        self.sent.append(payload)
        if urgent { self.urgentSent.append(payload) }
        return true
      },
      scheduler: scheduler
    )
  }

  private func tilt(_ value: Int) -> [UInt8] {
    buildRemoteTiltCommand(transport: .direct, value: value)
  }

  /// Mirrors the controller's linear ease so expectations track the formula.
  private func decayValue(from: Int, steps: Int, tick: Int) -> Int {
    if tick >= steps { return REMOTE_TILT_CENTER }
    let progress = Double(tick) / Double(steps)
    return Int((Double(from) + Double(REMOTE_TILT_CENTER - from) * progress).rounded())
  }

  func testHoldSendsImmediatelyThenRepeatsLatestValue() {
    let controller = makeController()

    XCTAssertTrue(controller.hold(200))
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0], tilt(200))

    scheduler.advance(100)
    XCTAssertEqual(sent.count, 2)
    XCTAssertEqual(sent[1], tilt(200))
  }

  func testRapidHoldUpdatesCoalesceToLatestWithoutFloodingWrites() {
    let controller = makeController()

    controller.hold(140)  // first press sends immediately
    controller.hold(160)  // already streaming: swap value only, no extra write
    controller.hold(200)  // already streaming: swap value only, no extra write
    XCTAssertEqual(sent.count, 1)

    scheduler.advance(100)  // a single repeat tick emits just the latest value
    XCTAssertEqual(sent.count, 2)
    XCTAssertEqual(sent[1], tilt(200))
  }

  func testReleaseEasesLinearlyToNeutralThenStops() {
    let controller = makeController()
    let from = 255
    let steps = 4  // 400ms / 100ms

    XCTAssertTrue(controller.release(from, durationMs: 400))
    XCTAssertEqual(sent[0], tilt(from))  // immediate from-value

    scheduler.advance(400)
    // ticks 1..4 emitted; mid-ramp value is interpolated, last lands on neutral.
    XCTAssertEqual(sent[1], tilt(decayValue(from: from, steps: steps, tick: 1)))
    XCTAssertEqual(sent.last, tilt(REMOTE_TILT_CENTER))
    XCTAssertEqual(sent.count, 5)

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 5)  // stream ended; no further repeats
  }

  func testHoldThenReleaseEasesFromHeldValue() {
    let controller = makeController()
    controller.hold(255)  // live drag streams immediately
    XCTAssertEqual(sent.count, 1)

    controller.release(255, durationMs: 400)  // hands off to decay without an extra write
    XCTAssertEqual(sent.count, 1)

    scheduler.advance(400)
    XCTAssertEqual(sent.last, tilt(REMOTE_TILT_CENTER))
  }

  func testReleaseWithSubTickDurationSnapsToNeutral() {
    let controller = makeController()
    controller.hold(200)
    sent.removeAll()

    XCTAssertTrue(controller.release(200, durationMs: 50))  // < one 100ms tick
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0], tilt(REMOTE_TILT_CENTER))

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 1)  // no decay ticks
  }

  func testStopSnapsToNeutralAndCancelsRepeat() {
    let controller = makeController()
    controller.hold(200)
    sent.removeAll()

    XCTAssertTrue(controller.stop())
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0], tilt(REMOTE_TILT_CENTER))
    // The neutral must jump queued traffic, or the board holds tilt until its ~1s timeout.
    XCTAssertEqual(urgentSent, [tilt(REMOTE_TILT_CENTER)])

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 1)  // no further repeats after stop
  }

  /// The regression this exists for: cancelling a big tilt used to step straight to neutral, and
  /// the board surged to correct that angle error and threw the rider forward.
  func testCancelEasesLockedTiltBackToNeutralInsteadOfSnapping() {
    let controller = makeController()
    controller.lock(255)  // full nose-up
    sent.removeAll()

    XCTAssertTrue(controller.cancel())
    XCTAssertTrue(sent.isEmpty)  // the running loop owns the ramp; no extra immediate write
    XCTAssertEqual(controller.phase, .decaying)
    XCTAssertEqual(controller.decayProgress?.totalMs, 600)

    scheduler.advance(100)
    // First ramp step is a fraction of the way back, not neutral.
    XCTAssertTrue(((REMOTE_TILT_CENTER + 1)..<255).contains(controller.currentValue))

    scheduler.advance(500)
    XCTAssertEqual(sent.last, tilt(REMOTE_TILT_CENTER))
    XCTAssertEqual(controller.currentValue, REMOTE_TILT_CENTER)
    XCTAssertFalse(controller.isLocked)
    XCTAssertEqual(controller.phase, .idle)
  }

  func testCancelAtNeutralStopsImmediately() {
    let controller = makeController()
    controller.lock(REMOTE_TILT_CENTER)
    sent.removeAll()

    XCTAssertTrue(controller.cancel())
    XCTAssertEqual(sent, [tilt(REMOTE_TILT_CENTER)])
    XCTAssertEqual(controller.phase, .idle)
  }

  func testExposesCommandedValueAndLockState() {
    let controller = makeController()
    XCTAssertEqual(controller.currentValue, REMOTE_TILT_CENTER)
    XCTAssertFalse(controller.isLocked)

    controller.lock(200)
    XCTAssertEqual(controller.currentValue, 200)
    XCTAssertTrue(controller.isLocked)

    // A live drag (hold) clears the lock but keeps reporting the held value.
    controller.hold(160)
    XCTAssertEqual(controller.currentValue, 160)
    XCTAssertFalse(controller.isLocked)

    // Re-lock, then release: lock clears and the value tracks the ease.
    controller.lock(255)
    XCTAssertTrue(controller.isLocked)
    controller.release(255, durationMs: 400)
    XCTAssertFalse(controller.isLocked)
    scheduler.advance(200)  // mid-ease
    XCTAssertTrue((REMOTE_TILT_CENTER..<255).contains(controller.currentValue))

    scheduler.advance(400)  // ease completes
    XCTAssertEqual(controller.currentValue, REMOTE_TILT_CENTER)
    XCTAssertFalse(controller.isLocked)
  }

  func testStopClearsLockState() {
    let controller = makeController()
    controller.lock(200)
    XCTAssertTrue(controller.isLocked)

    controller.stop()
    XCTAssertFalse(controller.isLocked)
    XCTAssertEqual(controller.currentValue, REMOTE_TILT_CENTER)
  }

  func testPhaseTracksTheActiveStream() {
    let controller = makeController()
    XCTAssertEqual(controller.phase, .idle)
    XCTAssertNil(controller.decayProgress)

    controller.hold(200)
    XCTAssertEqual(controller.phase, .holding)

    controller.lock(200)
    XCTAssertEqual(controller.phase, .locked)

    controller.release(200, durationMs: 400)
    XCTAssertEqual(controller.phase, .decaying)
    XCTAssertEqual(controller.decayProgress, RemoteTiltDecayProgress(elapsedMs: 0, totalMs: 400))

    scheduler.advance(100)
    XCTAssertEqual(controller.decayProgress, RemoteTiltDecayProgress(elapsedMs: 100, totalMs: 400))

    scheduler.advance(400)
    XCTAssertEqual(controller.phase, .idle)
    XCTAssertNil(controller.decayProgress)
  }

  func testHoldReturnsFalseWhenNotStreamable() {
    transport = nil
    let controller = makeController()

    XCTAssertFalse(controller.hold(200))
    XCTAssertEqual(sent.count, 0)
  }

  func testRepeatStopsWhenTransportIsLost() {
    let controller = makeController()
    controller.hold(200)
    sent.removeAll()

    transport = nil
    scheduler.advance(100)  // repeat fires, sees no transport, stops the loop
    XCTAssertEqual(sent.count, 0)

    transport = .direct
    scheduler.advance(200)  // loop stayed stopped; nothing resurrects it
    XCTAssertEqual(sent.count, 0)
  }
}
