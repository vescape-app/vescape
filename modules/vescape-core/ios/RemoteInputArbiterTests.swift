import XCTest

@testable import VescapeCore

/// Who is allowed to write the Board's remote-input slot, and what happens at every handover.
///
/// These are the ownership regressions #479 asks for. The failures they describe are all the same
/// shape: two of the three writers active at once, each repeating its own value on its own tick, so
/// the Board receives an alternating stream and does neither thing. On a ridden Board that is not a
/// glitch, it is a rider on the floor — which is why the interesting assertions here are about what
/// is *not* sent.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RemoteInputArbiterTest.kt
final class RemoteInputArbiterTests: XCTestCase {
  private var sent: [[UInt8]] = []
  private var transport: BoardTransport? = .direct
  private var canMove = true
  private var sensorBound = false
  private var scheduler = TestScheduler()
  private var tilt: RemoteTiltController!
  private var move: BoardMoveController!
  private var arbiter: RemoteInputArbiter!

  override func setUp() {
    super.setUp()
    sent = []
    transport = .direct
    canMove = true
    scheduler = TestScheduler()
    tilt = RemoteTiltController(
      transport: { self.transport },
      send: { payload, _ in
        self.sent.append(payload)
        return true
      },
      scheduler: scheduler
    )
    move = BoardMoveController(
      transport: { self.transport },
      canMove: { self.canMove },
      generation: { .remote },
      send: { payload, _ in
        self.sent.append(payload)
        return true
      },
      scheduler: scheduler
    )
    sensorBound = false
    arbiter = RemoteInputArbiter(
      tilt: tilt,
      move: move,
      nowMs: { self.scheduler.currentTimeMs },
      sensorBound: { self.sensorBound }
    )
  }

  private func tiltPacket(_ value: Int) -> [UInt8] {
    buildRemoteTiltCommand(transport: .direct, value: value)
  }

  private func movePacket(_ input: Int) -> [UInt8] {
    buildBoardMoveCommand(transport: .direct, generation: .remote, input: input)
  }

  /// Drives the sensor at full strength for long enough that the slew limit is no longer the story.
  private func settleSensor(at target: Int, file: StaticString = #filePath, line: UInt = #line) {
    for _ in 0..<12 {
      _ = arbiter.sensorDrive(target)
      scheduler.advance(100)
    }
    XCTAssertEqual(arbiter.sensorCommand, target, file: file, line: line)
  }

  func testSensorRampsToItsTargetInsteadOfSteppingToIt() {
    // A pothole under the sensor produces a full-range swing in one sample. Handing that to the
    // firmware as a single step is the same angle error a snapped cancel would be.
    _ = arbiter.sensorDrive(255)
    let first = arbiter.sensorCommand
    XCTAssertGreaterThan(first, REMOTE_TILT_CENTER, "first command must leave neutral")
    XCTAssertLessThan(first, 255, "first command must not be the full swing")

    settleSensor(at: 255)
  }

  func testSensorFollowsItsReadingsOnceRamped() {
    settleSensor(at: 200)

    // Small changes inside the slew allowance land exactly, so steady tracking is not distorted.
    scheduler.advance(100)
    _ = arbiter.sensorDrive(198)
    XCTAssertEqual(arbiter.sensorCommand, 198)
  }

  func testManualTiltIsRefusedWhileTheSensorIsDriving() {
    settleSensor(at: 200)
    let before = sent.count

    XCTAssertFalse(arbiter.manualHold(40))
    XCTAssertFalse(arbiter.manualLock(40))
    XCTAssertFalse(arbiter.manualRelease(40, durationMs: 1_000))
    XCTAssertEqual(sent.count, before, "a refused manual command writes nothing")
    XCTAssertEqual(arbiter.owner, .sensor)
  }

  func testSensorIsRefusedWhileBoardMoveHoldsTheSlot() {
    XCTAssertTrue(arbiter.startMove(BOARD_MOVE_INPUT_MAX))
    sent.removeAll()

    XCTAssertFalse(arbiter.sensorDrive(255))
    XCTAssertEqual(arbiter.owner, .move)

    // Nothing but move packets reach the board while it is jogging.
    scheduler.advance(300)
    XCTAssertFalse(sent.isEmpty)
    XCTAssertTrue(sent.allSatisfy { $0 == movePacket(BOARD_MOVE_INPUT_MAX) })
  }

  func testBoardMoveIsNotOverwrittenByAPendingSensorDecay() {
    settleSensor(at: 255)
    // The rider steps off: the binding releases and the smooth return starts.
    _ = arbiter.sensorRelease()
    XCTAssertEqual(tilt.phase, .decaying)

    // Board Move, requested while that return is still easing down.
    sent.removeAll()
    XCTAssertTrue(arbiter.startMove(-BOARD_MOVE_INPUT_MAX))
    XCTAssertEqual(arbiter.owner, .move)

    // One neutral tilt hands the slot back, and after it the board hears nothing but the move.
    XCTAssertEqual(sent.first, tiltPacket(REMOTE_TILT_CENTER))
    scheduler.advance(600)
    let afterHandover = Array(sent.dropFirst())
    XCTAssertFalse(afterHandover.isEmpty)
    XCTAssertTrue(
      afterHandover.allSatisfy { $0 == movePacket(-BOARD_MOVE_INPUT_MAX) },
      "a pending decay must not keep writing over Board Move"
    )
  }

