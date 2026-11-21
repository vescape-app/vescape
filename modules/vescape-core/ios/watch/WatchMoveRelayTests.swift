import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchMoveRelayTest.kt
final class WatchMoveRelayTests: XCTestCase {
  private var scheduler = TestScheduler()
  private var started: [Int] = []
  private var stops = 0
  private var strength = 60
  private var accepts = true
  private var events: [String] = []

  override func setUp() {
    super.setUp()
    scheduler = TestScheduler()
    started = []
    stops = 0
    strength = 60
    accepts = true
    events = []
  }

  private func relay() -> WatchMoveRelay {
    WatchMoveRelay(
      scheduler: scheduler,
      strengthPercent: { self.strength },
      startMove: { input in
        self.started.append(input)
        return self.accepts
      },
      stopMove: {
        self.stops += 1
        return true
      },
      record: { name, _ in self.events.append(name) }
    )
  }

  func testAHeldDirectionScalesFullInputByThePhoneStrengthSetting() {
    let relay = relay()

    relay.accept(1)
    XCTAssertEqual(started, [76])

    strength = 100
    relay.accept(1)
    XCTAssertEqual(started, [76, 127])

    relay.accept(-1)
    XCTAssertEqual(started, [76, 127, -127])
  }

  func testAnAbsurdStrengthCannotExceedFullScaleOrInvertTheDirection() {
    let relay = relay()

    strength = 400
    relay.accept(1)
    XCTAssertEqual(started, [BOARD_MOVE_INPUT_MAX])

    strength = -50
    relay.accept(1)
    XCTAssertEqual(started, [BOARD_MOVE_INPUT_MAX, 0])
  }

  func testAReleaseStopsOnceAndDisarmsTheDeadMan() {
    let relay = relay()

    relay.accept(1)
    relay.accept(0)
    XCTAssertEqual(stops, 1)

    relay.accept(0)
    XCTAssertEqual(stops, 1)

    scheduler.advance(watchMoveDeadManMs * 2)
    XCTAssertEqual(stops, 1)
  }

  func testAReleaseThatArrivesBeforeAnyHoldTouchesTheBoardAtAll() {
    let relay = relay()

    relay.accept(0)
    XCTAssertEqual(stops, 0)
    XCTAssertEqual(started, [])
    XCTAssertEqual(events, [])
  }

  func testSilenceStopsTheBoardWithoutARelease() {
    let relay = relay()

    relay.accept(1)
    scheduler.advance(watchMoveDeadManMs - 1)
    XCTAssertEqual(stops, 0)

    scheduler.advance(1)
    XCTAssertEqual(stops, 1)
    XCTAssertEqual(events.last, "watch_move_deadman_stop")
  }

  func testEveryTickRearmsTheDeadManSoALongHoldKeepsRolling() {
    let relay = relay()

    for _ in 0..<10 {
      relay.accept(1)
      scheduler.advance(watchMoveRepeatMs)
    }
    XCTAssertEqual(stops, 0)
    XCTAssertEqual(started.count, 10)
    XCTAssertEqual(events, ["watch_move_held"])

    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)
  }

  func testTwoMissedTicksAreSurvivableAndTheThirdIsNot() {
    let relay = relay()

    relay.accept(1)
    scheduler.advance(watchMoveRepeatMs * 2)
    XCTAssertEqual(stops, 0)

    scheduler.advance(watchMoveRepeatMs)
    XCTAssertEqual(stops, 1)
  }

  func testARefusedHoldSelfHealsOnTheNextTick() {
    let relay = relay()

    accepts = false
    relay.accept(1)
    XCTAssertEqual(started, [76])

    accepts = true
    relay.accept(1)
    XCTAssertEqual(started, [76, 76])
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)
  }

  func testALostReleaseStopsOnTheDeadManAndStaysStopped() {
    let relay = relay()

    relay.accept(1)
    scheduler.advance(watchMoveRepeatMs)
    relay.accept(1)
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)

    scheduler.advance(watchMoveDeadManMs * 10)
    XCTAssertEqual(stops, 1)
    XCTAssertEqual(started.count, 2)
  }

  func testALateHoldAfterAReleaseCannotOutliveOneDeadMan() {
    let relay = relay()

    relay.accept(1)
    relay.accept(0)
    XCTAssertEqual(stops, 1)

    relay.accept(1)
    XCTAssertEqual(started.count, 2)
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 2)
  }

  func testABurstOfStaleHoldsIsStillOneDeadMan() {
    let relay = relay()

    for _ in 0..<50 { relay.accept(1) }
    XCTAssertEqual(stops, 0)
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)
    scheduler.advance(watchMoveDeadManMs * 10)
    XCTAssertEqual(stops, 1)
  }

  func testTeardownStopsAnActiveHoldAndDropsTheDeadMan() {
    let relay = relay()

    relay.accept(1)
    relay.cancel()
    XCTAssertEqual(stops, 1)
    scheduler.advance(watchMoveDeadManMs * 2)
    XCTAssertEqual(stops, 1)
  }

  func testMoveCommandCarriesADirectionAndNothingElse() {
    for direction in [-1, 0, 1] {
      XCTAssertEqual(
        WatchCommandCodec.decode(WatchCommandCodec.encode(.move(direction))),
        .move(direction)
      )
    }
  }

  func testMoveWireValuesMatchAndroid() {
    XCTAssertEqual(Array(WatchCommandCodec.encode(.move(1))), [1, 1])
    XCTAssertEqual(Array(WatchCommandCodec.encode(.move(0))), [1, 0])
    XCTAssertEqual(Array(WatchCommandCodec.encode(.move(-1))), [1, 0xFF])
  }

  func testADirectionFromAFutureWristIsClampedRatherThanTrusted() {
    XCTAssertEqual(WatchCommandCodec.decode(Data([1, 7])), .move(1))
    XCTAssertEqual(WatchCommandCodec.decode(Data([1, 0x80])), .move(-1))
    XCTAssertEqual(Array(WatchCommandCodec.encode(.move(99))), [1, 1])
  }

  func testAShortOrUnknownPayloadIsNotAMove() {
    XCTAssertNil(WatchCommandCodec.decode(Data()))
    XCTAssertNil(WatchCommandCodec.decode(Data([1])))
    XCTAssertNil(WatchCommandCodec.decode(Data([99, 1])))
  }

  func testTheWristTickSpacingIsAThirdOfThePhoneDeadMan() {
    XCTAssertEqual(watchMoveDeadManMs, 900)
    XCTAssertEqual(watchMoveRepeatMs, 300)
    XCTAssertEqual(watchMoveDeadManMs, watchMoveRepeatMs * 3)
  }
}
