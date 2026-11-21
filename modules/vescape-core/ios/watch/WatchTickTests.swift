import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchTickTest.kt
final class WatchTickTests: XCTestCase {
  private let snapshot = WatchSnapshot(
    speed: 10, dutyCycle: 0.5, dutyExcluded: false, batterySoc: 80, motorTemp: 40, ctrlTemp: 35
  )

  private func tick(
    _ scheduler: TestScheduler,
    intervalMs: Int64,
    canPush: @escaping () -> Bool = { true },
    push: @escaping (Data) -> Void
  ) -> WatchTick {
    WatchTick(
      scheduler: scheduler,
      snapshot: { self.snapshot },
      isStale: { false },
      canPush: canPush,
      push: push,
      intervalMs: intervalMs
    )
  }

  func testPushesAFrameEveryInterval() {
    let scheduler = TestScheduler()
    var pushes = 0
    let watchTick = tick(scheduler, intervalMs: 500) { _ in pushes += 1 }
    watchTick.start()

    scheduler.advance(1500)

    XCTAssertEqual(pushes, 3)
  }

  func testLoweringIntervalReArmsThePendingTickImmediately() {
    let scheduler = TestScheduler()
    var pushes = 0
    let watchTick = tick(scheduler, intervalMs: 2000) { _ in pushes += 1 }
    watchTick.start()

    scheduler.advance(1000)
    XCTAssertEqual(pushes, 0)

    watchTick.setIntervalMs(100)
    scheduler.advance(100)
    XCTAssertEqual(pushes, 1)

    scheduler.advance(300)
    XCTAssertEqual(pushes, 4)
  }

  func testSetIntervalWhileStoppedTakesEffectOnNextStart() {
    let scheduler = TestScheduler()
    var pushes = 0
    let watchTick = tick(scheduler, intervalMs: 500) { _ in pushes += 1 }

    watchTick.setIntervalMs(100)
    watchTick.start()
    scheduler.advance(300)

    XCTAssertEqual(pushes, 3)
  }

  func testKeepsSpinningButSendsNothingWhileUnreachable() {
    let scheduler = TestScheduler()
    var reachable = false
    var pushes = 0
    let watchTick = tick(scheduler, intervalMs: 500, canPush: { reachable }) { _ in pushes += 1 }
    watchTick.start()

    scheduler.advance(1500)
    XCTAssertEqual(pushes, 0)

    reachable = true
    scheduler.advance(1000)
    XCTAssertEqual(pushes, 2)
  }

  func testStoppedTickPushesNothingFurther() {
    let scheduler = TestScheduler()
    var pushes = 0
    let watchTick = tick(scheduler, intervalMs: 500) { _ in pushes += 1 }
    watchTick.start()

    scheduler.advance(500)
    XCTAssertEqual(pushes, 1)

    watchTick.stop()
    scheduler.advance(5000)
    XCTAssertEqual(pushes, 1)
  }

  func testPushesAnEncodedFrameTheWristCanDecode() throws {
    let scheduler = TestScheduler()
    var pushed: Data?
    let watchTick = tick(scheduler, intervalMs: 500) { pushed = $0 }
    watchTick.start()

    scheduler.advance(500)

    let decoded = WatchFrameBuilder.decode(try XCTUnwrap(pushed))
    XCTAssertEqual(decoded?.speed, 10)
    XCTAssertEqual(try XCTUnwrap(decoded?.duty), 50, accuracy: 1e-3)
    XCTAssertEqual(decoded?.battery, 80)
    XCTAssertEqual(decoded?.stale, false)
  }
}
