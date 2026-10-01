import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchMirrorCoordinatorTest.kt
final class WatchMirrorCoordinatorTests: XCTestCase {
  private final class Transport: WatchMirrorTransport {
    var reachable = true
    var requiresWakeReport = true
    var starts = 0
    var stops = 0
    var frames: [Data] = []
    var onFrame: () -> Void = {}
    var onGroup: () -> Void = {}
    var groups = 0
    var statuses = 0
    var settings = 0
    var receive: ((WatchCommand) -> Void)?
    func start(command: @escaping (WatchCommand) -> Void) { starts += 1; receive = command }
    func stop() { stops += 1; receive = nil }
    func pushFrame(_ frame: Data) { frames.append(frame); onFrame() }
    func pushGroup(_ frame: Data) { groups += 1; onGroup() }
    func pushRouteStatus(_ status: WatchRouteStatus) { statuses += 1 }
    func pushSettings(_ settings: WatchSettings) { self.settings += 1 }
    func pushWeather(_ weather: WatchWeather) {}
    func pushRoute(_ payload: [String: Any]) {}
    func pushBoard(_ board: WatchBoardLights) {}
  }
  private final class Sources: WatchMirrorSources {
    var subscribed = 0
    var cancelled = 0
    var changed: () -> Void = {}
    func routeStatus() -> WatchRouteStatus { WatchRouteStatus(phase: .ready, routeId: 1) }
    func subscribe(
      routeChanged: @escaping () -> Void,
      weatherChanged: @escaping (WatchWeather) -> Void,
      routePayload: @escaping ([String: Any]) -> Void
    ) -> () -> Void {
      subscribed += 1
      changed = routeChanged
      return { self.cancelled += 1 }
    }
  }
  private final class Harness {
    let scheduler = TestScheduler()
    let transport = Transport()
    let sources = Sources()
    var board = true
    var commands = 0
    lazy var coordinator = WatchMirrorCoordinator(
      scheduler: scheduler, nowMs: { self.scheduler.currentTimeMs },
      snapshot: { WatchSnapshot(speed: self.board ? 25 : nil, navBearing: 90, navDistanceM: 100) },
      isStale: { false }, groupFrame: { GroupRideFrame(courseDeg: 0, spanM: 600, riders: []) },
      transport: transport, sources: sources, command: { _ in self.commands += 1 }, record: { _, _ in }
    )
    func active() { coordinator.start(); coordinator.acceptWakeLevel(.active) }
  }

  func testLifetimeIsIdempotentAndSurvivesBoardDisconnect() {
    let h = Harness()
    h.active()
    h.coordinator.start()
    h.scheduler.advance(1000)
    h.board = false
    h.scheduler.advance(1000)
    XCTAssertEqual(h.transport.starts, 1)
    XCTAssertEqual(h.sources.subscribed, 1)
    XCTAssertEqual(h.transport.frames.count, 8)
    XCTAssertEqual(h.transport.groups, 2)
    XCTAssertEqual(h.transport.statuses, 8)
    let frame = WatchFrameBuilder.decode(h.transport.frames.last!)
    XCTAssertNil(frame?.speed)
    XCTAssertEqual(frame?.navDistanceM, 100)
    XCTAssertEqual(frame?.stale, false)
    h.coordinator.stop()
    h.coordinator.stop()
    h.scheduler.advance(5000)
    XCTAssertEqual(h.transport.frames.count, 8)
    XCTAssertEqual(h.transport.stops, 1)
    XCTAssertEqual(h.sources.cancelled, 1)
    XCTAssertEqual(h.scheduler.pendingCount, 0)
  }

  func testReachabilityGatePreservesIOSFramesWithoutWakeButRequiresWakeForGroup() {
    let h = Harness()
    h.transport.requiresWakeReport = false
    h.coordinator.start()
    h.scheduler.advance(1000)
    XCTAssertEqual(h.transport.frames.count, 4)
    XCTAssertEqual(h.transport.groups, 0)
    h.coordinator.acceptWakeLevel(.active)
    h.transport.reachable = false
    h.scheduler.advance(1000)
    XCTAssertEqual(h.transport.frames.count, 4)
    XCTAssertEqual(h.transport.groups, 0)
  }

  func testAmbientSettingsReloadKeepsSlowCadenceAndActiveRestoresLatestRate() {
    let h = Harness()
    h.active()
    h.coordinator.acceptWakeLevel(.ambient)
    h.coordinator.applySettings(WatchSettings(), intervalMs: 100)
    h.scheduler.advance(4999)
    XCTAssertEqual(h.transport.frames.count, 0)
    h.scheduler.advance(1)
    XCTAssertEqual(h.transport.frames.count, 1)
    XCTAssertEqual(h.transport.groups, 0)
    h.coordinator.acceptWakeLevel(.active)
    h.scheduler.advance(100)
    XCTAssertEqual(h.transport.frames.count, 2)
    XCTAssertEqual(h.transport.settings, 1)
  }

  func testExpiredWakeHeartbeatStopsStreamsAndSameLevelResumes() {
    let h = Harness()
    h.active()
    h.scheduler.advance(watchMirrorAwakeTimeoutMs)
    let frames = h.transport.frames.count
    let groups = h.transport.groups
    h.scheduler.advance(2000)
    XCTAssertEqual(h.transport.frames.count, frames)
    XCTAssertEqual(h.transport.groups, groups)
    h.coordinator.acceptWakeLevel(.active)
    h.scheduler.advance(1000)
    XCTAssertEqual(h.transport.frames.count, frames + 4)
    XCTAssertEqual(h.transport.groups, groups + 1)
  }

  func testStopFromDeliveryCallbackCannotRearmEitherStream() {
    for stopFromGroup in [false, true] {
      let h = Harness()
      if stopFromGroup { h.transport.onGroup = { h.coordinator.stop() } }
      else { h.transport.onFrame = { h.coordinator.stop() } }
      h.active()
      h.scheduler.advance(1000)
      let frames = h.transport.frames.count
      let groups = h.transport.groups
      h.scheduler.advance(5000)
      XCTAssertEqual(h.transport.frames.count, frames)
      XCTAssertEqual(h.transport.groups, groups)
      XCTAssertEqual(h.scheduler.pendingCount, 0)
    }
  }

  func testOldSourceAndCommandCallbacksCannotAffectARestartedMirror() {
    let h = Harness()
    h.active()
    let oldCallback = h.sources.changed
    let oldCommand = h.transport.receive!
    oldCallback()
    oldCommand(.move(1))
    h.coordinator.stop()
    h.active()
    oldCallback()
    oldCommand(.move(1))
    h.scheduler.advance(0)
    XCTAssertEqual(h.transport.statuses, 0)
    XCTAssertEqual(h.commands, 0)
    h.sources.changed()
    h.transport.receive?(.move(1))
    h.scheduler.advance(0)
    XCTAssertEqual(h.transport.statuses, 1)
    XCTAssertEqual(h.commands, 1)
  }
}
