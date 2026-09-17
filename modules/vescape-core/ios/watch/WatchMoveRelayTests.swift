import XCTest

@testable import VescapeCore

/// The wrist Move path, against a virtual clock. Every delivery failure the link can produce —
/// a delayed tick, a lost release, a reordered pair, a wrist that simply stops — is a fixture here,
/// because the acceptance criterion for #490 is that these are pinned *before* a motor turns.
///
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

  // MARK: - Strength stays the phone's

  func testAHeldDirectionScalesFullInputByThePhoneStrengthSetting() {
    let relay = relay()

    relay.accept(1)
    XCTAssertEqual(started, [76])  // 127 * 60%

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
    // 0 % is a stop as far as the controller is concerned, never a reversed push.
    XCTAssertEqual(started, [BOARD_MOVE_INPUT_MAX, 0])
  }

  // MARK: - Release

  func testAReleaseStopsOnceAndDisarmsTheDeadMan() {
    let relay = relay()

    relay.accept(1)
    relay.accept(0)
    XCTAssertEqual(stops, 1)

    // A repeated release on an already-stopped board is not another stop.
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

  // MARK: - The dead-man, which is the feature

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
    // Only the first tick of a continuous hold is worth a diagnostic event.
    XCTAssertEqual(events, ["watch_move_held"])

    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)
  }

  /// The wrist's own tick spacing has to sit safely inside the phone's dead-man, or an ordinary
  /// hold would stutter. Two missed ticks must still not stop a board the rider is holding.
  func testTwoMissedTicksAreSurvivableAndTheThirdIsNot() {
    let relay = relay()

    relay.accept(1)
    scheduler.advance(watchMoveRepeatMs * 2)
    XCTAssertEqual(stops, 0)

    scheduler.advance(watchMoveRepeatMs)
    XCTAssertEqual(stops, 1)
  }

  /// A hold refused at the moment it started — a board mid-connect, a link that has not earned
  /// trust — is retried by the next tick rather than needing the rider to let go and press again.
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

  // MARK: - Delivery failures

  /// A release that never arrives, followed by silence: the board stops on the phone's clock, and
  /// the hold that was still in flight when the rider let go cannot outlive it by more than one
  /// dead-man. This is the lost-release, dead-watch, killed-app and out-of-range case, all four.
  func testALostReleaseStopsOnTheDeadManAndStaysStopped() {
    let relay = relay()

    relay.accept(1)
    scheduler.advance(watchMoveRepeatMs)
    relay.accept(1)
    // The release is dropped by the link here; nothing else arrives.
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 1)

    scheduler.advance(watchMoveDeadManMs * 10)
    XCTAssertEqual(stops, 1)
    XCTAssertEqual(started.count, 2)
  }

  /// A hold delayed past the release it was sent before. The stop happens on arrival, and the late
  /// hold that follows it can only roll for one dead-man — it cannot resurrect the press silently
  /// and indefinitely, which is the property that makes the direction-only wire safe to reorder.
  func testALateHoldAfterAReleaseCannotOutliveOneDeadMan() {
    let relay = relay()

    relay.accept(1)
    relay.accept(0)
    XCTAssertEqual(stops, 1)

    // The straggler lands after the release it was sent before.
    relay.accept(1)
    XCTAssertEqual(started.count, 2)
    scheduler.advance(watchMoveDeadManMs)
    XCTAssertEqual(stops, 2)
  }

  /// Delivery is latest-wins, not a queue, so a reconnect cannot replay a backlog. Even if it
  /// somehow did, a burst of stale holds is still one dead-man of roll and no more — there is no
  /// accumulation, because each tick re-arms the same timer rather than adding one.
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

  // MARK: - The wire

  func testMoveCommandCarriesADirectionAndNothingElse() {
    for direction in [-1, 0, 1] {
      XCTAssertEqual(
        WatchCommandCodec.decode(WatchCommandCodec.encode(.move(direction))),
        .move(direction)
      )
    }
  }

  /// The exact bytes Android writes and reads, pinned rather than described.
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

  /// The tick spacing and the dead-man are one contract in two places; a change to either that is
  /// not a change to both is the bug this pins.
  func testTheWristTickSpacingIsAThirdOfThePhoneDeadMan() {
    XCTAssertEqual(watchMoveDeadManMs, 900)
    XCTAssertEqual(watchMoveRepeatMs, 300)
    XCTAssertEqual(watchMoveDeadManMs, watchMoveRepeatMs * 3)
  }
}
