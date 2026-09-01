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
  /// Local Diagnostic Event sink (ADR 0007). GPS arming outlives any Board Session — the map arms
  /// it at app start — so these breadcrumbs are recorded here rather than by the session
  /// controller, which can only report `gps_session_summary` once a session ends.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt `record`
  private let record: (String, [String: Any?]) -> Void
  private var manager: CLLocationManager?
  /// True once updates are actually running. Until then the monitor may be pending: the manager
  /// exists and the permission dialog is open, and arming is completed from
  /// `locationManagerDidChangeAuthorization` once the rider taps Allow — so a first-run session
  /// starts producing fixes without an app or session restart.
  private var armed = false
  private var lastError: String?
  private var legalPolicyResolutionStarted = false
  private let legalPolicyResolver = LegalPolicyResolver()
  /// Per-armed-span fix bookkeeping, so `gps_fix_stale` fires at most once per silent stretch
  /// instead of once per watchdog tick.
  private var armedAtMs: Int64?
  private var lastFixAtMs: Int64?
  private var firstFixReported = false
  private var staleReported = false
  private var staleTimer: DispatchSourceTimer?

  init(
    onLocation: @escaping (TelemetryLocationCapture) -> Void,
    onAuthorizationResolved: @escaping () -> Void,
    record: @escaping (String, [String: Any?]) -> Void = { name, props in
      DiagnosticsRecorder.shared.record(eventName: name, properties: props)
    }
  ) {
    self.onLocation = onLocation
    self.onAuthorizationResolved = onAuthorizationResolved
    self.record = record
  }

  var active: Bool { manager != nil }
  /// Narrower than `active`: true only once `startUpdatingLocation()` actually ran, so diagnostics
  /// can tell a pending permission dialog apart from flowing fixes.
  var updatesStarted: Bool { armed }
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
      recordAuthorizationRefusal(message: "Location permission not granted")
      return fail()
    @unknown default:
      recordAuthorizationRefusal(message: "Unknown location authorization status")
      return fail()
    }
  }

  func stop(reason: String = "stop_requested") {
    let wasArmed = armed || manager != nil
    stopStaleWatchdog()
    manager?.stopUpdatingLocation()
    manager?.delegate = nil
    manager = nil
    armed = false
    armedAtMs = nil
    firstFixReported = false
    staleReported = false
    guard wasArmed else { return }
    recordGpsEvent(
      "gps_updates_stopped",
      message: "Location updates stopped",
      extra: ["reason": reason, "last_fix_age_ms": lastFixAtMs.map { nowMs() - $0 }]
    )
  }

  private func makeManager() -> CLLocationManager {
    let manager = CLLocationManager()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    return manager
  }

  /// The live manager already carries the authorization state; only fall back to a throwaway
  /// instance when the monitor is stopped, so status reads do not allocate a manager per call.
  private func authorizationManager() -> CLLocationManager { manager ?? CLLocationManager() }

  /// Idempotent: the authorization delegate also fires once right after manager creation, and
  /// `start()` is called from several independent places (map, recording toggle, session start).
  private func arm(_ manager: CLLocationManager) {
    lastError = nil
    guard !armed else { return }
    armed = true
    armedAtMs = nowMs()
    firstFixReported = false
    staleReported = false
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.startUpdatingLocation()
    recordGpsEvent("gps_updates_started", message: "Location updates started")
    startStaleWatchdog()
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
    recordGpsEvent("gps_provider_error", message: error.localizedDescription)
  }

  // MARK: - Diagnostics

  /// Tracks the first fix of an armed span — `gps_session_summary` already reports time-to-first-
  /// fix, so this only feeds the staleness watchdog — and clears a standing staleness report, so a
  /// monitor that recovers leaves both the loss and the recovery in the log.
  private func noteFix() {
    lastFixAtMs = nowMs()
    firstFixReported = true
    if staleReported {
      staleReported = false
      recordGpsEvent("gps_fix_recovered", message: "GPS fixes resumed")
    }
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

  /// Armed but silent is the failure mode a rider actually notices — the map holds its last
  /// position and nothing in the log says why. Reported once per silent stretch.
  private func checkStaleFix() {
    guard armed, !staleReported else { return }
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

  /// Deliberately lean: `gps_session_summary` already carries the authorization and fix-count
  /// picture per Board Session, so these breadcrumbs only add what an end-of-session aggregate
  /// cannot express — when the monitor stopped, why, and when it went silent mid-span.
  private func recordGpsEvent(
    _ name: String,
    message: String,
    extra: [String: Any?] = [:]
  ) {
    var properties: [String: Any?] = ["message": message, "operation": "gps"]
    for (key, value) in extra { properties[key] = value }
    record(name, properties)
  }

  /// The one event that must stand alone: a refusal means no session will ever start, so no
  /// `gps_session_summary` will report the authorization that caused it.
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
