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
    ) async -> [(latitude: Double, longitude: Double)]? {
      lock.withLock { callCount += 1 }
      started.fulfill()
      while !lock.withLock({ released.contains(toLatitude) }) {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }
      return [(fromLatitude, fromLongitude), (toLatitude, toLongitude)]
    }
  }

  /// In-memory stand-in for the App Settings rows, so restore and write-through need no database.
  private final class FakeStore: NavigationStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Navigation?
    private var target: (latitude: Double, longitude: Double)?

    init(stored: Navigation? = nil, directionPoint: (latitude: Double, longitude: Double)? = nil) {
      storage = stored
      target = directionPoint
    }

    var stored: Navigation? { lock.withLock { storage } }

    func load() async -> Navigation? { lock.withLock { storage } }

    func save(_ navigation: Navigation?) async {
      lock.withLock { storage = navigation }
    }

    func directionPoint() async -> (latitude: Double, longitude: Double)? {
      lock.withLock { target }
    }
  }

  private func navigation(targetLatitude: Double) -> Navigation {
    Navigation(
      targetLatitude: targetLatitude,
      targetLongitude: targetLongitude,
      profile: "walking",
      computedAtMs: 1_700_000_000_000,
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

  func testNoRiderPositionYieldsNoNavigation() {
    let controller = NavigationController(api: GatedRoutes(), store: FakeStore())
    let emitted = EmissionLog()
    controller.onChange = { emitted.append($0) }

    controller.setTarget(
      toLatitude: targetLatitude,
      toLongitude: targetLongitude,
      fromLatitude: nil,
      fromLongitude: nil
    )

    XCTAssertNil(controller.current)
    XCTAssertTrue(emitted.values.isEmpty)
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
