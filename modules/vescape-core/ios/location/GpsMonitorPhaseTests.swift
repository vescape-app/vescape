import CoreLocation
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/location/GpsPhaseTest.kt
final class GpsMonitorPhaseTests: XCTestCase {
  private final class FakeLocationManager: CLLocationManager {
    var status: CLAuthorizationStatus = .notDetermined
    private(set) var requestedAuthorization = false
    private(set) var updatesRunning = false
    private(set) var startCount = 0
    private var backgroundUpdates = false
    private var autoPause = true

    override var authorizationStatus: CLAuthorizationStatus { status }
    override var allowsBackgroundLocationUpdates: Bool {
      get { backgroundUpdates }
      set { backgroundUpdates = newValue }
    }
    override var pausesLocationUpdatesAutomatically: Bool {
      get { autoPause }
      set { autoPause = newValue }
    }

    override func requestWhenInUseAuthorization() { requestedAuthorization = true }
    override func startUpdatingLocation() {
      updatesRunning = true
      startCount += 1
    }
    override func stopUpdatingLocation() { updatesRunning = false }
  }

  private func makeMonitor(_ manager: FakeLocationManager) -> GpsMonitor {
    GpsMonitor(
      onLocation: { _ in },
      onAuthorizationResolved: {},
      record: { _, _ in },
      makeLocationManager: { manager }
    )
  }

  func testReportsIdleBeforeStart() {
    let monitor = makeMonitor(FakeLocationManager())

    XCTAssertEqual(monitor.phase, .idle)
  }

  func testReportsStartingWhileThePermissionDialogIsOpen() {
    let manager = FakeLocationManager()
    let monitor = makeMonitor(manager)

    XCTAssertNil(monitor.apply(.ride))

    XCTAssertTrue(manager.requestedAuthorization)
    XCTAssertFalse(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .starting)
    XCTAssertNil(monitor.error)
  }

  func testNotDeterminedThenGrantedReportsActive() {
    let manager = FakeLocationManager()
    let monitor = makeMonitor(manager)
    monitor.apply(.ride)

    manager.status = .authorizedWhenInUse
    monitor.locationManagerDidChangeAuthorization(manager)

    XCTAssertTrue(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .active)
    XCTAssertNil(monitor.error)
  }

  func testNotDeterminedThenDeniedReportsError() {
    let manager = FakeLocationManager()
    let monitor = makeMonitor(manager)
    monitor.apply(.ride)

    manager.status = .denied
    monitor.locationManagerDidChangeAuthorization(manager)

    XCTAssertFalse(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .error)
    XCTAssertEqual(monitor.error, "Location permission not granted")
  }

  func testStopReturnsAnArmedMonitorToIdle() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)
    monitor.apply(.ride)
    XCTAssertEqual(monitor.phase, .active)

    monitor.stop()

    XCTAssertEqual(monitor.phase, .idle)
    XCTAssertNil(monitor.error)
  }

  func testMapModeNeverAsksForBackgroundUpdates() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)

    monitor.apply(.map)

    XCTAssertTrue(manager.updatesRunning)
    XCTAssertEqual(monitor.mode, .map)
    XCTAssertFalse(manager.allowsBackgroundLocationUpdates)
    XCTAssertEqual(manager.distanceFilter, GPS_MAP_MIN_DISTANCE_M)
  }

  func testRideModeAsksForUninterruptedBackgroundUpdates() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)

    monitor.apply(.ride)

    XCTAssertEqual(monitor.mode, .ride)
    XCTAssertTrue(manager.allowsBackgroundLocationUpdates)
    XCTAssertFalse(manager.pausesLocationUpdatesAutomatically)
    XCTAssertEqual(manager.distanceFilter, kCLDistanceFilterNone)
  }

  func testChangingModeReconfiguresWithoutRestartingUpdates() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)
    monitor.apply(.map)

    monitor.apply(.ride)

    XCTAssertTrue(manager.updatesRunning)
    XCTAssertEqual(manager.startCount, 1)
    XCTAssertEqual(monitor.mode, .ride)
    XCTAssertTrue(manager.allowsBackgroundLocationUpdates)
  }

  func testOffModeStopsUpdates() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)
    monitor.apply(.ride)

    monitor.apply(.off)

    XCTAssertFalse(manager.updatesRunning)
    XCTAssertEqual(monitor.mode, .off)
    XCTAssertEqual(monitor.phase, .idle)
  }

  func testStopClearsAStandingRefusal() {
    let manager = FakeLocationManager()
    manager.status = .denied
    let monitor = makeMonitor(manager)
    XCTAssertNotNil(monitor.apply(.ride))
    XCTAssertEqual(monitor.phase, .error)

    monitor.stop()

    XCTAssertEqual(monitor.phase, .idle)
  }
}