  func testBoardMoveIsRefusedWhileTheSensorIsCorrecting() {
    settleSensor(at: 220)
    sent.removeAll()

    // A board asking for ground-clearance correction is a board being ridden, and jogging one is not
    // a request this app passes on.
    XCTAssertFalse(arbiter.startMove(BOARD_MOVE_INPUT_MAX))
    XCTAssertEqual(arbiter.owner, .sensor)
    XCTAssertFalse(sent.contains(movePacket(BOARD_MOVE_INPUT_MAX)))
  }

  func testSensorReleaseEasesOutOnceRatherThanRestartingEveryTick() {
    settleSensor(at: 255)

    XCTAssertTrue(arbiter.sensorRelease())
    let total = tilt.decayProgress?.totalMs
    XCTAssertEqual(total, 600)

    // The Board Session calls this on every tick it has no valid reading. Only the first cancels; a
    // repeat would re-ease from a smaller value and the return would never arrive.
    scheduler.advance(200)
    XCTAssertFalse(arbiter.sensorRelease())
    XCTAssertEqual(tilt.decayProgress?.totalMs, total)

    scheduler.advance(400)
    XCTAssertEqual(tilt.phase, .idle)
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)
    XCTAssertEqual(sent.last, tiltPacket(REMOTE_TILT_CENTER))
  }

  func testABindingArmingTakesBackALockedManualTilt() {
    XCTAssertTrue(arbiter.manualLock(255))
    XCTAssertEqual(arbiter.owner, .manual)

    // A lock never ends on its own, so without this the binding would wait for the slot forever.
    XCTAssertTrue(arbiter.releaseManual())
    XCTAssertEqual(tilt.phase, .decaying)
    scheduler.advance(600)
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)

    XCTAssertTrue(arbiter.sensorDrive(200))
    XCTAssertEqual(arbiter.owner, .sensor)
  }

  func testManualTiltKeepsItsSlotWhileNoSensorIsDriving() {
    XCTAssertTrue(arbiter.manualHold(200))
    XCTAssertEqual(arbiter.owner, .manual)
    XCTAssertTrue(arbiter.manualHold(210))
    XCTAssertEqual(sent.first, tiltPacket(200))
  }

  func testCancelReleasesWhoeverHeldTheSlot() {
    settleSensor(at: 255)

    XCTAssertTrue(arbiter.cancelTilt())
    XCTAssertEqual(tilt.phase, .decaying)
    // Cancel is not an off switch for the binding: a sensor still holding valid readings takes the
    // slot back on its next tick, ramped from where the cancel left it.
    XCTAssertEqual(arbiter.sensorCommand, REMOTE_TILT_CENTER)
    scheduler.advance(100)
    let eased = tilt.currentValue
    XCTAssertTrue(eased > 0 && eased < 255, "the cancel must have eased some of the tilt off")
    XCTAssertTrue(arbiter.sensorDrive(255))
    XCTAssertGreaterThanOrEqual(
      arbiter.sensorCommand, eased, "re-engaging must resume from the eased value, never step")
    XCTAssertNotEqual(arbiter.sensorCommand, 255)
  }

  func testASensorReEngagingMidReleaseResumesFromTheStreamRatherThanNeutral() {
    settleSensor(at: 255)
    // One bad reading releases; the reading after it is good again, which is an ordinary minute of
    // riding past a puddle, not an exotic case.
    XCTAssertTrue(arbiter.sensorRelease())
    scheduler.advance(200)
    let eased = tilt.currentValue
    XCTAssertTrue(eased > 0 && eased < 255, "the release must have eased some of the tilt off")

    sent = []
    XCTAssertTrue(arbiter.sensorDrive(255))
    scheduler.advance(100)
    // Resuming from neutral here would hand the firmware the whole unfinished decay as one step — a
    // ~100-count drop on a board with a rider on it, which is the surge a snapped cancel would cause
    // and the reason nothing in this class is allowed to step.
    XCTAssertGreaterThanOrEqual(
      arbiter.sensorCommand, eased, "re-engage must not step down to neutral")
    XCTAssertFalse(sent.isEmpty)
    XCTAssertFalse(
      sent.contains(tiltPacket(REMOTE_TILT_CENTER)),
      "no packet may drop the commanded tilt back toward neutral")
  }

  func testManualTiltIsRefusedWhileABindingIsBoundEvenWithTheSlotFree() {
    // Bound but not driving: parked, or between readings. The slot is genuinely free, and without
    // the bound check a manual *lock* taken here would never end on its own — and the pad is
    // read-only by then, so the rider has no Cancel to press.
    sensorBound = true
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)

    XCTAssertFalse(arbiter.manualHold(200))
    XCTAssertFalse(arbiter.manualLock(200))
    XCTAssertFalse(arbiter.manualRelease(200, durationMs: 1_000))
    XCTAssertTrue(sent.isEmpty, "a refused manual command writes nothing")
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)

    // The binding can still take the slot it was holding open.
    XCTAssertTrue(arbiter.sensorDrive(200))
    XCTAssertEqual(arbiter.owner, .sensor)
  }

  func testABoundBindingKeepsReleasingAManualTiltItDidNotCatchWhenItArmed() {
    // A lock taken in the window before the pad learned it was read-only, or one whose arming-time
    // cancel failed on a transport that blinked.
    XCTAssertTrue(arbiter.manualLock(255))
    XCTAssertEqual(arbiter.owner, .manual)
    sensorBound = true

    let binding = BoardGroundClearanceBinding(
      remoteInput: arbiter,
      boundInput: { true },
      tiltInput: { .drive(tiltInput: 1.0, valueCm: 5.0) })
    let board = BoardGroundClearanceBinding.BoardInput(commandsTrusted: true, telemetryFresh: true)

    // Already bound on the first tick, so there is no unbound→bound transition to catch it.
    binding.tick(board)
    XCTAssertEqual(binding.state()["release"] as? String, "manual-tilt")
    XCTAssertEqual(tilt.phase, .decaying)
    let total = tilt.decayProgress?.totalMs

    // Repeating the release must not restart the ease, or it would shrink toward zero forever.
    scheduler.advance(200)
    binding.tick(board)
    XCTAssertEqual(tilt.decayProgress?.totalMs, total)

    scheduler.advance(600)
    binding.tick(board)
    XCTAssertEqual(arbiter.owner, .sensor, "the binding takes the slot once the ease finishes")
    XCTAssertNil(binding.state()["release"] as? String)
  }

  func testResetLeavesNothingStreamingOnEitherChannel() {
    settleSensor(at: 255)
    arbiter.reset()

    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)
    XCTAssertEqual(sent[sent.count - 2], tiltPacket(REMOTE_TILT_CENTER))
    XCTAssertEqual(sent.last, movePacket(0))

    scheduler.advance(1_000)
    let afterReset = sent.count
    scheduler.advance(1_000)
    XCTAssertEqual(sent.count, afterReset, "nothing repeats after a reset")
  }

  func testALostTransportEndsTheSensorStreamRatherThanHoldingItsLastValue() {
    settleSensor(at: 255)
    transport = nil

    // The repeat loop is the sole sender; with no transport it clears itself, and the arbiter's
    // derived owner follows the stream rather than remembering a claim it can no longer serve.
    scheduler.advance(100)
    XCTAssertEqual(tilt.phase, .idle)
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)
  }

  func testCorrectionMapsOntoThePadsOwnScaleAndSaturates() {
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: 0), REMOTE_TILT_CENTER)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: 1), 255)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: -1), 1)
    // Nothing upstream can produce these; the one place that decides what a board is told is not
    // where to find that out.
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: 4), 255)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: -4), 1)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: .nan), REMOTE_TILT_CENTER)
  }

  func testBoardBindingOwnsTickCancellationAndBoardReasonPrecedence() {
    var sourceReads = 0
    let binding = BoardGroundClearanceBinding(
      remoteInput: arbiter,
      boundInput: {
        sourceReads += 1
        return true
      },
      tiltInput: { .drive(tiltInput: 1, valueCm: 5) })
    let schedule = { (tick: @escaping () -> Void) -> Cancellable in
      self.scheduler.postDelayed(BoardGroundClearanceBinding.tickMs, tick)
    }

    binding.start(schedule: schedule) {
      BoardGroundClearanceBinding.BoardInput(commandsTrusted: false, telemetryFresh: false)
    }
    scheduler.advance(BoardGroundClearanceBinding.tickMs)
    XCTAssertEqual(binding.state()["release"] as? String, "board-untrusted")
    XCTAssertEqual(arbiter.owner, .none)

    binding.stop()
    let readsAfterStop = sourceReads
    binding.start(schedule: schedule) {
      BoardGroundClearanceBinding.BoardInput(commandsTrusted: true, telemetryFresh: false)
    }
    scheduler.advance(BoardGroundClearanceBinding.tickMs)
    XCTAssertEqual(binding.state()["release"] as? String, "board-stale")
    XCTAssertEqual(sourceReads, readsAfterStop + 1)

    binding.stop()
    binding.start(schedule: schedule) {
      BoardGroundClearanceBinding.BoardInput(commandsTrusted: true, telemetryFresh: true)
    }
    scheduler.advance(BoardGroundClearanceBinding.tickMs * 2)
    XCTAssertEqual(arbiter.owner, .sensor)
    binding.stop()
    XCTAssertEqual(arbiter.sensorCommand, REMOTE_TILT_CENTER)
    XCTAssertEqual(tilt.phase, .decaying)
    let finalReads = sourceReads
    scheduler.advance(BoardGroundClearanceBinding.tickMs * 2)
    XCTAssertEqual(sourceReads, finalReads, "a stopped session cannot receive its old callback")
  }
}
