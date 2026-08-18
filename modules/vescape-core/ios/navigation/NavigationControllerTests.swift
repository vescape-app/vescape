import XCTest
@testable import VescapeCore

/// The rider's last action must win. A Directions call takes seconds, so a fetch started for an
/// abandoned target routinely resolves after the rider has already moved or cleared the pin.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/navigation/NavigationControllerTest.kt
final class NavigationControllerTests: XCTestCase {
  private let riderLatitude = 52.2
  private let riderLongitude = 21.0
  private let targetLatitude = 52.3
  private let secondTargetLatitude = 52.4
  private let targetLongitude = 21.1

  /// Routing stub whose calls finish only when the test says so.
  private final class GatedRoutes: DirectionsRoutes, @unchecked Sendable {
    private let lock = NSLock()
    private var gates: [Double: XCTestExpectation] = [:]
    private var released: Set<Double> = []
    private var callCount = 0
    let started = XCTestExpectation(description: "route started")

    var calls: Int { lock.withLock { callCount } }

    func release(_ targetLatitude: Double) {
      lock.withLock { _ = released.insert(targetLatitude) }
    }

    func route(
      fromLatitude: Double,
      fromLongitude: Double,
      toLatitude: Double,
      toLongitude: Double,
      profile: String
    ) async -> DirectionsResult {
      lock.withLock { callCount += 1 }
      started.fulfill()
      while !lock.withLock({ released.contains(toLatitude) }) {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }
      return .path(
        points: [(fromLatitude, fromLongitude), (toLatitude, toLongitude)],
        distanceMeters: 1_000,
        durationSeconds: 600
      )
    }
  }

  /// Routing stub that answers immediately with whatever the test hands it.
  private final class FixedRoutes: DirectionsRoutes, @unchecked Sendable {
    private let result: DirectionsResult

    init(_ result: DirectionsResult) { self.result = result }

    func route(
      fromLatitude: Double,
      fromLongitude: Double,
      toLatitude: Double,
      toLongitude: Double,
      profile: String
    ) async -> DirectionsResult { result }
  }

  /// In-memory stand-in for the App Settings rows, so restore and write-through need no database.
  private final class FakeStore: NavigationStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Navigation?
    private var target: (latitude: Double, longitude: Double)?
    private var profile: NavigationProfile?
    /// Held closed to keep the profile read in flight while the test taps.
    private var profileGateOpen: Bool

    init(
      stored: Navigation? = nil,
      directionPoint: (latitude: Double, longitude: Double)? = nil,
      profile: NavigationProfile? = nil,
      gateProfileRead: Bool = false
    ) {
      storage = stored
      target = directionPoint
      self.profile = profile
      profileGateOpen = !gateProfileRead
    }

    func openProfileGate() { lock.withLock { profileGateOpen = true } }

    var storedProfile: NavigationProfile? { lock.withLock { profile } }

    var stored: Navigation? { lock.withLock { storage } }

    func load() async -> Navigation? { lock.withLock { storage } }

    func save(_ navigation: Navigation?) async {
      lock.withLock { storage = navigation }
    }

    func directionPoint() async -> (latitude: Double, longitude: Double)? {
      lock.withLock { target }
    }

    func loadProfile() async -> NavigationProfile? {
      while !lock.withLock({ profileGateOpen }) {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }
      return lock.withLock { profile }
    }

