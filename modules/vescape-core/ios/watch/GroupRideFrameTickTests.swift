import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameTickTest.kt
final class GroupRideFrameTickTests: XCTestCase {
  private final class Gate {
    var present = true
    var wake: WatchMirrorWakeLevel = .active
    var joined = true

    init(present: Bool = true, wake: WatchMirrorWakeLevel = .active, joined: Bool = true) {
      self.present = present
      self.wake = wake
      self.joined = joined
    }
  }

  private func tick(_ scheduler: TestScheduler, _ gate: Gate, push: @escaping (Data) -> Void) -> GroupRideFrameTick {
    GroupRideFrameTick(
      scheduler: scheduler,
      canPushWatchFrame: { gate.present },
      wakeLevel: { gate.wake },
      frame: { gate.joined ? GroupRideFrame(courseDeg: 0, spanM: 600, riders: []) : nil },
      push: push
    )
  }

  func testPushesAboutOnceASecondWhileJoinedWithTheWristAwake() {
    let scheduler = TestScheduler()
    var pushed: [Data] = []
    let groupTick = tick(scheduler, Gate()) { pushed.append($0) }
    groupTick.start()

    scheduler.advance(3 * GROUP_RIDE_FRAME_INTERVAL_MS)

    XCTAssertEqual(pushed.count, 3)
    XCTAssertEqual(pushed.first?.first, UInt8(WATCH_GROUP_RIDE_VERSION))
  }

  func testPushesNothingWhenNotJoinedAsleepInAmbientOrUnreachable() {
    for gate in [Gate(joined: false), Gate(wake: .asleep), Gate(wake: .ambient), Gate(present: false)] {
      let scheduler = TestScheduler()
      var pushes = 0
      let groupTick = tick(scheduler, gate) { _ in pushes += 1 }
      groupTick.start()

      scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)

      XCTAssertEqual(pushes, 0)
    }
  }

  func testTheTickResumesWhenTheGateLiftsAndStopsForGood() {
    let scheduler = TestScheduler()
    let gate = Gate(wake: .ambient)
    var pushes = 0
    let groupTick = tick(scheduler, gate) { _ in pushes += 1 }
    groupTick.start()

    scheduler.advance(2 * GROUP_RIDE_FRAME_INTERVAL_MS)
    gate.wake = .active
    scheduler.advance(GROUP_RIDE_FRAME_INTERVAL_MS)
    XCTAssertEqual(pushes, 1)

    groupTick.stop()
    scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)
    XCTAssertEqual(pushes, 1)
  }
}
