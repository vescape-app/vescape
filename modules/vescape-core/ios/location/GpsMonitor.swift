import CoreLocation
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt
/// @platform-diff iOS requests When In Use authorization and relies on Expo config's
internal final class GpsMonitor: NSObject, CLLocationManagerDelegate {
  private let onLocation: (TelemetryLocationCapture) -> Void
  private let onAuthorizationResolved: () -> Void
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt `record`
  private let record: (String, [String: Any?]) -> Void
  private var manager: CLLocationManager?
  private var armed = false
  private var armedMode: GpsPowerMode?
  private var pendingMode: GpsPowerMode?
  private var lastError: String?
  private var legalPolicyResolutionStarted = false
  private let legalPolicyResolver = LegalPolicyResolver()
  private var armedAtMs: Int64?
  private var lastFixAtMs: Int64?
  private var firstFixReported = false
  private var staleReported = false
  private var staleTimer: DispatchSourceTimer?

  private let makeLocationManager: () -> CLLocationManager
  private var statusManager: CLLocationManager?

  init(
    onLocation: @escaping (TelemetryLocationCapture) -> Void,
    onAuthorizationResolved: @escaping () -> Void,
    record: @escaping (String, [String: Any?]) -> Void = { name, props in
      DiagnosticsRecorder.shared.record(eventName: name, properties: props)
    },
    makeLocationManager: @escaping () -> CLLocationManager = { CLLocationManager() }
  ) {
    self.onLocation = onLocation
    self.onAuthorizationResolved = onAuthorizationResolved
    self.record = record
    self.makeLocationManager = makeLocationManager
  }

  var active: Bool { manager != nil }
  var updatesStarted: Bool { armed }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt `mode`
  var mode: GpsPowerMode { armedMode ?? .off }
  var phase: GpsPhase {
    GpsPhase.resolve(retained: manager != nil, updatesStarted: armed, error: lastError)
  }
  var error: String? { lastError }
  var authorization: String {
    switch authorizationManager().authorizationStatus {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "when_in_use"
    @unknown default: return "unknown"
    }
  }
  var accuracyAuthorization: String {
    authorizationManager().accuracyAuthorization == .fullAccuracy ? "full" : "reduced"
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt `apply`
  @discardableResult
  func apply(_ mode: GpsPowerMode) -> String? {
    guard mode != .off else {
      stop(reason: "demand_released")
      return nil
    }
    pendingMode = mode
    let manager = self.manager ?? makeManager()
    self.manager = manager
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      arm(manager, mode: mode)
      return nil
    case .notDetermined:
      lastError = nil
      manager.requestWhenInUseAuthorization()
      return nil
    case .denied, .restricted:
      recordAuthorizationRefusal(message: "Location permission not granted")
      return fail()
    @unknown default:
      recordAuthorizationRefusal(message: "Unknown location authorization status")
      return fail()
    }
  }

  func stop(reason: String = "stop_requested") {
    let wasArmed = armed || manager != nil
    let stoppedMode = armedMode
    stopStaleWatchdog()
    manager?.stopUpdatingLocation()
    manager?.delegate = nil
    manager = nil
    armed = false
    armedMode = nil
    pendingMode = nil
    lastError = nil
    armedAtMs = nil
    firstFixReported = false
    staleReported = false
    guard wasArmed else { return }
    recordGpsEvent(
      "gps_updates_stopped",
      message: "Location updates stopped",
      extra: [
        "reason": reason,
        "mode": stoppedMode?.rawValue,
        "last_fix_age_ms": lastFixAtMs.map { nowMs() - $0 },
      ]
    )
  }

  private func makeManager() -> CLLocationManager {
    let manager = makeLocationManager()
    manager.delegate = self
    return manager
  }

  private func authorizationManager() -> CLLocationManager {
    if let manager { return manager }
    if let statusManager { return statusManager }
    let fallback = makeLocationManager()
    statusManager = fallback
    return fallback
  }

  private func arm(_ manager: CLLocationManager, mode: GpsPowerMode) {
    lastError = nil
    configure(manager, for: mode)
    guard !armed else {
      guard armedMode != mode else { return }
      let previous = armedMode
      armedMode = mode
      applyStaleWatchdog(for: mode)
      recordGpsEvent(
        "gps_mode_changed",
        message: "Location updates reconfigured",
        extra: ["mode": mode.rawValue, "previous_mode": previous?.rawValue]
      )
      return
    }
    armed = true
    armedMode = mode
    armedAtMs = nowMs()
    firstFixReported = false
    staleReported = false
    manager.startUpdatingLocation()
    recordGpsEvent(
      "gps_updates_started",
      message: "Location updates started",
      extra: ["mode": mode.rawValue]
    )
    applyStaleWatchdog(for: mode)
  }