    func saveProfile(_ next: NavigationProfile) async {
      lock.withLock { profile = next }
    }
  }

  /// Routing stub that records the profile it was asked for.
  private final class ProfileRecordingRoutes: DirectionsRoutes, @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [String] = []

    var profiles: [String] { lock.withLock { seen } }

    func route(
      fromLatitude: Double,
      fromLongitude: Double,
      toLatitude: Double,
      toLongitude: Double,
      profile: String
    ) async -> DirectionsResult {
      lock.withLock { seen.append(profile) }
      return .path(
        points: [(fromLatitude, fromLongitude), (toLatitude, toLongitude)],
        distanceMeters: 1_000,
        durationSeconds: 600
      )
    }
  }

  private func navigation(targetLatitude: Double) -> Navigation {
    Navigation(
      targetLatitude: targetLatitude,
      targetLongitude: targetLongitude,
      profile: .walking,
      computedAtMs: 1_700_000_000_000,
      status: .ready,
      distanceMeters: 1_000,
      durationSeconds: 600,
      points: [(riderLatitude, riderLongitude), (targetLatitude, targetLongitude)]
    )
  }

  func testStoredPathComesBackOnRestoreWithoutADirectionsCall() {
    let routes = GatedRoutes()
    let store = FakeStore(
      stored: navigation(targetLatitude: targetLatitude),
      directionPoint: (targetLatitude, targetLongitude)
    )
    let controller = NavigationController(api: routes, store: store)
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }

    controller.restore()
    settle()

    XCTAssertEqual(controller.current?.targetLatitude, targetLatitude)
    XCTAssertEqual(controller.current?.points.count, 2)
    // Restoring is a read: a path computed last weekend is still the path.
    XCTAssertEqual(routes.calls, 0)
    XCTAssertEqual(emitted.values.count, 1)
  }

  func testStoredPathDisagreeingWithTheDirectionPointIsDiscarded() {
    let store = FakeStore(
      stored: navigation(targetLatitude: targetLatitude),
      directionPoint: (secondTargetLatitude, targetLongitude)
    )
    let controller = NavigationController(api: GatedRoutes(), store: store)
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }

    controller.restore()
    settle()

    XCTAssertNil(controller.current)
    // Dropped from storage too, or every later start would re-read and re-reject it.
    XCTAssertNil(store.stored)
    XCTAssertTrue(emitted.values.isEmpty)
  }

  func testRiderTapDuringRestoreWinsOverTheStoredPath() {
    let routes = GatedRoutes()
    let store = FakeStore(
      stored: navigation(targetLatitude: targetLatitude),
      directionPoint: (targetLatitude, targetLongitude)
    )
    let controller = NavigationController(api: routes, store: store)

    controller.restore()
    controller.setTarget(
      toLatitude: secondTargetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    routes.release(secondTargetLatitude)
    settle()

    XCTAssertEqual(controller.current?.targetLatitude, secondTargetLatitude)
    XCTAssertEqual(store.stored?.targetLatitude, secondTargetLatitude)
  }

  func testClearingTheDirectionPointErasesTheStoredPath() {
    let routes = GatedRoutes()
    let store = FakeStore()
    let controller = NavigationController(api: routes, store: store)

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    routes.release(targetLatitude)
    settle()
    XCTAssertEqual(store.stored?.targetLatitude, targetLatitude)

    controller.clear()
    settle()

    XCTAssertNil(store.stored)
  }

  private func settle() {
    // Lets any in-flight Task reach its publish before the assertion reads state.
    Thread.sleep(forTimeInterval: 0.25)
  }

  func testFetchResolvingAfterAClearDoesNotResurrectThePath() {
    let routes = GatedRoutes()
    let controller = NavigationController(api: routes, store: FakeStore())
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    wait(for: [routes.started], timeout: 5)
    controller.clear()
    routes.release(targetLatitude)
    settle()

    XCTAssertNil(controller.current)
    XCTAssertTrue(emitted.values.allSatisfy { $0 == nil })
  }

  func testSlowEarlierFetchDoesNotOverwriteANewerTarget() {
    let routes = GatedRoutes()
    let controller = NavigationController(api: routes, store: FakeStore())

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    wait(for: [routes.started], timeout: 5)
    controller.setTarget(
      toLatitude: secondTargetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    // Newer target resolves first, then the abandoned one.
    routes.release(secondTargetLatitude)
    settle()
    routes.release(targetLatitude)
    settle()

    XCTAssertEqual(controller.current?.targetLatitude, secondTargetLatitude)
  }

  func testMovingTheDirectionPointDropsTheOldPathBeforeTheNewOneArrives() {
    let routes = GatedRoutes()
    let controller = NavigationController(api: routes, store: FakeStore())
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    routes.release(targetLatitude)
    settle()
    XCTAssertEqual(controller.current?.targetLatitude, targetLatitude)

    controller.setTarget(
      toLatitude: secondTargetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )

    // A Navigation belongs to exactly one Direction Point: the old path must not stay drawn under a
    // pin that has already moved.
    XCTAssertNil(controller.current)
    XCTAssertNil(emitted.values.last ?? nil)
  }

  func testNoRiderPositionIsReportedAsAFetchFailureNotAsNoNavigation() {
    let routes = GatedRoutes()
    let controller = NavigationController(api: routes, store: FakeStore())

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: nil,
      fromLongitude: nil
    )

    XCTAssertEqual(controller.current?.status, .fetchFailed)
    XCTAssertEqual(controller.current?.points.count, 0)
    // Nothing to ask with, so nothing was asked.
    XCTAssertEqual(routes.calls, 0)
  }

  func testFailedFetchAndEmptyAnswerAreDifferentFailures() {
    let failing = NavigationController(api: FixedRoutes(.failed), store: FakeStore())
    failing.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    let empty = NavigationController(api: FixedRoutes(.noPath), store: FakeStore())
    empty.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(failing.current?.status, .fetchFailed)
    XCTAssertEqual(empty.current?.status, .noPathFound)
  }

  func testPathDetouringAbsurdlyAroundTheTargetIsNoPathAtAll() {
    // Straight line is ~13 km; this answer rides ~110 km of it, the shape Directions returns when
    // the only way to the target is back out along a road.
    let detour = DirectionsResult.path(
      points: [
        (riderLatitude, riderLongitude),
        (riderLatitude + 0.5, riderLongitude),
        (targetLatitude, targetLongitude),
      ],
      distanceMeters: 110_000,
      durationSeconds: 90_000
    )
    let controller = NavigationController(api: FixedRoutes(detour), store: FakeStore())

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(controller.current?.status, .noPathFound)
    XCTAssertEqual(controller.current?.points.count, 0)
  }

  func testFailedNavigationIsStoredSoARestartDoesNotHideTheFailure() {
    let store = FakeStore(directionPoint: (targetLatitude, targetLongitude))
    let controller = NavigationController(api: FixedRoutes(.failed), store: store)

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()
    XCTAssertEqual(store.stored?.status, .fetchFailed)

    let restarted = NavigationController(api: GatedRoutes(), store: store)
    restarted.restore()
    settle()

    XCTAssertEqual(restarted.current?.status, .fetchFailed)
  }

  func testRetryingAFailedNavigationRecomputesItFromTheRidersCurrentPosition() {
    let store = FakeStore(directionPoint: (targetLatitude, targetLongitude))
    let controller = NavigationController(api: FixedRoutes(.failed), store: store)
    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    // Retry is an ordinary `setTarget` from where the rider is now, which is what the module calls.
    // The rider has moved since the pin was dropped.
    let routes = GatedRoutes()
    let retrying = NavigationController(api: routes, store: store)
    retrying.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude + 0.01,
      fromLongitude: riderLongitude
    )
    routes.release(targetLatitude)
    settle()

    XCTAssertEqual(retrying.current?.status, .ready)
    XCTAssertEqual(retrying.current?.points.first?.latitude ?? 0, riderLatitude + 0.01, accuracy: 1e-9)
  }

  func testStickyProfileIsWhatTheNextNavigationIsComputedUnder() {
    let routes = ProfileRecordingRoutes()
    let store = FakeStore(profile: .cycling)
    let controller = NavigationController(api: routes, store: store)

    controller.restore()
    settle()
    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(routes.profiles, ["cycling"])
    XCTAssertEqual(controller.current?.profile, .cycling)
  }

  func testRiderWhoHasNeverChosenWalks() {
    let routes = ProfileRecordingRoutes()
    let controller = NavigationController(api: routes, store: FakeStore())

    controller.restore()
    settle()
    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(routes.profiles, ["walking"])
  }

  func testChoosingAProfileSticksItForTheNextNavigation() {
    let routes = ProfileRecordingRoutes()
    let store = FakeStore()
    let controller = NavigationController(api: routes, store: store)

    controller.selectProfile(.driving)
    controller.recompute(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(store.storedProfile, .driving)
    XCTAssertEqual(controller.current?.profile, .driving)
    // The next Direction Point is computed under it without being told again.
    controller.setTarget(
      toLatitude: secondTargetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()
    XCTAssertEqual(routes.profiles, ["driving", "driving"])
  }

  func testRecomputeThatFindsNothingLeavesTheDrawnPathAlone() {
    let store = FakeStore(
      stored: navigation(targetLatitude: targetLatitude),
      directionPoint: (targetLatitude, targetLongitude)
    )
    let controller = NavigationController(api: FixedRoutes(.failed), store: store)
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }
    controller.restore()
    settle()
    XCTAssertEqual(controller.current?.status, .ready)
    let drawnAt = controller.current?.computedAtMs

    controller.recompute(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    // Losing a working line by asking for a better one is a bad trade.
    XCTAssertEqual(controller.current?.status, .ready)
    XCTAssertEqual(controller.current?.computedAtMs, drawnAt)
    XCTAssertEqual(store.stored?.status, .ready)
    XCTAssertEqual(emitted.values.last??.status, .ready)
  }

  func testRecomputeWithNothingDrawnYetReportsTheFailure() {
    let controller = NavigationController(api: FixedRoutes(.noPath), store: FakeStore())

    controller.recompute(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(controller.current?.status, .noPathFound)
  }

  func testProfileChosenDuringRestoreWinsOverTheStoredOne() {
    let routes = ProfileRecordingRoutes()
    let store = FakeStore(profile: .cycling, gateProfileRead: true)
    let controller = NavigationController(api: routes, store: store)

    controller.restore()
    // The rider switches while yesterday's value is still being read.
    controller.selectProfile(.driving)
    store.openProfileGate()
    settle()

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: riderLatitude,
      fromLongitude: riderLongitude
    )
    settle()

    XCTAssertEqual(routes.profiles, ["driving"])
    XCTAssertEqual(store.storedProfile, .driving)
  }

  func testFixFillsRouteProgressAndClearingTheNavigationTakesItAway() {
    let store = FakeStore(
      stored: navigation(targetLatitude: targetLatitude),
      directionPoint: (targetLatitude, targetLongitude)
    )
    let controller = NavigationController(api: GatedRoutes(), store: store)
    let progress = ProgressLog()
    controller.onProgressChange = { progress.append($0) }

    controller.restore()
    settle()
    controller.onFix(latitude: riderLatitude, longitude: riderLongitude, speedMps: 5)

    // The rider is standing on the path's first point, so that is what they project onto.
    XCTAssertEqual(controller.currentProgress?.latitude, riderLatitude)

    controller.clear()

    // Route Progress belongs to exactly one Navigation and ends with it — no last known place left
    // over to describe a path that is no longer drawn.
    XCTAssertNil(controller.currentProgress)
    XCTAssertEqual(progress.values.map { $0 == nil }, [false, true])
  }

  func testFixWithoutAPathPublishesNoRouteProgress() {
    let controller = NavigationController(api: GatedRoutes(), store: FakeStore())

    controller.onFix(latitude: riderLatitude, longitude: riderLongitude, speedMps: 5)

    XCTAssertNil(controller.currentProgress)
  }

  /// `onProgressChange` fires from whichever thread published, so the log needs its own guard.
  private final class ProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [RouteProgress?] = []

    func append(_ progress: RouteProgress?) {
      lock.withLock { storage.append(progress) }
    }

    var values: [RouteProgress?] { lock.withLock { storage } }
  }

  /// `onChange` fires from whichever thread published, so the log needs its own guard.
  private final class EmissionLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Navigation?] = []

    func append(_ navigation: Navigation?) {
      lock.withLock { storage.append(navigation) }
    }

    var values: [Navigation?] { lock.withLock { storage } }
  }
}
