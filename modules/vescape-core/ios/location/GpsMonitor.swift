import CoreLocation
import Foundation

/// CLLocationManager-backed GPS monitor for live map state and Ride Recording.
///
/// Driven by demand, never armed open-endedly: the caller hands it a `GpsPowerMode` and the monitor
/// makes the hardware match. `off` tears the manager down rather than leaving it idling.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt
/// @platform-diff iOS requests When In Use authorization and relies on Expo config's
/// `UIBackgroundModes.location` for continued ride updates. Background delivery is asked for only in
/// `ride` mode, so a foreground-only `map` span cannot outlive the app going to the background.
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
  /// Mode the live manager is currently configured for. `nil` while nothing is armed.
  private var armedMode: GpsPowerMode?
  /// Mode the caller last asked for. Survives a pending permission dialog, so the grant arms the
  /// mode the rider's situation actually called for rather than whatever `map` default.
  private var pendingMode: GpsPowerMode?
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

  /// Injected so tests can drive the authorization transitions the phase is built on; production
  /// always gets a real `CLLocationManager`.
  private let makeLocationManager: () -> CLLocationManager
  /// Status-only manager, retained for the spans when no live one exists. Authorization is read on
  /// every Live State emit, and demand-driven GPS spends real time stopped, so allocating a throwaway
  /// manager per read would be a steady cost for a value that never needs one.
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
  /// Narrower than `active`: true only once `startUpdatingLocation()` actually ran, so diagnostics
  /// can tell a pending permission dialog apart from flowing fixes.
  var updatesStarted: Bool { armed }
  /// What the hardware is currently being driven at, for Live State and diagnostics.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsMonitor.kt `mode`
  var mode: GpsPowerMode { armedMode ?? .off }
  /// Live State phase. `active` means updates are running, not merely that a manager exists — a
  /// manager held while the permission dialog is open reports `starting`.
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

  /// Make the hardware match `mode`. Idempotent and safe to call on every demand change: re-applying
  /// the armed mode does nothing, and a changed mode reconfigures the live manager in place rather
  /// than bouncing updates off and on.
  ///
  /// On first run the permission dialog is asynchronous, so a `.notDetermined` status is not a
  /// failure: the manager is kept and arming is finished by the authorization delegate. Returns an
  /// error only for a decided refusal (denied/restricted).
  ///
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
    // A stopped monitor is idle, not failed. `fail()` re-sets the error right after this call, so a
    // refusal still lands on `error` — matching Android, which clears `gpsError` on every stop.
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

  /// The live manager already carries the authorization state; only fall back to a retained
  /// status-only instance when the monitor is stopped, so status reads never allocate.
  private func authorizationManager() -> CLLocationManager {
    if let manager { return manager }
    if let statusManager { return statusManager }
    let fallback = makeLocationManager()
    statusManager = fallback
    return fallback
  }

  /// Idempotent: the authorization delegate also fires once right after manager creation, and
  /// `apply(_:)` runs on every demand change (foreground, session phase, Idle Pause, Group Ride).
  private func arm(_ manager: CLLocationManager, mode: GpsPowerMode) {
    lastError = nil
    configure(manager, for: mode)
    guard !armed else {
      guard armedMode != mode else { return }
      let previous = armedMode
      armedMode = mode
      // The manager keeps delivering across a reconfigure, so the armed span — and its fix
      // bookkeeping — continues rather than restarting. Only the watchdog is re-judged, because it
      // is meaningful in `ride` (fixes must flow) and not in `map` (a stationary rider gets none).
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

  /// The whole cost difference between the modes. `map` never asks for background delivery, so a
  /// foreground-only span cannot survive the app being backgrounded even if a demand refresh is
  /// somehow missed; `ride` asks for everything and disables the OS's automatic pausing, which would
  /// otherwise silently cut a Ride Track short.
  private func configure(_ manager: CLLocationManager, for mode: GpsPowerMode) {
    // Accuracy is `best` in both modes: `map` is on screen, where a coarse marker reads as a bug,
    // and the saving there comes from the distance filter and from never running in the background.
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
      // Unreachable: `apply(_:)` stops instead of arming. Left explicit so a new mode cannot be
      // added without deciding what the hardware should do for it.
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

  /// Completes (or abandons) a start that was waiting on the permission dialog.
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager === self.manager else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      // The demand that opened the dialog is what gets armed; `map` is only a floor for the case
      // where the grant somehow outlives the request that asked for it.
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

  /// Only `ride` mode promises a steady fix stream, so only `ride` can be meaningfully silent.
  /// `map` mode gates delivery on `GPS_MAP_MIN_DISTANCE_M`, where a rider standing at a bus stop
  /// legitimately produces nothing for minutes — watching it there would log noise, not a fault.
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

  /// Armed but silent is the failure mode a rider actually notices — the map holds its last
  /// position and nothing in the log says why. Reported once per silent stretch.
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
