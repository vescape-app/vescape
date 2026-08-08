import ExpoModulesCore
import Foundation
import UIKit
import UserNotifications

private final class ActiveBoardProbe {
  let id: String
  let detector: BoardTransportDetector
  let promise: Promise

  init(id: String, detector: BoardTransportDetector, promise: Promise) {
    self.id = id
    self.detector = detector
    self.promise = promise
  }
}

// Thin JS bridge. Board scan/connect/telemetry delegate to the CoreBluetooth stack
// (VescGattClient + BoardSessionController); app data delegates to GRDB, while later iOS
// subsystems still keep bridge-shaped stubs.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
/// TODO(iOS parity): port Group Ride, debug recording, and Refloat config subsystems to match
/// Android API/events/errors.
public class VescapeCoreModule: Module {

  // MARK: - Session state

  private var selectedBoardId: String? = nil
  /// Dev-setting request: capture a raw debug Session Recorder for the next Board Session.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `requestedDebugRecordingEnabled`
  private var requestedDebugRecordingEnabled = false

  /// Retains the in-flight Board Probe across its async BLE lifecycle. Only one runs at a time —
  /// the probe owns the single BLE link (see Android `probeBoardLink`).
  private var activeProbe: ActiveBoardProbe?

  /// Frontend liveness gate. False while the app is backgrounded so the high-frequency telemetry
  /// firehose (`onLiveTick` at the board's poll rate, `onTelemetryHistory`, `onLiveSeries`) never
  /// crosses to a JS thread iOS keeps alive under the BLE/`location` background modes — that flood
  /// pegged the JS thread and tripped the OS CPU watchdog (fatal `cpu_resource` kill). Native keeps
  /// polling, recording and firing alerts throughout; only the JS-facing emit sleeps.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `frontendActive`
  private var frontendActive = true
  /// Events with at least one live JS listener, tracked via `OnStartObserving`/`OnStopObserving`.
  private var observedEvents = Set<String>()

  /// Shared, app-level Board Session owner that outlives this module instance. A JS runtime reload
  /// (dev reload, OTA update, JS crash recovery) tears down this module and builds a fresh one; the
  /// session, recording, GPS and Live Activity keep running on the singleton and the new module
  /// re-attaches its JS sinks in `OnCreate` (see `attachToCoordinator`). Mirrors Android's
  /// process-level `CoreForegroundService`, whose session survives module teardown while `OnDestroy`
  /// only detaches the emit sink.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
  private let coordinator = BoardSessionController.shared

  // MARK: - App data state

  private let appData = AppDataRepository.shared
  private let legalPolicyResolver = LegalPolicyResolver()
  private let legalPolicyCatalog = LegalPolicyCatalog()

  /// Bundled alert sounds surfaced to JS through `getAlertSounds`. Mirrors Android
  /// `alertSoundPresetMaps()`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `alertSoundPresetMaps`
  private let alertPresets: [[String: Any]] = alertSoundPresetMaps()
  /// UI alert tests never share evaluator or audio state with the live Board Session.
  private var alertTestPlayer: AlertAudioPlayer?
  private var alertTestCoordinator: AlertCoordinator?
  private var alertTestControlId: String?

  // MARK: - Module definition

