import XCTest

@testable import VescapeCore

final class BoardMoveControllerTests: XCTestCase {
  private var sent: [[UInt8]] = []
  private var transport: BoardTransport? = .direct
  private var canMove = true
  private var generation: BoardMoveGeneration = .remote
  private var scheduler = TestScheduler()

  override func setUp() {
    super.setUp()
    sent = []
    transport = .direct
    canMove = true
    generation = .remote
    scheduler = TestScheduler()
  }

  private func makeController() -> BoardMoveController {
    BoardMoveController(
      transport: { self.transport },
      canMove: { self.canMove },
      generation: { self.generation },
      send: { payload, _ in
        self.sent.append(payload)
        return true
      },
      scheduler: scheduler
    )
  }

  private func tick() {
    scheduler.advance(generation == .remote ? 100 : 700)
  }

  private func move(_ input: Int) -> [UInt8] {
    buildBoardMoveCommand(transport: .direct, generation: generation, input: input)
  }

  func testHoldSendsImmediatelyThenRepeatsUntilStopped() {
    let controller = makeController()

    XCTAssertTrue(controller.hold(25))
    XCTAssertEqual([move(25)], sent)

    tick()
    tick()
    XCTAssertEqual(3, sent.count)
    XCTAssertTrue(sent.allSatisfy { $0 == move(25) })

    XCTAssertTrue(controller.stop())
    XCTAssertEqual(move(0), sent.last)
    XCTAssertNil(controller.currentInput)

    // The repeat loop is cancelled, not merely idle.
    let afterStop = sent.count
    tick()
    XCTAssertEqual(afterStop, sent.count)
  }

  func testRcMoveRepeatsSlowlyEnoughForFirmwareToRampTheCurrent() {
    generation = .rcMove
    let controller = makeController()

    XCTAssertTrue(controller.hold(25))
    XCTAssertEqual(1, scheduler.pendingCount)

    // The 1.3+ cadence would restart the firmware's current ramp ten times a second, so the motor
    // pulses instead of moving. Every repeat of an RC_MOVE hold keeps the slower spacing.
    tick()
    XCTAssertEqual(700, scheduler.currentTimeMs)
    XCTAssertEqual(1, scheduler.pendingCount)
    XCTAssertEqual(move(25), sent.last)
  }

  func testRemoteGenerationKeepsTheFastRefresh() {
    let controller = makeController()

    controller.hold(25)
    scheduler.advance(99)
    XCTAssertEqual(1, sent.count)
    scheduler.advance(1)
    XCTAssertEqual(2, sent.count)
  }

  func testReversingMidHoldSwapsTheStreamWithoutAnExtraWrite() {
    let controller = makeController()
    controller.hold(25)
    tick()
    XCTAssertEqual(2, sent.count)

    XCTAssertTrue(controller.hold(-25))
    XCTAssertEqual(2, sent.count)

    tick()
    XCTAssertEqual(move(-25), sent.last)
  }

  func testHoldingZeroStops() {
    let controller = makeController()
    controller.hold(25)
    sent = []

    XCTAssertTrue(controller.hold(0))
    XCTAssertEqual([move(0)], sent)
    XCTAssertFalse(controller.isMoving)
  }

  func testHoldIsRefusedWithoutATransport() {
    transport = nil

    XCTAssertFalse(makeController().hold(25))
    XCTAssertTrue(sent.isEmpty)
  }

  func testHoldIsRefusedWithoutATrustedLink() {
    canMove = false

    XCTAssertFalse(makeController().hold(25))
    XCTAssertTrue(sent.isEmpty)
  }

  func testLosingLinkTrustMidHoldStopsWithANeutral() {
    let controller = makeController()
    controller.hold(25)
    canMove = false

    tick()
    XCTAssertEqual(move(0), sent.last)
    XCTAssertFalse(controller.isMoving)
  }

  func testLosingTheTransportMidHoldEndsTheStream() {
    let controller = makeController()
    controller.hold(25)
    transport = nil

    tick()
    XCTAssertEqual(1, sent.count)
    XCTAssertFalse(controller.isMoving)
  }
}
