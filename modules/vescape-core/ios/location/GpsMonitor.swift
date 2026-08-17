import CoreLocation
import Foundation

/// CLLocationManager-backed GPS monitor for live map state and Ride Recording.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt
/// @platform-diff iOS requests When In Use authorization and relies on Expo config's
/// `UIBackgroundModes.location` for continued ride updates.
internal final class GpsMonitor: NSObject, CLLocationManagerDelegate {
  private let onLocation: (TelemetryLocationCapture) -> Void
  /// Fired when authorization resolves after `start()` has already returned, so the session's
  /// published GPS state (active flag, error) does not sit stale until an unrelated change.
  private let onAuthorizationResolved: () -> Void
  private var manager: CLLocationManager?
  /// True once updates are actually running. Until then the monitor may be pending: the manager
  /// exists and the permission dialog is open, and arming is completed from
  /// `locationManagerDidChangeAuthorization` once the rider taps Allow — so a first-run session
  /// starts producing fixes without an app or session restart.
  private var armed = false
  private var lastError: String?
  private var legalPolicyResolutionStarted = false
  private let legalPolicyResolver = LegalPolicyResolver()

  init(
    onLocation: @escaping (TelemetryLocationCapture) -> Void,
    onAuthorizationResolved: @escaping () -> Void
  ) {
    self.onLocation = onLocation
    self.onAuthorizationResolved = onAuthorizationResolved
  }

  var active: Bool { manager != nil }
  /// Narrower than `active`: true only once `startUpdatingLocation()` actually ran, so diagnostics
  /// can tell a pending permission dialog apart from flowing fixes.
  var updatesStarted: Bool { armed }
  var error: String? { lastError }
  var authorization: String {
    switch CLLocationManager().authorizationStatus {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "when_in_use"
    @unknown default: return "unknown"
    }
  }
  var accuracyAuthorization: String {
    CLLocationManager().accuracyAuthorization == .fullAccuracy ? "full" : "reduced"
  }

  /// Arms the monitor. On first run the permission dialog is asynchronous, so a `.notDetermined`
  /// status is not a failure: the manager is kept and arming is finished by the authorization
  /// delegate. Returns an error only for a decided refusal (denied/restricted).
  func start() -> String? {
    let manager = self.manager ?? makeManager()
    self.manager = manager
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      arm(manager)
      return nil
    case .notDetermined:
      lastError = nil
      manager.requestWhenInUseAuthorization()
      return nil
    case .denied, .restricted:
      return fail()
    @unknown default:
      return fail()
    }
  }

  func stop() {
    manager?.stopUpdatingLocation()
    manager?.delegate = nil
    manager = nil
    armed = false
  }

  private func makeManager() -> CLLocationManager {
    let manager = CLLocationManager()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    return manager
  }

  /// Idempotent: the authorization delegate also fires once right after manager creation, and
  /// `start()` is called from several independent places (map, recording toggle, session start).
  private func arm(_ manager: CLLocationManager) {
    lastError = nil
    guard !armed else { return }
    armed = true
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.startUpdatingLocation()
  }

  private func fail() -> String? {
    stop()
    lastError = "Location permission not granted"
    return lastError
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    let accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
    let speed = location.speed >= 0 ? location.speed : nil
    let bearing = location.course >= 0 ? location.course : nil
    let altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
    onLocation(
      TelemetryLocationCapture(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        speedMps: speed,
        bearingDeg: bearing,
        accuracyM: accuracy,
        altitudeM: altitude,
        timestamp: Int64(location.timestamp.timeIntervalSince1970 * 1000.0),
        precise: isPreciseGpsFix(accuracyM: accuracy)
      )
    )
    resolveInitialLegalPolicy(location)
  }

  /// Completes (or abandons) a start that was waiting on the permission dialog.
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager === self.manager else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      arm(manager)
      onAuthorizationResolved()
    case .denied, .restricted:
      _ = fail()
      onAuthorizationResolved()
    case .notDetermined:
      break
    @unknown default:
      break
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    lastError = error.localizedDescription
  }

  private func resolveInitialLegalPolicy(_ location: CLLocation) {
    guard !legalPolicyResolutionStarted else { return }
    legalPolicyResolutionStarted = true
    Task {
      let appData = AppDataRepository.shared
      let stored = appData.getSettings()["legalPolicy"] ?? nil
      guard stored == nil || stored is NSNull else { return }
      let countryCode = await legalPolicyResolver.resolve(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude
      )
      if let countryCode { appData.updateLegalPolicy(jurisdictionCode: countryCode) }
    }
  }
}
