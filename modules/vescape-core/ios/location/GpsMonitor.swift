import CoreLocation
import Foundation

/// CLLocationManager-backed GPS monitor for live map state and Ride Recording.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt
/// @platform-diff iOS requests When In Use authorization and relies on Expo config's
/// `UIBackgroundModes.location` for continued ride updates.
internal final class GpsMonitor: NSObject, CLLocationManagerDelegate {
  private let onLocation: (TelemetryLocationCapture) -> Void
  private var manager: CLLocationManager?
  private var lastError: String?
  private var legalPolicyResolutionStarted = false
  private let legalPolicyResolver = LegalPolicyResolver()

  init(onLocation: @escaping (TelemetryLocationCapture) -> Void) {
    self.onLocation = onLocation
  }

  var active: Bool { manager != nil }
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

  func start() -> String? {
    let manager = CLLocationManager()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    if manager.authorizationStatus == .notDetermined {
      manager.requestWhenInUseAuthorization()
    }
    let status = manager.authorizationStatus
    guard status == .authorizedWhenInUse || status == .authorizedAlways else {
      lastError = "Location permission not granted"
      return lastError
    }
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.startUpdatingLocation()
    self.manager = manager
    lastError = nil
    return nil
  }

  func stop() {
    manager?.stopUpdatingLocation()
    manager?.delegate = nil
    manager = nil
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
