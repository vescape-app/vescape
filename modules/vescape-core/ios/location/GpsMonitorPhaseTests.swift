import CoreLocation
import XCTest

@testable import VescapeCore

/// Drives the monitor through the authorization transitions the reported phase is built on.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/location/GpsPhaseTest.kt
final class GpsMonitorPhaseTests: XCTestCase {
  /// Overrides the bits of `CLLocationManager` the monitor touches, so a test can hold a
  /// `.notDetermined` status open and then answer it. `allowsBackgroundLocationUpdates` is
  /// overridden because setting it on a real manager without the background mode traps.
  private final class FakeLocationManager: CLLocationManager {
    var status: CLAuthorizationStatus = .notDetermined
    private(set) var requestedAuthorization = false
    private(set) var updatesRunning = false
    private var backgroundUpdates = false

    override var authorizationStatus: CLAuthorizationStatus { status }
    override var allowsBackgroundLocationUpdates: Bool {
      get { backgroundUpdates }
      set { backgroundUpdates = newValue }
    }

    override func requestWhenInUseAuthorization() { requestedAuthorization = true }
    override func startUpdatingLocation() { updatesRunning = true }
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

    XCTAssertNil(monitor.start())

    XCTAssertTrue(manager.requestedAuthorization)
    XCTAssertFalse(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .starting)
    XCTAssertNil(monitor.error)
  }

  func testNotDeterminedThenGrantedReportsActive() {
    let manager = FakeLocationManager()
    let monitor = makeMonitor(manager)
    _ = monitor.start()

    manager.status = .authorizedWhenInUse
    monitor.locationManagerDidChangeAuthorization(manager)

    XCTAssertTrue(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .active)
    XCTAssertNil(monitor.error)
  }

  func testNotDeterminedThenDeniedReportsError() {
    let manager = FakeLocationManager()
    let monitor = makeMonitor(manager)
    _ = monitor.start()

    manager.status = .denied
    monitor.locationManagerDidChangeAuthorization(manager)

    XCTAssertFalse(manager.updatesRunning)
    XCTAssertEqual(monitor.phase, .error)
    // The phase and the error surfaced next to it come from the same value.
    XCTAssertEqual(monitor.error, "Location permission not granted")
  }

  func testStopReturnsAnArmedMonitorToIdle() {
    let manager = FakeLocationManager()
    manager.status = .authorizedWhenInUse
    let monitor = makeMonitor(manager)
    _ = monitor.start()
    XCTAssertEqual(monitor.phase, .active)

    monitor.stop()

    XCTAssertEqual(monitor.phase, .idle)
    XCTAssertNil(monitor.error)
  }

  func testStopClearsAStandingRefusal() {
    let manager = FakeLocationManager()
    manager.status = .denied
    let monitor = makeMonitor(manager)
    XCTAssertNotNil(monitor.start())
    XCTAssertEqual(monitor.phase, .error)

    monitor.stop()

    XCTAssertEqual(monitor.phase, .idle)
  }
}
