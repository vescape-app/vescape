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

    controller.hold(140)
    controller.hold(160)
    controller.hold(200)
    XCTAssertEqual(sent.count, 1)

    scheduler.advance(100)
    XCTAssertEqual(sent.count, 2)
    XCTAssertEqual(sent[1], tilt(200))
  }

  func testReleaseEasesLinearlyToNeutralThenStops() {
    let controller = makeController()
    let from = 255
    let steps = 4

    XCTAssertTrue(controller.release(from, durationMs: 400))
    XCTAssertEqual(sent[0], tilt(from))

    scheduler.advance(400)
    XCTAssertEqual(sent[1], tilt(decayValue(from: from, steps: steps, tick: 1)))
    XCTAssertEqual(sent.last, tilt(REMOTE_TILT_CENTER))
    XCTAssertEqual(sent.count, 5)

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 5)
  }

  func testHoldThenReleaseEasesFromHeldValue() {
    let controller = makeController()
    controller.hold(255)
    XCTAssertEqual(sent.count, 1)

    controller.release(255, durationMs: 400)
    XCTAssertEqual(sent.count, 1)

    scheduler.advance(400)
    XCTAssertEqual(sent.last, tilt(REMOTE_TILT_CENTER))
  }

  func testReleaseWithSubTickDurationSnapsToNeutral() {
    let controller = makeController()
    controller.hold(200)
    sent.removeAll()

    XCTAssertTrue(controller.release(200, durationMs: 50))
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0], tilt(REMOTE_TILT_CENTER))

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 1)
  }

  func testStopSnapsToNeutralAndCancelsRepeat() {
    let controller = makeController()
    controller.hold(200)
    sent.removeAll()

    XCTAssertTrue(controller.stop())
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent[0], tilt(REMOTE_TILT_CENTER))
    XCTAssertEqual(urgentSent, [tilt(REMOTE_TILT_CENTER)])

    scheduler.advance(200)
    XCTAssertEqual(sent.count, 1)
  }

  func testCancelEasesLockedTiltBackToNeutralInsteadOfSnapping() {
    let controller = makeController()
    controller.lock(255)
    sent.removeAll()

    XCTAssertTrue(controller.cancel())
    XCTAssertTrue(sent.isEmpty)
    XCTAssertEqual(controller.phase, .decaying)
    XCTAssertEqual(controller.decayProgress?.totalMs, 600)

    scheduler.advance(100)
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

    controller.hold(160)
    XCTAssertEqual(controller.currentValue, 160)
    XCTAssertFalse(controller.isLocked)

    controller.lock(255)
    XCTAssertTrue(controller.isLocked)
    controller.release(255, durationMs: 400)
    XCTAssertFalse(controller.isLocked)
    scheduler.advance(200)
    XCTAssertTrue((REMOTE_TILT_CENTER..<255).contains(controller.currentValue))

    scheduler.advance(400)
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
    scheduler.advance(100)
    XCTAssertEqual(sent.count, 0)

    transport = .direct
    scheduler.advance(200)
    XCTAssertEqual(sent.count, 0)
  }
}