  private func configure(_ manager: CLLocationManager, for mode: GpsPowerMode) {
    manager.desiredAccuracy = kCLLocationAccuracyBest
    switch mode {
    case .ride:
      manager.distanceFilter = kCLDistanceFilterNone
      manager.allowsBackgroundLocationUpdates = true
      manager.pausesLocationUpdatesAutomatically = false
    case .map:
      manager.distanceFilter = GPS_MAP_MIN_DISTANCE_M
      manager.allowsBackgroundLocationUpdates = false
      manager.pausesLocationUpdatesAutomatically = true
    case .off:
      break
    }
  }

  private func fail() -> String? {
    stop(reason: "authorization_refused")
    lastError = "Location permission not granted"
    return lastError
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    let accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
    let speed = location.speed >= 0 ? location.speed : nil
    let bearing = location.course >= 0 ? location.course : nil
    let altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
    let precise = isPreciseGpsFix(accuracyM: accuracy)
    noteFix()
    onLocation(
      TelemetryLocationCapture(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        speedMps: speed,
        bearingDeg: bearing,
        accuracyM: accuracy,
        altitudeM: altitude,
        timestamp: Int64(location.timestamp.timeIntervalSince1970 * 1000.0),
        precise: precise
      )
    )
    resolveInitialLegalPolicy(location)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager === self.manager else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      arm(manager, mode: pendingMode ?? .map)
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
    recordGpsEvent("gps_provider_error", message: error.localizedDescription)
  }

  private func noteFix() {
    lastFixAtMs = nowMs()
    firstFixReported = true
    if staleReported {
      staleReported = false
      recordGpsEvent("gps_fix_recovered", message: "GPS fixes resumed")
    }
  }

  private func applyStaleWatchdog(for mode: GpsPowerMode) {
    guard mode == .ride else {
      stopStaleWatchdog()
      staleReported = false
      return
    }
    startStaleWatchdog()
  }

  private func startStaleWatchdog() {
    stopStaleWatchdog()
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(
      deadline: .now() + GPS_STALE_FIX_TIMEOUT_S,
      repeating: GPS_STALE_FIX_TIMEOUT_S
    )
    timer.setEventHandler { [weak self] in self?.checkStaleFix() }
    staleTimer = timer
    timer.resume()
  }

  private func stopStaleWatchdog() {
    staleTimer?.cancel()
    staleTimer = nil
  }

  private func checkStaleFix() {
    guard armed, armedMode == .ride, !staleReported else { return }
    guard let since = lastFixAtMs ?? armedAtMs else { return }
    let age = nowMs() - since
    guard Double(age) >= GPS_STALE_FIX_TIMEOUT_S * 1000.0 else { return }
    staleReported = true
    recordGpsEvent(
      "gps_fix_stale",
      message: firstFixReported ? "No GPS fix since last update" : "No GPS fix since arming",
      extra: ["age_ms": age, "had_fix": firstFixReported]
    )
  }

  private func recordGpsEvent(
    _ name: String,
    message: String,
    extra: [String: Any?] = [:]
  ) {
    var properties: [String: Any?] = ["message": message, "operation": "gps"]
    for (key, value) in extra { properties[key] = value }
    record(name, properties)
  }

  private func recordAuthorizationRefusal(message: String) {
    recordGpsEvent(
      "gps_start_denied",
      message: message,
      extra: [
        "authorization": authorization,
        "accuracy_authorization": accuracyAuthorization,
      ]
    )
  }

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }

  private func resolveInitialLegalPolicy(_ location: CLLocation) {
    guard !legalPolicyResolutionStarted else { return }
    legalPolicyResolutionStarted = true
    Task {
      let appData = AppDataRepository.shared
      let stored: Any?
      do { stored = try appData.getSettings()["legalPolicy"] ?? nil }
      catch {
        RecordingStorageFailure.reportRead(operation: "legal_policy_settings_read", error: error)
        return
      }
      guard stored == nil || stored is NSNull else { return }
      let resolution = await legalPolicyResolver.resolve(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude
      )
      if case .resolved(let countryCode?) = resolution {
        do { try appData.updateLegalPolicy(jurisdictionCode: countryCode) }
        catch { RecordingStorageFailure.report(operation: "legal_policy_save", category: "write_failed", error: error) }
      }
    }
  }
}