  public func definition() -> ModuleDefinition {
    Name("VescapeCore")

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `Events`
    // @parity /modules/vescape-core/src/index.ts `VescapeCoreEvents`
    Events("onDevice", "onError", "onLiveState", "onLiveTick", "onLiveSeries", "onTelemetryHistory", "onBms", "onBmsSeries", "onLocation", "onReplayPhoneHeading", "onTelemetryRebuildProgress", "onBoardProbeProgress", "onAppDataChanged", "onGroupRideConnection", "onGroupRideSnapshot", "onGroupRideCreated", "onGroupRideUpdated", "onGroupRideEnded", "onGroupRideJoined", "onGroupRideRoster", "onGroupRideError", "onBoardWarnings", "onAppStatus", "onNavigation", "onRouteProgress", "onWeather")

    // Track per-event JS listeners so native skips emitting into the void, and gate the whole
    // firehose on app foreground (see `frontendActive`). Mirrors Android's observing + lifecycle
    // gate. @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
    OnStartObserving("onDevice") { self.observedEvents.insert("onDevice") }
    OnStopObserving("onDevice") { self.observedEvents.remove("onDevice") }
    OnStartObserving("onError") { self.observedEvents.insert("onError") }
    OnStopObserving("onError") { self.observedEvents.remove("onError") }
    OnStartObserving("onLiveState") { self.observedEvents.insert("onLiveState") }
    OnStopObserving("onLiveState") { self.observedEvents.remove("onLiveState") }
    OnStartObserving("onLiveTick") { self.observedEvents.insert("onLiveTick") }
    OnStopObserving("onLiveTick") { self.observedEvents.remove("onLiveTick") }
    OnStartObserving("onLiveSeries") { self.observedEvents.insert("onLiveSeries") }
    OnStopObserving("onLiveSeries") { self.observedEvents.remove("onLiveSeries") }
    OnStartObserving("onTelemetryHistory") { self.observedEvents.insert("onTelemetryHistory") }
    OnStopObserving("onTelemetryHistory") { self.observedEvents.remove("onTelemetryHistory") }
    OnStartObserving("onBms") { self.observedEvents.insert("onBms") }
    OnStopObserving("onBms") { self.observedEvents.remove("onBms") }
    OnStartObserving("onBmsSeries") { self.observedEvents.insert("onBmsSeries") }
    OnStopObserving("onBmsSeries") { self.observedEvents.remove("onBmsSeries") }
    OnStartObserving("onLocation") { self.observedEvents.insert("onLocation") }
    OnStopObserving("onLocation") { self.observedEvents.remove("onLocation") }
    OnStartObserving("onTelemetryRebuildProgress") { self.observedEvents.insert("onTelemetryRebuildProgress") }
    OnStopObserving("onTelemetryRebuildProgress") { self.observedEvents.remove("onTelemetryRebuildProgress") }
    OnStartObserving("onBoardWarnings") {
      self.observedEvents.insert("onBoardWarnings")
      // Late subscriber: replay the current warnings for every board so JS is immediately consistent.
      BoardWarningRegistry.shared.emitSnapshot()
    }
    OnStopObserving("onBoardWarnings") { self.observedEvents.remove("onBoardWarnings") }
    OnStartObserving("onAppStatus") {
      self.observedEvents.insert("onAppStatus")
      // Late subscriber: replay the current App Status so JS is immediately consistent.
      self.sendEvent("onAppStatus", ["status": AppStatusCoordinator.shared.current?.toMap()])
    }
    OnStopObserving("onAppStatus") { self.observedEvents.remove("onAppStatus") }
    OnStartObserving("onNavigation") {
      self.observedEvents.insert("onNavigation")
      // Late subscriber: replay the current Navigation so JS is immediately consistent.
      self.sendEvent("onNavigation", [
        "navigation": NavigationController.shared.current?.toMap(),
        "computing": NavigationController.shared.computing,
      ])
    }
    OnStopObserving("onNavigation") { self.observedEvents.remove("onNavigation") }
    OnStartObserving("onRouteProgress") {
      self.observedEvents.insert("onRouteProgress")
      // Late subscriber: replay the current Route Progress rather than making JS wait a fix for it.
      self.sendEvent("onRouteProgress", ["progress": NavigationController.shared.currentProgress?.toMap()])
    }
    OnStopObserving("onRouteProgress") { self.observedEvents.remove("onRouteProgress") }
    OnStartObserving("onWeather") {
      self.observedEvents.insert("onWeather")
      // Late subscriber: replay the known forecast. Nothing here triggers a fetch — the coordinator
      // is fed by GPS Fixes, and a screen opening is not a reason to spend a request.
      self.sendEvent("onWeather", ["weather": WeatherCoordinator.shared.current?.map])
    }
    OnStopObserving("onWeather") { self.observedEvents.remove("onWeather") }

    OnCreate {
      // Native owns App Status truth; JS mirrors it. Push every successful refresh (late
      // subscribers replay above and through `getAppStatus`).
      AppStatusCoordinator.shared.onChange = { [weak self] status in self?.sendAppStatus(status) }

      // The forecast is native-owned too; JS mirrors whatever the coordinator resolves.
      WeatherCoordinator.shared.onChange = { [weak self] weather in self?.sendWeather(weather) }

      // Navigation is native-owned; JS only renders the coordinates it is handed.
      NavigationController.shared.onChange = { [weak self] navigation in self?.sendNavigation(navigation) }
      // Route Progress rides its own event rather than `onNavigation`: it changes on every GPS Fix,
      // and re-sending the whole coordinate array at ~1 Hz to move one number would be absurd.
      NavigationController.shared.onProgressChange = { [weak self] progress in
        self?.sendRouteProgress(progress)
      }
      // Cold start: fetch App Status before JS asks. A foreground event arriving right after is
      // coalesced into this request.
      AppStatusCoordinator.shared.refresh()
      self.attachToCoordinator()
      AppDataRepository.onDataChanged = { [weak self] scope in self?.sendAppDataChanged(scope) }
      // JS keeps a dumb mirror of the durable Board Warning registry; push the full board list on
      // every registry change (late subscribers self-heal via the snapshot above).
      BoardWarningRegistry.shared.onChange = { [weak self] boardId, warnings in
        self?.sendBoardWarnings(boardId, warnings)
      }
      self.autoConnectSelectedBoard()
    }

    OnAppEntersForeground {
      self.frontendActive = true
      AppStatusCoordinator.shared.refresh()
    }
    OnAppEntersBackground {
      self.frontendActive = false
    }

    OnDestroy {
      // JS runtime is tearing down (dev reload, OTA update, JS crash recovery). Detach only the
      // JS-facing sinks; the shared coordinator keeps the native Board Session, recording, GPS and
      // Live Activity alive so a fresh module re-attaches to the live session. Must not call
      // `stopBoard()` (see `docs/ios.md`). Mirrors Android nulling `CoreForegroundService.emitEvent`.
      // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
      self.detachFromCoordinator()
      AppDataRepository.onDataChanged = nil
      BoardWarningRegistry.shared.onChange = nil
      AppStatusCoordinator.shared.onChange = nil
      NavigationController.shared.onChange = nil
      NavigationController.shared.onProgressChange = nil
      self.frontendActive = false
      self.observedEvents.removeAll()
      self.cancelActiveProbe(reason: "module_destroyed")
      self.stopAlertTest()
    }

    // MARK: Scan

    Function("scan") {
      self.coordinator.scan()
    }

    Function("stopScan") {
      self.coordinator.stopScan()
    }

    // MARK: Location

    Function("startLocationUpdates") {
      self.coordinator.startLocationUpdates()
    }

    // Flush buffered telemetry after stopping GPS so no pending rows are lost on the way down.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `stopLocationUpdates`
    Function("stopLocationUpdates") {
      self.coordinator.stopLocationUpdates()
      TelemetryRepository.shared.flushBlocking()
    }

    // MARK: App lifecycle

    // Android kills its foreground service + process here. iOS has no sanctioned process-kill idiom
    // (App Store rejects `exit()`), so this degrades to a graceful native teardown of all long-lived
    // work; JS never crashes calling it.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exitApp`
    // @platform-diff iOS cannot terminate its own process; graceful shutdown instead of kill.
    Function("exitApp") {
      self.coordinator.stopBoard()
      self.coordinator.stopLocationUpdates()
      self.coordinator.stopScan()
    }

    // MARK: Group Ride (Android native implementation; iOS keeps bridge shape)
    // @platform-diff Group Ride networking is Android-only, so the Online Capability gate (refuse/
    // tear down the relay socket while App Status is Online/App Blocked, `blocked` connection state,
    // `Vescape-App-Version` upgrade header, 426 handling) has no iOS peer. These stubs never open a
    // socket, so there is nothing to gate; iOS AppStatusCoordinator keeps its single `onChange` sink.

    Function("startGroupRideObserve") { (_: String) in
      self.sendEvent("onGroupRideConnection", ["state": "idle"])
      self.sendEvent("onGroupRideSnapshot", ["rides": []])
    }

    Function("stopGroupRideObserve") {
      self.sendEvent("onGroupRideConnection", ["state": "idle"])
    }

    Function("createGroupRide") { (_: String, _: String, _: String?, _: String?, _: Double, _: Double) in
      // no-op until iOS native Group Ride support lands
    }

    Function("joinGroupRide") { (_: String, _: String, _: String?, _: String) in
      // no-op until iOS native Group Ride support lands
    }

    Function("leaveGroupRide") {
      self.sendEvent("onGroupRideJoined", ["rideId": nil])
      self.sendEvent("onGroupRideRoster", ["rideId": nil, "riders": []])
    }

    Function("updateGroupRideIdentity") { (_: String, _: String, _: String?) in
      // no-op until iOS native Group Ride support lands
    }

    // MARK: Telemetry recording toggle

    // Latch the request even before connect, silently — the coordinator replays it when a board
    // connects. No error event on the pre-connect path: Android latches without emitting.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setTelemetryRecordingEnabled`
    Function("setTelemetryRecordingEnabled") { (enabled: Bool) in
      _ = self.coordinator.setTelemetryRecordingEnabled(enabled)
    }

    Function("reloadAlertRules") {
      self.coordinator.reloadAlertRules()
    }

    // MARK: Live BMS Series focus gate

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setBmsSeriesFocused`
    Function("setBmsSeriesFocused") { (focused: Bool) in
      self.coordinator.setBmsSeriesFocused(focused)
    }

    AsyncFunction("getCriticalRideNotificationPermissionStatus") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(Self.notificationPermissionStatus(settings.authorizationStatus))
      }
    }

    AsyncFunction("requestCriticalRideNotificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
        if let error {
          promise.reject("ERR_NOTIFICATION_PERMISSION", error.localizedDescription)
          return
        }
        promise.resolve(granted ? "authorized" : "denied")
      }
    }

    Function("previewAlertSound") { (soundType: String) in
      self.coordinator.previewAlertSound(soundType)
    }

    Function("getAlertSounds") {
      self.alertPresets
    }

    Function("startGeigerSimulation") { (soundType: String, rangeDepth: Double) in
      self.coordinator.startGeigerSimulation(soundType: soundType, rangeDepth: rangeDepth)
    }

    Function("stopGeigerSimulation") {
      self.coordinator.stopGeigerSimulation()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startAlertTest`
    // @parity /modules/vescape-core/src/index.ts `startAlertTest`
    Function("startAlertTest") { (ruleMaps: [[String: Any]]) in
      self.startAlertTest(ruleMaps)
    }

    Function("updateAlertTest") { (value: Double) in
      guard let controlId = self.alertTestControlId else { return }
      _ = self.alertTestCoordinator?.evaluateValues(
        // Battery thresholds compare synthetic SoC, while message `{voltage}` keeps a plausible
        // raw sample instead of incorrectly speaking the percentage as volts.
        [controlId: controlId == "battery" ? 48.0 : value],
        batteryPercent: controlId == "battery" ? value : nil,
        onDiagnostic: { _, _ in }
      )
    }

    Function("stopAlertTest") {
      self.stopAlertTest()
    }

    // MARK: App Status

    // Last successful App Status for this process, or nil while none has been fetched (fail-open).
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getAppStatus`
    Function("getAppStatus") { () -> [String: Any?]? in
      AppStatusCoordinator.shared.current?.toMap()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getWeather`
    Function("getWeather") { () -> [String: Any?]? in
      WeatherCoordinator.shared.current?.map
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `refreshWeather`
    Function("refreshWeather") {
      WeatherCoordinator.shared.refresh()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `provisionDeviceCredential`
    AsyncFunction("provisionDeviceCredential") {
      (serverUrl: String, deviceToken: String, accountId: String) async throws -> [String: Any?] in
      try await NativeAuthCoordinator.shared.provision(
        serverUrl: serverUrl,
        token: deviceToken,
        accountId: accountId
      )
    }
    Function("getDeviceCredentialState") { () -> [String: Any?] in
      NativeAuthCoordinator.shared.stateMap()
    }
    AsyncFunction("revokeDeviceCredential") { () async throws in
      try await NativeAuthCoordinator.shared.revoke()
    }
    Function("clearDeviceCredential") {
      NativeAuthCoordinator.shared.clear()
    }

    // Stable Vescape route keeps the app decoupled from the final store destination.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `openAppUpdate`
    // @platform-diff iOS uses the stable iOS download route.
    // @parity /modules/vescape-core/src/index.ts `openAppUpdate`
    Function("openAppUpdate") {
      guard let url = URL(string: AppStatusCoordinator.iosDownloadUrl) else { return }
      DispatchQueue.main.async {
        UIApplication.shared.open(url)
      }
    }

    // MARK: Board session

    Function("getLiveState") {
      self.liveState()
    }

    Function("getRemoteTiltState") { () -> [String: Any]? in
      nil
    }

    Function("setSelectedBoard") { (boardId: String?) in
      self.clearManualDisconnectAutoStartGate()
      self.selectedBoardId = boardId
      self.appData.updateSetting("selectedBoardId", rawValue: boardId)
    }

    AsyncFunction("setCompanionPresenceEnabled") { (enabled: Bool, promise: Promise) in
      promise.reject("UNSUPPORTED_PLATFORM", "Companion presence is Android-only")
    }

    AsyncFunction("getCompanionPresenceBoards") { (promise: Promise) in
      promise.resolve([])
    }

    AsyncFunction("addCompanionPresenceBoard") { (_: String, promise: Promise) in
      promise.reject("UNSUPPORTED_PLATFORM", "Companion presence is Android-only")
    }

    AsyncFunction("removeCompanionPresenceBoard") { (_: String, promise: Promise) in
      promise.reject("UNSUPPORTED_PLATFORM", "Companion presence is Android-only")
    }

    Function("setDebugRecordingEnabled") { (enabled: Bool) in
      self.requestedDebugRecordingEnabled = enabled
    }

    AsyncFunction("listDebugRecordings") { (promise: Promise) in
      do {
        promise.resolve(try DebugRecordingStore().list())
      } catch {
        promise.reject("ERR_LIST_DEBUG_RECORDINGS", error.localizedDescription)
      }
    }

    AsyncFunction("listBundledDebugFixtures") { () -> [[String: Any]] in
      ReplayRecordings.listBundled()
    }

    AsyncFunction("exportDebugRecording") { (name: String, promise: Promise) in
      do {
        promise.resolve(try DebugRecordingStore().export(name: name))
      } catch {
        promise.reject("ERR_EXPORT_DEBUG_RECORDING", error.localizedDescription)
      }
    }

    AsyncFunction("deleteDebugRecording") { (name: String, promise: Promise) in
      do {
        try DebugRecordingStore().delete(name: name)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_DELETE_DEBUG_RECORDING", error.localizedDescription)
      }
    }

    AsyncFunction("startDebugReplay") { (name: String, options: [String: Any]?, promise: Promise) in
      self.coordinator.startReplay(
        recordingName: name,
        warmupMs: (options?["warmupMs"] as? NSNumber)?.int64Value ?? 0,
        warmupSpeed: (options?["warmupSpeed"] as? NSNumber)?.doubleValue ?? 1.0,
        onSuccess: { promise.resolve(nil) },
        onError: { code, message in promise.reject(code, message) }
      )
    }

    Function("recordPhoneHeading") { (headingDeg: Double) in
      self.coordinator.recordPhoneHeading(headingDeg)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setWatchRouteSpanM`
    // @platform-diff Wear Mirror is Android-only; keep the shared TS contract callable on iOS.
    Function("setWatchRouteSpanM") { (_: Double?) in }

    AsyncFunction("stopDebugReplay") { (promise: Promise) in
      self.coordinator.stopBoard()
      promise.resolve(nil)
    }

    AsyncFunction("selectBoard") { (boardId: String, promise: Promise) in
      self.clearManualDisconnectAutoStartGate()
      self.selectedBoardId = boardId
      self.appData.updateSetting("selectedBoardId", rawValue: boardId)
      guard let config = self.connectConfig(boardId: boardId) else {
        promise.reject("NO_LINK", "Board has no Board Link: \(boardId)")
        return
      }
      self.coordinator.connect(
        config: config,
        onSuccess: { promise.resolve(nil) },
        onError: { code, message in promise.reject(code, message) }
      )
    }

    AsyncFunction("stopBoard") { (promise: Promise) in
      DispatchQueue.main.async {
        BoardSessionCommands.stopRide()
        promise.resolve(nil)
      }
    }

    AsyncFunction("probeBoardLink") { (bleId: String, probeId: String, promise: Promise) in
      DispatchQueue.main.async { self.startProbe(bleId: bleId, probeId: probeId, promise: promise) }
    }

    Function("cancelBoardProbe") { (probeId: String) in
      DispatchQueue.main.async { self.cancelActiveProbe(probeId: probeId, reason: "js_cancelled") }
    }

    // MARK: Telemetry history

    AsyncFunction("getTelemetryHistory") { (options: [String: Any], promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getHistory(options))
    }

    AsyncFunction("getTelemetrySamples") { (options: [String: Any], promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getSamples(options))
    }

    AsyncFunction("getHistoryRange") { (options: [String: Any], promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getRange(options))
    }

    Function("reportUiError") { (message: String, source: String?, stack: String?) in
      DiagnosticReporter.shared.reportUiError(message: message, source: source, stack: stack)
    }

    Function("reportDiagnosticTest") { () -> [String: Any?] in
      DiagnosticReporter.shared.reportDiagnosticTest()
    }

    Function("getDiagnosticStatus") { () -> [String: Any?] in
      DiagnosticReporter.shared.status()
    }

    AsyncFunction("getDiagnosticEvents") { (options: [String: Any], promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getDiagnosticEvents(options))
    }

    AsyncFunction("clearDiagnosticEvents") { (promise: Promise) in
      TelemetryRepository.shared.clearDiagnosticEvents()
      promise.resolve(nil)
    }

    AsyncFunction("getBoardWarnings") { (promise: Promise) in
      promise.resolve(BoardWarningRegistry.shared.allWarnings().map { $0.toMap() })
    }

    AsyncFunction("clearBoardWarning") { (boardId: String, kind: String, promise: Promise) in
      BoardWarningRegistry.shared.clearWarning(boardId: boardId, kind: kind)
      promise.resolve(nil)
    }

    AsyncFunction("clearAllBoardWarnings") { (boardId: String, promise: Promise) in
      BoardWarningRegistry.shared.clearAllWarnings(boardId: boardId)
      promise.resolve(nil)
    }

    AsyncFunction("devInjectBoardWarning") { (boardId: String, kind: String, severity: String, payloadJson: String, promise: Promise) in
      BoardWarningRegistry.shared.reportFinding(
        boardId: boardId,
        kind: kind,
        severity: BoardWarningRegistry.Severity.fromWire(severity),
        payloadJson: payloadJson
      )
      promise.resolve(nil)
    }

    AsyncFunction("devReportCleanBoardWarning") { (boardId: String, kind: String, promise: Promise) in
      BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: kind)
      promise.resolve(nil)
    }

    AsyncFunction("getTelemetrySummary") { (promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getSummary())
    }

    AsyncFunction("getDatabaseSizeBytes") { () -> Int in
      Int(TelemetryDatabase.databaseSizeBytes)
    }

    AsyncFunction("backupDatabase") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try DatabaseBackupManager.createBackup())
        } catch {
          promise.reject("ERR_BACKUP_DATABASE", error.localizedDescription)
        }
      }
    }

    // Stop every writer touching the DB before the file swap: scan, board session (flushes buffered
    // telemetry synchronously via `endSession`), and GPS. All are synchronous here, so the pool is
    // idle before the async restore runs. @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `stopNativeWorkForDatabaseRestore`
    AsyncFunction("restoreDatabase") { (uri: String, promise: Promise) in
      self.coordinator.stopScan()
      self.coordinator.stopBoard()
      self.coordinator.stopLocationUpdates()
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try DatabaseBackupManager.restoreBackup(uriString: uri)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_RESTORE_DATABASE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("getRefloatConfigSnapshot") { (promise: Promise) in
      self.coordinator.getRefloatConfigSnapshot(
        onSuccess: { snapshot in promise.resolve(snapshot) },
        onError: { code, message in promise.reject(code, message) }
      )
    }

    AsyncFunction("setRemoteTilt") { (_: Int) -> Bool in
      false
    }

    AsyncFunction("lockRemoteTilt") { (_: Int) -> Bool in
      false
    }

    AsyncFunction("releaseRemoteTilt") { (_: Int, _: Int) -> Bool in
      false
    }

    AsyncFunction("stopRemoteTilt") { () -> Bool in
      false
    }

    AsyncFunction("startBoardMove") { (input: Int) -> Bool in
      self.coordinator.startBoardMove(input: input)
    }

    AsyncFunction("stopBoardMove") { () -> Bool in
      self.coordinator.stopBoardMove()
    }

    // MARK: - Tune Profiles (#161)
    // DB-backed per-board VESC tune configs with Tune History, matching Android 1:1. `TuneProfileStore`
    // owns the transactional semantics; mutations reject with Android's error vocabulary.

    AsyncFunction("getTuneProfiles") { (boardId: String, refloatBaseVersion: String?, promise: Promise) in
      promise.resolve(TuneProfileStore.shared.getTuneProfiles(boardId, refloatBaseVersion: refloatBaseVersion))
    }

    AsyncFunction("getTuneProfile") { (profileId: String, promise: Promise) in
      promise.resolve(TuneProfileStore.shared.getTuneProfile(profileId))
    }

    AsyncFunction("createProfile") { (boardId: String, name: String, icon: String, color: String, fields: [String: Any], refloatBaseVersion: String, promise: Promise) in
      do {
        promise.resolve(try TuneProfileStore.shared.createProfile(boardId: boardId, name: name, icon: icon, color: color, fields: fields, refloatBaseVersion: refloatBaseVersion))
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("renameProfile") { (profileId: String, name: String, icon: String, color: String, promise: Promise) in
      do {
        promise.resolve(try TuneProfileStore.shared.renameProfile(profileId: profileId, name: name, icon: icon, color: color))
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("deleteProfile") { (profileId: String, promise: Promise) in
      do {
        try TuneProfileStore.shared.deleteProfile(profileId: profileId)
        promise.resolve(nil)
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("getProfileHistory") { (profileId: String, promise: Promise) in
      promise.resolve(TuneProfileStore.shared.getProfileHistory(profileId))
    }

    AsyncFunction("rollbackProfile") { (profileId: String, historyEntryId: Double, promise: Promise) in
      do {
        promise.resolve(
          try TuneProfileStore.shared.rollbackProfile(profileId: profileId, historyEntryId: Int64(historyEntryId))
        )
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("copyProfileToBoard") { (profileId: String, targetBoardId: String, newName: String, promise: Promise) in
      do {
        promise.resolve(
          try TuneProfileStore.shared.copyProfileToBoard(
            profileId: profileId,
            targetBoardId: targetBoardId,
            newName: newName
          )
        )
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("saveProfile") { (profileId: String, fields: [String: Any], promise: Promise) in
      do {
        promise.resolve(try TuneProfileStore.shared.saveProfile(profileId: profileId, fields: fields))
      } catch {
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `pushProfileToBoard`
    AsyncFunction("pushProfileToBoard") { (profileId: String, promise: Promise) in
      self.coordinator.pushProfileToBoard(
        profileId: profileId,
        onSuccess: { snapshot in promise.resolve(snapshot) },
        onError: { code, message in promise.reject(code, message) }
      )
    }

    AsyncFunction("getTotalProfileStats") { (promise: Promise) in
      promise.resolve(ProfileStatsRepository.shared.getTotalProfileStats())
    }

    AsyncFunction("getMonthlyProfileStats") { (options: [String: Any], promise: Promise) in
      promise.resolve(ProfileStatsRepository.shared.getMonthlyProfileStats(options))
    }

    AsyncFunction("getProfileStatMonths") { (promise: Promise) in
      promise.resolve(ProfileStatsRepository.shared.getProfileStatMonths())
    }

    // Favorites (ADR 0029). JS supplies only the range and an optional name; identity, timestamps
    // and the denormalized summary are native.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFavorites`
    AsyncFunction("getFavorites") { (promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getFavorites())
    }

    AsyncFunction("createFavorite") { (options: [String: Any], promise: Promise) in
      guard let favorite = TelemetryRepository.shared.createFavorite(options) else {
        promise.reject("ERR_CREATE_FAVORITE", "favorite range is invalid or could not be stored")
        return
      }
      promise.resolve(favorite)
    }

    AsyncFunction("updateFavorite") { (id: String, options: [String: Any], promise: Promise) in
      guard let favorite = TelemetryRepository.shared.updateFavorite(id, options: options) else {
        promise.reject("ERR_UPDATE_FAVORITE", "favorite does not exist or could not be stored")
        return
      }
      promise.resolve(favorite)
    }

    AsyncFunction("deleteFavorite") { (id: String, promise: Promise) in
      promise.resolve(TelemetryRepository.shared.deleteFavorite(id))
    }

    AsyncFunction("getFavoriteMedia") { (favoriteId: String, promise: Promise) in
      promise.resolve(TelemetryRepository.shared.getFavoriteMedia(favoriteId))
    }

    AsyncFunction("importFavoriteMedia") { (options: [String: Any], promise: Promise) in
      do {
        promise.resolve(try TelemetryRepository.shared.importFavoriteMedia(options))
      } catch {
        promise.reject("ERR_IMPORT_FAVORITE_MEDIA", error.localizedDescription)
      }
    }

    AsyncFunction("deleteTelemetryBefore") { (beforeMs: Double, promise: Promise) in
      promise.resolve(TelemetryRepository.shared.deleteBefore(Int64(beforeMs)))
    }

    AsyncFunction("deleteTelemetryRange") { (options: [String: Any], promise: Promise) in
      promise.resolve(TelemetryRepository.shared.deleteRange(options))
    }

    // Gate progress on foreground + active listener and hop to main, like every other JS emit. The
    // rebuild callback fires from a background queue; skip the void when JS isn't listening.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `rebuildTelemetryBuckets`
    AsyncFunction("rebuildTelemetryBuckets") { (promise: Promise) in
      let count = TelemetryRepository.shared.rebuildBuckets { current, total in
        guard self.shouldEmitToFrontend("onTelemetryRebuildProgress") else { return }
        DispatchQueue.main.async {
          guard self.shouldEmitToFrontend("onTelemetryRebuildProgress") else { return }
          self.sendEvent("onTelemetryRebuildProgress", ["current": current, "total": total])
        }
      }
      promise.resolve(count)
    }

    AsyncFunction("clearTelemetryHistory") { (promise: Promise) in
      TelemetryRepository.shared.clearAll()
      promise.resolve(nil)
    }

    AsyncFunction("getBoards") { (promise: Promise) in
      promise.resolve(self.appData.getBoards())
    }

    AsyncFunction("upsertBoard") { (board: [String: Any], promise: Promise) in
      self.appData.upsertBoard(board)
      self.coordinator.reloadBoardDataForActiveBoard()
      promise.resolve(nil)
    }

    AsyncFunction("deleteBoard") { (id: String, promise: Promise) in
      self.appData.deleteBoard(id)
      promise.resolve(nil)
    }

    AsyncFunction("getAlertRules") { (boardId: String, promise: Promise) in
      promise.resolve(self.appData.getAlertRules(boardId))
    }

    AsyncFunction("upsertAlertRule") { (rule: [String: Any], promise: Promise) in
      self.appData.upsertAlertRule(rule)
      self.coordinator.reloadAlertRules()
      promise.resolve(nil)
    }

    AsyncFunction("setAlertRuleEnabled") { (boardId: String, id: String, enabled: Bool, promise: Promise) in
      self.appData.setAlertRuleEnabled(boardId, id, enabled)
      self.coordinator.reloadAlertRules()
      promise.resolve(nil)
    }

    AsyncFunction("deleteAlertRule") { (boardId: String, id: String, promise: Promise) in
      self.appData.deleteAlertRule(boardId, id)
      self.coordinator.reloadAlertRules()
      promise.resolve(nil)
    }

    AsyncFunction("getPrivacyZones") { (promise: Promise) in
      promise.resolve(self.appData.getPrivacyZones())
    }

    AsyncFunction("upsertPrivacyZone") { (zone: [String: Any], promise: Promise) in
      self.appData.upsertPrivacyZone(zone)
      self.reloadPrivacyZonesIntoRecorder()
      promise.resolve(nil)
    }

    AsyncFunction("setPrivacyZoneEnabled") { (id: String, enabled: Bool, promise: Promise) in
      self.appData.setPrivacyZoneEnabled(id, enabled)
      self.reloadPrivacyZonesIntoRecorder()
      promise.resolve(nil)
    }

    AsyncFunction("deletePrivacyZone") { (id: String, promise: Promise) in
      self.appData.deletePrivacyZone(id)
      self.reloadPrivacyZonesIntoRecorder()
      promise.resolve(nil)
    }

    // Map Points are server-owned; native holds no copy.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getNearbyMapPoints`
    AsyncFunction("getNearbyMapPoints") {
      (latitude: Double, longitude: Double, radiusMeters: Int, promise: Promise) in
      Task {
        do {
          promise.resolve(
            try await MapPointApi.shared.nearby(
              latitude: latitude,
              longitude: longitude,
              radiusMeters: radiusMeters
            )
          )
        } catch { Self.rejectMapPoint(promise, error) }
      }
    }

    AsyncFunction("createMapPoint") { (values: [String: Any], promise: Promise) in
      Task {
        do { promise.resolve(try await MapPointApi.shared.create(values)) }
        catch { Self.rejectMapPoint(promise, error) }
      }
    }

    AsyncFunction("updateMapPoint") { (id: String, patch: [String: Any], promise: Promise) in
      Task {
        do { promise.resolve(try await MapPointApi.shared.update(id, patch: patch)) }
        catch { Self.rejectMapPoint(promise, error) }
      }
    }

    AsyncFunction("deleteMapPoint") { (id: String, promise: Promise) in
      Task {
        do {
          try await MapPointApi.shared.delete(id)
          promise.resolve(nil)
        } catch { Self.rejectMapPoint(promise, error) }
      }
    }

    AsyncFunction("setMapPointReaction") { (id: String, reaction: String?, promise: Promise) in
      Task {
        do {
          try await MapPointApi.shared.setReaction(id, reaction: reaction)
          promise.resolve(nil)
        } catch { Self.rejectMapPoint(promise, error) }
      }
    }

    // The direction target is personal client state, never a Map Point.
    AsyncFunction("setDirectionPoint") { (latitude: Double?, longitude: Double?, promise: Promise) in
      self.appData.setDirectionPoint(latitude: latitude, longitude: longitude)

      // A Navigation belongs to exactly one Direction Point: setting one asks for a path, clearing
      // one ends it. The Directions call runs off the promise so the pin lands immediately.
      if let latitude, let longitude {
        let origin = self.navigationOrigin()
        NavigationController.shared.setTarget(
          toLatitude: latitude,
          toLongitude: longitude,
          fromLatitude: origin?.latitude,
          fromLongitude: origin?.longitude
        )
      } else {
        NavigationController.shared.clear()
      }
      promise.resolve(nil)
    }

    // Rider-initiated only: nothing in the app calls this on a timer, on reconnect, or on a new
    // fix. It recomputes from where the rider is *now*, not from where the pin was first dropped —
    // by then they have usually ridden somewhere with signal, or somewhere a path exists.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `recomputeNavigation`
    // @parity /modules/vescape-core/src/index.ts `recomputeNavigation`
    AsyncFunction("recomputeNavigation") { (promise: Promise) in
      self.recomputeNavigation()
      promise.resolve(nil)
    }

    // Switching the Navigation Profile is two things at once: the choice sticks as app data, and the
    // path is computed again under it. The stored profile moves even with no Direction Point set —
    // the rider chose, and the next Navigation honours it.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setNavigationProfile`
    // @parity /modules/vescape-core/src/index.ts `setNavigationProfile`
    AsyncFunction("setNavigationProfile") { (profile: String, promise: Promise) in
      NavigationController.shared.selectProfile(NavigationProfile.fromWire(profile))
      self.recomputeNavigation()
      promise.resolve(nil)
    }

    AsyncFunction("getSettings") { (promise: Promise) in
      promise.resolve(self.appData.getSettings())
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `refreshLegalPolicy`
    // @parity /modules/vescape-core/src/index.ts `refreshLegalPolicy`
    AsyncFunction("refreshLegalPolicy") { (promise: Promise) in
      let settings = self.appData.getSettings()
      let latitude = settings["lastGpsLatitude"] as? Double
      let longitude = settings["lastGpsLongitude"] as? Double
      Task {
        let countryCode: String? = if let latitude, let longitude {
          await self.legalPolicyResolver.resolve(latitude: latitude, longitude: longitude)
        } else {
          nil
        }
        self.appData.updateLegalPolicy(jurisdictionCode: countryCode)
        self.coordinator.reloadAlertRules()
        promise.resolve(nil)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setLegalMode`
    // @parity /modules/vescape-core/src/index.ts `setLegalMode`
    AsyncFunction("setLegalMode") { (boardId: String, enabled: Bool, promise: Promise) in
      guard self.appData.getBoard(boardId) != nil else {
        promise.reject("BOARD_NOT_FOUND", "Board not found: \(boardId)")
        return
      }
      if enabled {
        if let (code, message) = self.coordinator.legalModeEnableError(boardId: boardId) {
          promise.reject(code, message)
          return
        }
        let settings = self.appData.getSettings()
        let jurisdictionCode =
          ((settings["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
        guard let jurisdictionCode, self.legalPolicyCatalog.speeds(countryCode: jurisdictionCode) != nil else {
          promise.reject("LEGAL_POLICY_UNRESOLVED", "Resolved Legal Policy required")
          return
        }
      }
      self.appData.updateLegalMode(boardId: boardId, enabled: enabled)
      self.coordinator.reloadAlertRules()
      promise.resolve(nil)
    }

    // JS sends the raw setting value (bool/number/string/object/null), matching Android's
    // `Any?` param. `getAny()` recursively converts the JS value to native primitives; it must run
    // on the JS thread, so this stays a synchronous `Function` (like `setSelectedBoard`) rather than
    // an off-thread `AsyncFunction` that would touch a live `JavaScriptValue` on a worker queue.
    // `appData.updateSetting` treats `NSNull` (JS null/undefined) as a delete.
    Function("updateSetting") { (key: String, value: JavaScriptValue) in
      self.appData.updateSetting(key, rawValue: value.getAny())
      if [
        "liveHistoryLimit",
        "movingSpeedThresholdKmh",
        "avgSpeedCutoffKmh",
        "movingAvgSpeedThresholdKmh",
        "freeSpinMaxSpeedDeltaKmh",
        "freeSpinStationaryBoardCapKmh",
        "socEstimateWindowSeconds",
        "telemetryPollRateHz",
        "boardWarningsEnabled",
      ].contains(key) {
        self.coordinator.reloadTelemetrySettings()
      }
    }
  }

  private func startAlertTest(_ ruleMaps: [[String: Any]]) {
    stopAlertTest()
    let rules = ruleMaps.compactMap(Self.alertTestRule)
    guard let controlId = rules.first?.controlId else { return }
    guard rules.allSatisfy({ $0.controlId == controlId }) else { return }

    let player = AlertAudioPlayer()
    let coordinator = AlertCoordinator(player: player, vibrateSingles: false)
    coordinator.replaceRules(rules)
    alertTestPlayer = player
    alertTestCoordinator = coordinator
    alertTestControlId = controlId
  }

  private func stopAlertTest() {
    alertTestCoordinator?.stopAllGeiger()
    alertTestCoordinator = nil
    alertTestControlId = nil
    alertTestPlayer?.release()
    alertTestPlayer = nil
  }

  private static func alertTestRule(_ value: [String: Any]) -> AlertRule? {
    guard
      let id = value["id"] as? String,
      let controlId = value["controlId"] as? String,
      let threshold = (value["threshold"] as? NSNumber)?.doubleValue,
      let soundType = value["soundType"] as? String
    else { return nil }
    return AlertRule(
      boardId: "alert-test",
      id: id,
      controlId: controlId,
      threshold: threshold,
      thresholdMax: (value["thresholdMax"] as? NSNumber)?.doubleValue,
      enabled: true,
      soundType: soundType,
      createdAt: 0,
      repeatEverySeconds: normalizedAlertRepeatSeconds((value["repeatEverySeconds"] as? NSNumber)?.doubleValue),
      beepCount: normalizedAlertBeepCount((value["beepCount"] as? NSNumber)?.intValue),
      source: nil
    )
  }

  // MARK: - Board Probe

  /// Run a Board Probe of one BLE peripheral: end any live Board Session (the probe owns the
  /// single BLE link), then drive `BoardTransportDetector` and resolve with the confirmed
  /// candidate set. Mirrors Android `probeBoardLink`.
  private func startProbe(bleId: String, probeId: String, promise: Promise) {
    guard !bleId.isEmpty else {
      promise.reject("INVALID_ARGUMENT", "Board Probe needs a BLE peripheral id")
      return
    }
    guard !probeId.isEmpty else {
      promise.reject("INVALID_ARGUMENT", "Board Probe needs a probe id")
      return
    }
    cancelActiveProbe(reason: "replaced")
    coordinator.stopBoard()
    let detector = BoardTransportDetector(
      probeId: probeId,
      bleId: bleId,
      recordDiagnostic: { name, props in
        DiagnosticsRecorder.shared.record(eventName: name, properties: props)
      },
      onProgress: { [weak self] progress in
        guard self?.activeProbe?.id == probeId else { return }
        self?.sendEvent("onBoardProbeProgress", progress)
      },
      onComplete: { [weak self] result in
        guard self?.activeProbe?.id == probeId else { return }
        self?.activeProbe = nil
        promise.resolve(
          self?.probeResultToBridge(result) ?? [
            "outcome": "none",
            "transport": nil,
            "candidates": [] as [Any],
          ] as [String: Any?]
        )
      },
      onError: { [weak self] code, message in
        guard self?.activeProbe?.id == probeId else { return }
        self?.activeProbe = nil
        promise.reject(code, message)
      }
    )
    activeProbe = ActiveBoardProbe(id: probeId, detector: detector, promise: promise)
    detector.start()
  }

  private func cancelActiveProbe(probeId: String? = nil, reason: String) {
    guard let activeProbe else { return }
    if let probeId, activeProbe.id != probeId { return }
    self.activeProbe = nil
    activeProbe.detector.cancel(reason: reason)
    activeProbe.promise.reject("PROBE_CANCELLED", "Board Probe cancelled")
  }

  private func probeResultToBridge(_ result: TransportDetection.Result) -> [String: Any?] {
    let candidates = result.candidates.map { candidate in
      [
        "transport": candidate.transport.bridgeValue,
        "hasBms": candidate.hasBms,
        "vescFirmwareVersion": candidate.vescFirmwareVersion,
        "refloatVersion": candidate.refloatVersion,
        "refloatBaseVersion": candidate.refloatBaseVersion,
      ] as [String: Any?]
    }
    let outcome: String
    switch result.outcome {
    case .resolved: outcome = "resolved"
    case .needsPick: outcome = "needs-pick"
    case .none: outcome = "none"
    }
    return ["outcome": outcome, "transport": result.resolvedTransport?.bridgeValue, "candidates": candidates]
  }

  // MARK: - Coordinator sink attach/detach

  /// Wire this module's JS-facing sinks into the shared coordinator. Runs on module create — including
  /// the fresh module built after a JS reload — so events flow and `onLiveState` recomposes against
  /// the still-running session. Mirrors Android setting `CoreForegroundService.emitEvent`.
  private func attachToCoordinator() {
    coordinator.emit = { [weak self] name, body in
      guard let self, self.shouldEmitToFrontend(name) else { return }
      self.sendEvent(name, body)
    }
    coordinator.onStateChanged = { [weak self] in
      guard let self, self.shouldEmitToFrontend("onLiveState") else { return }
      self.sendEvent("onLiveState", self.liveState())
    }
  }

  /// Drop the JS sinks so the coordinator emits into the void once this module dies, without ending
  /// the native session. Mirrors Android nulling `CoreForegroundService.emitEvent` in `OnDestroy`.
  private func detachFromCoordinator() {
    coordinator.emit = nil
    coordinator.onStateChanged = nil
  }

  // MARK: - Board session bridge

  /// Auto-connect the selected board at app launch, native-driven and independent of JS. Mirrors
  /// Android's `AutoConnectProvider` (fires at process start) → `autoConnectSelectedBoard`: JS
  /// never triggers this, it only toggles the `autoConnect` setting. No-ops when auto-connect is
  /// off, no board is selected, or the board is unlinked.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `autoConnectSelectedBoard`
  private func autoConnectSelectedBoard() {
    // The shared coordinator already owns a live session (e.g. this module was rebuilt by a JS
    // reload mid-ride) — never restart it; the new module only re-attached its sinks. Mirrors
    // Android, where auto-connect fires once at process start, not on every module create.
    guard coordinator.connectedBoardId == nil else { return }
    let settings = appData.getSettings()
    guard settings["autoConnect"] as? Bool ?? true else { return }
    guard let boardId = settings["selectedBoardId"] as? String, !boardId.isEmpty else { return }
    guard !ManualBoardStop.isAutoStartSuppressed(boardId: boardId) else { return }
    DispatchQueue.main.async {
      guard let config = self.connectConfig(boardId: boardId) else { return }
      self.selectedBoardId = boardId
      self.coordinator.connect(config: config, onSuccess: {}, onError: { _, _ in })
    }
  }

  /// Resolve a stored board's Board Link into a runtime connect config. Returns `nil` when the
  /// board is unlinked (JS routes those to Board Probe instead). Dumb connect (ADR 0015): the
  /// transport is read straight from the link, never rediscovered.
  private func connectConfig(boardId: String) -> BoardConnectConfig? {
    guard let board = appData.getBoard(boardId) else { return nil }
    guard let link = board["link"] as? [String: Any?] else { return nil }
    guard let bleId = link["bleId"] as? String, !bleId.isEmpty else { return nil }
    let transport = BoardTransport.fromBridge(link["transport"] ?? nil) ?? .direct
    let name = board["name"] as? String ?? "VESC Board"
    let settings = appData.getSettings()
    let hz = AppDataRepository.intValue(settings["telemetryPollRateHz"] ?? nil) ?? 0
    return BoardConnectConfig(
      appBoardId: boardId,
      bleId: bleId,
      name: name,
      transport: transport,
      linkVersion: AppDataRepository.intValue(link["linkVersion"] ?? nil),
      hasBms: link["hasBms"] as? Bool,
      vescFirmwareVersion: link["vescFirmwareVersion"] as? String,
      refloatVersion: link["refloatVersion"] as? String,
      refloatBaseVersion: link["refloatBaseVersion"] as? String,
      pollIntervalMs: hz > 0 ? 1000 / hz : 0,
      batteryConfig: AppDataRepository.normalizeBatteryConfig(board["batteryConfig"] ?? nil),
      liveHistoryLimitMinutes: AppDataRepository.liveHistoryLimitMinutes(settings["liveHistoryLimit"] ?? nil) ?? 5,
      recordingEnabled: requestedDebugRecordingEnabled
    )
  }

  private func clearManualDisconnectAutoStartGate() {
    ManualBoardStop.clearAutoStartSuppression()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt `buildLiveState`
  private func liveState() -> [String: Any?] {
    let settings = appData.getSettings()
    return [
      "board": [
        "phase": coordinator.phase.rawValue,
        "selectedBoardId": selectedBoardId ?? (settings["selectedBoardId"] ?? nil),
        "connectedBoardId": coordinator.connectedBoardId,
        "bleId": coordinator.bleId,
        "name": coordinator.boardName,
        "connectionSeq": coordinator.connectionSeq,
        "lastTelemetryAt": coordinator.lastTelemetryAt,
        "recentTelemetry": coordinator.recentTelemetry(),
        "error": coordinator.boardError,
        "autoConnect": settings["autoConnect"] as? Bool ?? true,
        "linkIntegrity": coordinator.linkIntegrity.rawValue,
        "remoteTilt": coordinator.remoteTiltState(),
      ] as [String: Any?],
      "gps": [
        "phase": coordinator.gpsActive() ? "active" : "idle",
        "latestFix": coordinator.gpsLatestPreciseLocation(),
        "latestApproximateFix": coordinator.gpsLatestLocation(),
        "latestPreciseFix": coordinator.gpsLatestPreciseLocation(),
        "recentLocations": coordinator.gpsRecentLocations(),
        "error": coordinator.gpsLastError(),
      ] as [String: Any?],
      "scan": [
        "phase": coordinator.scanPhase,
        "devices": [] as [Any],
        "error": coordinator.scanError,
      ] as [String: Any?],
      "recording": [
        "enabled": coordinator.telemetryRecordingEnabled(),
        "paused": coordinator.recordingPaused(),
        "activeBoardId": coordinator.recordingActiveBoardId(),
        // Always null, matching Android's live-state mapper — JS never consumes a real timestamp.
        // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt
        "startedAt": nil,
      ] as [String: Any?],
    ]
  }

  /// True only when the app is foregrounded and JS is actively listening to `name`. Gates the
  /// coordinator's JS-facing emits so the telemetry firehose sleeps in the background.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `shouldEmitToFrontend`
  private func shouldEmitToFrontend(_ name: String) -> Bool {
    frontendActive && observedEvents.contains(name)
  }

  /// Push the current enabled Privacy Zones into the recording store so mid-ride edits take effect
  /// immediately, not just on the next session. Mirrors Android `reloadPrivacyZonesIntoRecorder`.
  private func reloadPrivacyZonesIntoRecorder() {
    TelemetryRepository.shared.reloadPrivacyZones(appData.getEnabledPrivacyZoneEntities())
  }

  /// Emit `onAppDataChanged` so JS reloads the store for [scope]. Bypasses the `frontendActive`
  /// firehose gate — these are low-rate config writes JS must not miss (Android emits regardless).
  /// `sendEvent` must run on the main thread, so hop over from any background write closure.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `notifyDataChanged`
  private func sendAppDataChanged(_ scope: String) {
    DispatchQueue.main.async { self.sendEvent("onAppDataChanged", ["scope": scope]) }
  }

  /// Emit `onBoardWarnings` with the full current warning list for a Board. `sendEvent` must run on
  /// the main thread; drop the emit when no JS listener is attached (the snapshot on subscribe and
  /// the next registry change self-heal it).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
  /// @parity /modules/vescape-core/src/index.ts `BoardWarningsEvent`
  private func sendBoardWarnings(_ boardId: String, _ warnings: [BoardWarning]) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onBoardWarnings") else { return }
      self.sendEvent("onBoardWarnings", ["boardId": boardId, "warnings": warnings.map { $0.toMap() }])
    }
  }

  /// Emit `onAppStatus` with the process's current App Status (`nil` while none was fetched).
  /// `sendEvent` must run on the main thread; drop the emit when no JS listener is attached — the
  /// replay on subscribe and the next successful refresh self-heal it.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onAppStatus`
  /// @parity /modules/vescape-core/src/index.ts `AppStatusEvent`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onWeatherChanged`
  private func sendWeather(_ weather: Weather?) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onWeather") else { return }
      self.sendEvent("onWeather", ["weather": weather?.map])
    }
  }

  private func sendAppStatus(_ status: AppStatus?) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onAppStatus") else { return }
      self.sendEvent("onAppStatus", ["status": status?.toMap()])
    }
  }

  /// Asks for the path again, to the Direction Point the rider already has and from where they are
  /// now. A no-op with no Direction Point: there is nothing to compute a path to.
  private func recomputeNavigation() {
    guard let directionPoint = appData.getDirectionPoint() else { return }
    let origin = navigationOrigin()
    NavigationController.shared.recompute(
      toLatitude: directionPoint.latitude,
      toLongitude: directionPoint.longitude,
      fromLatitude: origin?.latitude,
      fromLongitude: origin?.longitude
    )
  }

  /// Where a path starts: the rider's live fix, however weak, falling back to the last GPS position
  /// in app data only when the phone has produced nothing at all this run.
  ///
  /// The stored row is a survivor of the last session, so on a cold start indoors it is easily
  /// yesterday's position kilometres away. A live approximate fix is the rider; the stored one only
  /// claims to be.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `navigationOrigin`
  private func navigationOrigin() -> (latitude: Double, longitude: Double)? {
    if let live = coordinator.riderPosition() { return live }
    let settings = appData.getSettings()
    guard let latitude = settings["lastGpsLatitude"] as? Double,
          let longitude = settings["lastGpsLongitude"] as? Double
    else { return nil }
    return (latitude, longitude)
  }

  /// Emit `onNavigation` with the process's current Navigation (`nil` while none is computed).
  /// `sendEvent` must run on the main thread; drop the emit when no JS listener is attached — the
  /// replay on subscribe and `getNavigation` self-heal it.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onNavigation`
  /// @parity /modules/vescape-core/src/index.ts `NavigationEvent`
  private func sendNavigation(_ navigation: Navigation?) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onNavigation") else { return }
      self.sendEvent("onNavigation", [
        "navigation": navigation?.toMap(),
        "computing": NavigationController.shared.computing,
      ])
    }
  }

  /// Emit `onRouteProgress` with the rider's place along the current path (`nil` while there is no
  /// Navigation to be along). `sendEvent` must run on the main thread; drop the emit when no JS
  /// listener is attached — the replay on subscribe self-heals it, as does the next fix.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onRouteProgress`
  /// @parity /modules/vescape-core/src/index.ts `RouteProgressEvent`
  private func sendRouteProgress(_ progress: RouteProgress?) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onRouteProgress") else { return }
      self.sendEvent("onRouteProgress", ["progress": progress?.toMap()])
    }
  }

  /// Map Point failures carry a code JS branches on; anything else is an unexpected native fault.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `MapPointApiException`
  private static func rejectMapPoint(_ promise: Promise, _ error: Error) {
    guard let apiError = error as? MapPointApiError else {
      promise.reject(MapPointApiError.refused, error.localizedDescription)
      return
    }
    promise.reject(apiError.code, apiError.message)
  }

  private static func notificationPermissionStatus(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not-determined"
    case .denied: return "denied"
    case .authorized: return "authorized"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    @unknown default: return "unknown"
    }
  }
}
