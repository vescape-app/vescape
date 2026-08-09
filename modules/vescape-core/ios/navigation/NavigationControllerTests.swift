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
    let started = XCTestExpectation(description: "route started")

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
      started.fulfill()
      while !lock.withLock({ released.contains(toLatitude) }) {
        try? await Task.sleep(nanoseconds: 5_000_000)
      }
      return [(fromLatitude, fromLongitude), (toLatitude, toLongitude)]
    }
  }

  private func settle() {
    // Lets any in-flight Task reach its publish before the assertion reads state.
    Thread.sleep(forTimeInterval: 0.25)
  }

  func testFetchResolvingAfterAClearDoesNotResurrectThePath() {
    let routes = GatedRoutes()
    let controller = NavigationController(api: routes)
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
    let controller = NavigationController(api: routes)

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
    let controller = NavigationController(api: routes)
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
    let controller = NavigationController(api: GatedRoutes())
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
