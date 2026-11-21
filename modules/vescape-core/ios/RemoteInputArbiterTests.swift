import XCTest

@testable import VescapeCore

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

  private func settleSensor(at target: Int, file: StaticString = #filePath, line: UInt = #line) {
    for _ in 0..<12 {
      _ = arbiter.sensorDrive(target)
      scheduler.advance(100)
    }
    XCTAssertEqual(arbiter.sensorCommand, target, file: file, line: line)
  }

  func testSensorRampsToItsTargetInsteadOfSteppingToIt() {
    _ = arbiter.sensorDrive(255)
    let first = arbiter.sensorCommand
    XCTAssertGreaterThan(first, REMOTE_TILT_CENTER, "first command must leave neutral")
    XCTAssertLessThan(first, 255, "first command must not be the full swing")

    settleSensor(at: 255)
  }

  func testSensorFollowsItsReadingsOnceRamped() {
    settleSensor(at: 200)

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

    scheduler.advance(300)
    XCTAssertFalse(sent.isEmpty)
    XCTAssertTrue(sent.allSatisfy { $0 == movePacket(BOARD_MOVE_INPUT_MAX) })
  }

  func testBoardMoveIsNotOverwrittenByAPendingSensorDecay() {
    settleSensor(at: 255)
    _ = arbiter.sensorRelease()
    XCTAssertEqual(tilt.phase, .decaying)

    sent.removeAll()
    XCTAssertTrue(arbiter.startMove(-BOARD_MOVE_INPUT_MAX))
    XCTAssertEqual(arbiter.owner, .move)

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

    XCTAssertFalse(arbiter.startMove(BOARD_MOVE_INPUT_MAX))
    XCTAssertEqual(arbiter.owner, .sensor)
    XCTAssertFalse(sent.contains(movePacket(BOARD_MOVE_INPUT_MAX)))
  }

  func testSensorReleaseEasesOutOnceRatherThanRestartingEveryTick() {
    settleSensor(at: 255)

    XCTAssertTrue(arbiter.sensorRelease())
    let total = tilt.decayProgress?.totalMs
    XCTAssertEqual(total, 600)

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
    XCTAssertTrue(arbiter.sensorRelease())
    scheduler.advance(200)
    let eased = tilt.currentValue
    XCTAssertTrue(eased > 0 && eased < 255, "the release must have eased some of the tilt off")

    sent = []
    XCTAssertTrue(arbiter.sensorDrive(255))
    scheduler.advance(100)
    XCTAssertGreaterThanOrEqual(
      arbiter.sensorCommand, eased, "re-engage must not step down to neutral")
    XCTAssertFalse(sent.isEmpty)
    XCTAssertFalse(
      sent.contains(tiltPacket(REMOTE_TILT_CENTER)),
      "no packet may drop the commanded tilt back toward neutral")
  }

  func testManualTiltIsRefusedWhileABindingIsBoundEvenWithTheSlotFree() {
    sensorBound = true
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)

    XCTAssertFalse(arbiter.manualHold(200))
    XCTAssertFalse(arbiter.manualLock(200))
    XCTAssertFalse(arbiter.manualRelease(200, durationMs: 1_000))
    XCTAssertTrue(sent.isEmpty, "a refused manual command writes nothing")
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)

    XCTAssertTrue(arbiter.sensorDrive(200))
    XCTAssertEqual(arbiter.owner, .sensor)
  }

  func testABoundBindingKeepsReleasingAManualTiltItDidNotCatchWhenItArmed() {
    XCTAssertTrue(arbiter.manualLock(255))
    XCTAssertEqual(arbiter.owner, .manual)
    sensorBound = true

    let binding = BoardGroundClearanceBinding(
      remoteInput: arbiter,
      boundInput: { true },
      tiltInput: { .drive(tiltInput: 1.0, valueCm: 5.0) })
    let board = BoardGroundClearanceBinding.BoardInput(commandsTrusted: true, telemetryFresh: true)

    binding.tick(board)
    XCTAssertEqual(binding.state()["release"] as? String, "manual-tilt")
    XCTAssertEqual(tilt.phase, .decaying)
    let total = tilt.decayProgress?.totalMs

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

    scheduler.advance(100)
    XCTAssertEqual(tilt.phase, .idle)
    XCTAssertEqual(arbiter.owner, RemoteInputOwner.none)
  }

  func testCorrectionMapsOntoThePadsOwnScaleAndSaturates() {
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: 0), REMOTE_TILT_CENTER)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: 1), 255)
    XCTAssertEqual(GroundClearance.tiltCommand(tiltInput: -1), 1)
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
