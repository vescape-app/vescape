import ExpoModulesCore
import os

private extension Promise {
  func reject(_ code: String, _ message: String, cause: Error) {
    reject(Exception(name: code, description: message, code: code).causedBy(cause))
  }
}

private func reportTunePersistenceWrite(operation: String, error: Error) {
  if let tuneError = error as? TuneProfileError, tuneError != .databaseUnavailable { return }
  RecordingStorageFailure.report(operation: operation, category: "write_failed", error: error)
}
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
public class VescapeCoreModule: Module {
  private let scheduler = MainQueueScheduler()

  private var selectedBoardId: String? = nil
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `requestedDebugRecordingEnabled`
  private var requestedDebugRecordingEnabled = false

  private var activeProbe: ActiveBoardProbe?
  private var completedProbes: [String: TransportDetection.Result] = [:]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `frontendActive`
  private var frontendActive = true
  private var observedEvents = Set<String>()
  private let rideExportCancelled = OSAllocatedUnfairLock(initialState: false)
  private var appStatusUnsubscribe: (() -> Void)?
  private var rideNoticesUnsubscribe: (() -> Void)?
  private var serviceConfigUnsubscribe: (() -> Void)?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
  private let coordinator = BoardSessionController.shared

  private let appData = AppDataRepository.shared
  private let legalPolicyResolver = LegalPolicyResolver()
  private let legalPolicyCatalog = LegalPolicyCatalog()

  private let alertPresets: [[String: Any]] = alertSoundChoices()
  private var alertTestPlayer: AlertAudioPlayer?
  private var alertTestCoordinator: AlertCoordinator?
  private var alertTestControlId: String?

  public func definition() -> ModuleDefinition {
    Name("VescapeCore")

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `Events`
    // @parity /modules/vescape-core/src/index.ts `VescapeCoreEvents`
    Events("onDevice", "onRideExportProgress", "onError", "onLiveState", "onLiveTick", "onLiveSeries", "onFocusedSeries", "onBms", "onBmsSeries", "onLocation", "onMaintenanceState", "onBoardProbeProgress", "onAppDataChanged", "onGroupRideConnection", "onGroupRideError", "onGroupRideSignalAvailability", "onPublicRideStatus", "onPublicRiders", "onPublicPins", "onBoardWarnings", "onVescFaults", "onBoardConfigValues", "onMotorConfigValues", "onBoardConfigChangeNotice", "onBoardLights", "onAppStatus", "onServiceConfig", "onNavigation", "onRouteProgress", "onWeather", "onAccessoryDevice", "onAccessoryScanError", "onAccessoryState", "onAccessoryReading", "onRideNotices")

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
    OnStartObserving("onFocusedSeries") { self.observedEvents.insert("onFocusedSeries") }
    OnStopObserving("onFocusedSeries") { self.observedEvents.remove("onFocusedSeries") }
    OnStartObserving("onBms") { self.observedEvents.insert("onBms") }
    OnStopObserving("onBms") { self.observedEvents.remove("onBms") }
    OnStartObserving("onBmsSeries") { self.observedEvents.insert("onBmsSeries") }
    OnStopObserving("onBmsSeries") { self.observedEvents.remove("onBmsSeries") }
    OnStartObserving("onLocation") { self.observedEvents.insert("onLocation") }
    OnStopObserving("onLocation") { self.observedEvents.remove("onLocation") }
    OnStartObserving("onMaintenanceState") {
      self.observedEvents.insert("onMaintenanceState")
      self.emitMaintenanceState(MaintenanceRunner.shared.snapshot())
    }
    OnStopObserving("onMaintenanceState") { self.observedEvents.remove("onMaintenanceState") }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onGroupRideConnection`
    OnStartObserving("onGroupRideConnection") { self.observedEvents.insert("onGroupRideConnection") }
    OnStopObserving("onGroupRideConnection") { self.observedEvents.remove("onGroupRideConnection") }
    OnStartObserving("onGroupRideError") { self.observedEvents.insert("onGroupRideError") }
    OnStopObserving("onGroupRideError") { self.observedEvents.remove("onGroupRideError") }
    OnStartObserving("onGroupRideSignalAvailability") { self.observedEvents.insert("onGroupRideSignalAvailability") }
    OnStopObserving("onGroupRideSignalAvailability") { self.observedEvents.remove("onGroupRideSignalAvailability") }
    OnStartObserving("onPublicRideStatus") { self.observedEvents.insert("onPublicRideStatus") }
    OnStopObserving("onPublicRideStatus") { self.observedEvents.remove("onPublicRideStatus") }
    OnStartObserving("onPublicRiders") { self.observedEvents.insert("onPublicRiders") }
    OnStopObserving("onPublicRiders") { self.observedEvents.remove("onPublicRiders") }
    OnStartObserving("onPublicPins") { self.observedEvents.insert("onPublicPins") }
    OnStopObserving("onPublicPins") { self.observedEvents.remove("onPublicPins") }
    OnStartObserving("onBoardWarnings") {
      self.observedEvents.insert("onBoardWarnings")
      BoardWarningRegistry.shared.emitSnapshot()
    }
    OnStopObserving("onBoardWarnings") { self.observedEvents.remove("onBoardWarnings") }

    OnStartObserving("onVescFaults") {
      self.observedEvents.insert("onVescFaults")
      VescFaultCoordinator.shared.emitSnapshot()
    }
    OnStopObserving("onVescFaults") { self.observedEvents.remove("onVescFaults") }
    OnStartObserving("onBoardConfigValues") {
      self.observedEvents.insert("onBoardConfigValues")
      self.sendEvent("onBoardConfigValues", ["values": self.coordinator.boardConfigValuesMap()])
    }
    OnStopObserving("onBoardConfigValues") { self.observedEvents.remove("onBoardConfigValues") }
    OnStartObserving("onMotorConfigValues") {
      self.observedEvents.insert("onMotorConfigValues")
      self.sendEvent("onMotorConfigValues", ["values": self.coordinator.motorConfigValuesMap()])
    }
    OnStopObserving("onMotorConfigValues") { self.observedEvents.remove("onMotorConfigValues") }
    OnStartObserving("onBoardConfigChangeNotice") { self.observedEvents.insert("onBoardConfigChangeNotice") }
    OnStopObserving("onBoardConfigChangeNotice") { self.observedEvents.remove("onBoardConfigChangeNotice") }
    OnStartObserving("onBoardLights") {
      self.observedEvents.insert("onBoardLights")
      self.sendEvent("onBoardLights", self.coordinator.lightsEventBody())
    }
    OnStopObserving("onBoardLights") { self.observedEvents.remove("onBoardLights") }
    OnStartObserving("onAppStatus") {
      self.observedEvents.insert("onAppStatus")
      self.sendEvent("onAppStatus", ["status": AppStatusCoordinator.shared.current?.toMap()])
    }
    OnStopObserving("onAppStatus") { self.observedEvents.remove("onAppStatus") }
    OnStartObserving("onServiceConfig") {
      self.observedEvents.insert("onServiceConfig")
      self.sendEvent("onServiceConfig", ["config": ServiceConfigCoordinator.shared.current.toMap()])
    }
    OnStopObserving("onServiceConfig") { self.observedEvents.remove("onServiceConfig") }
    OnStartObserving("onNavigation") {
      self.observedEvents.insert("onNavigation")
      self.sendEvent("onNavigation", [
        "navigation": NavigationController.shared.current?.toMap(),
        "computing": NavigationController.shared.computing,
      ])
    }
    OnStopObserving("onNavigation") { self.observedEvents.remove("onNavigation") }
    OnStartObserving("onRouteProgress") {
      self.observedEvents.insert("onRouteProgress")
      self.sendEvent("onRouteProgress", ["progress": NavigationController.shared.currentProgress?.toMap()])
    }
    OnStopObserving("onRouteProgress") { self.observedEvents.remove("onRouteProgress") }
    OnStartObserving("onWeather") {
      self.observedEvents.insert("onWeather")
      self.sendEvent("onWeather", ["weather": WeatherCoordinator.shared.current?.map])
    }
    OnStopObserving("onWeather") { self.observedEvents.remove("onWeather") }
    OnStartObserving("onAccessoryDevice") { self.observedEvents.insert("onAccessoryDevice") }
    OnStopObserving("onAccessoryDevice") { self.observedEvents.remove("onAccessoryDevice") }
    OnStartObserving("onAccessoryScanError") { self.observedEvents.insert("onAccessoryScanError") }
    OnStopObserving("onAccessoryScanError") { self.observedEvents.remove("onAccessoryScanError") }
    OnStartObserving("onAccessoryState") { self.observedEvents.insert("onAccessoryState") }
    OnStopObserving("onAccessoryState") { self.observedEvents.remove("onAccessoryState") }
    OnStartObserving("onAccessoryReading") { self.observedEvents.insert("onAccessoryReading") }
    OnStopObserving("onAccessoryReading") { self.observedEvents.remove("onAccessoryReading") }
    OnStartObserving("onRideNotices") {
      self.observedEvents.insert("onRideNotices")
      self.emitRideNotices(RideNotices.shared.current)
    }
    OnStopObserving("onRideNotices") { self.observedEvents.remove("onRideNotices") }

    OnCreate {
      DispatchQueue.main.async {
        self.coordinator.appVisible = UIApplication.shared.applicationState != .background
      }
      // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `AccessoryDiscovery`
      AccessoryDiscovery.shared.emit = { [weak self] name, body in
        guard let self, self.shouldEmitToFrontend(name) else { return }
        self.sendEvent(name, body)
      }

      // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `AccessorySessionManager`
      AccessorySessionController.shared.emit = { [weak self] name, body in
        guard let self, self.shouldEmitToFrontend(name) else { return }
        self.sendEvent(name, body)
      }

      RecordingStorageFailure.observeOutage { [weak self] in
        guard let self, self.shouldEmitToFrontend("onLiveState") else { return }
        self.sendEvent("onLiveState", self.liveState())
      }
      self.appStatusUnsubscribe?()
      self.appStatusUnsubscribe = AppStatusCoordinator.shared.addChangeListener { [weak self] status in
        self?.sendAppStatus(status)
      }
      self.serviceConfigUnsubscribe?()
      self.serviceConfigUnsubscribe = ServiceConfigCoordinator.shared.addChangeListener { [weak self] config in
        self?.sendServiceConfig(config)
      }

      WeatherCoordinator.shared.onChange = { [weak self] weather in self?.sendWeather(weather) }

      NavigationController.shared.onChange = { [weak self] navigation in self?.sendNavigation(navigation) }
      NavigationController.shared.onProgressChange = { [weak self] progress in
        self?.sendRouteProgress(progress)
      }
      AppStatusCoordinator.shared.refresh()
      ServiceConfigCoordinator.shared.refresh()
      Task { await RiderStatsSender.shared.foreground() }
      self.attachToCoordinator()
      self.rideNoticesUnsubscribe = RideNotices.shared.addListener { [weak self] in self?.emitRideNotices($0) }
      self.coordinator.reapOrphanLiveActivities()
      AppDataRepository.onDataChanged = { [weak self] scope in self?.sendAppDataChanged(scope) }
      VescFaultCoordinator.shared.onChange = { [weak self] boardId, faults in
        self?.sendVescFaults(boardId, faults)
      }
      BoardWarningRegistry.shared.onChange = { [weak self] boardId, warnings in
        self?.sendBoardWarnings(boardId, warnings)
      }
      BoardConfigStore.onNoticeChanged = { [weak self] notice in self?.sendEvent("onBoardConfigChangeNotice", ["notice": notice?.toMap()]) }
      MaintenanceRunner.shared.onChange = { [weak self] state in self?.emitMaintenanceState(state) }
      MaintenanceRunner.shared.start()
    }

    OnAppEntersForeground {
      self.frontendActive = true
      self.coordinator.appVisible = true
      AppStatusCoordinator.shared.refresh()
      ServiceConfigCoordinator.shared.refresh()
      Task { await RiderStatsSender.shared.foreground() }
      self.emitMaintenanceState(MaintenanceRunner.shared.snapshot())
      self.emitRideNotices(RideNotices.shared.current)
      RideNotices.shared.expireNow()
    }
    OnAppEntersBackground {
      self.frontendActive = false
      self.coordinator.appVisible = false
    }

    OnDestroy {
      RecordingStorageFailure.observeOutage(nil)
      // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
      self.detachFromCoordinator()
      AppDataRepository.onDataChanged = nil
      MaintenanceRunner.shared.onChange = nil
      BoardWarningRegistry.shared.onChange = nil
      VescFaultCoordinator.shared.onChange = nil
      BoardConfigStore.onNoticeChanged = nil
      self.appStatusUnsubscribe?()
      self.appStatusUnsubscribe = nil
      self.serviceConfigUnsubscribe?()
      self.serviceConfigUnsubscribe = nil
      self.rideNoticesUnsubscribe?()
      self.rideNoticesUnsubscribe = nil
      NavigationController.shared.onChange = nil
      NavigationController.shared.onProgressChange = nil
      self.frontendActive = false
      self.observedEvents.removeAll()
      self.cancelActiveProbe(reason: "module_destroyed")
      self.stopAlertTest()
      AccessoryDiscovery.shared.emit = nil
      AccessoryDiscovery.shared.stopScan()
      AccessoryDiscovery.shared.cancelInspection()
      AccessorySessionController.shared.emit = nil
      AccessorySessionController.shared.releasePreviews()
    }

    Function("scan") {
      self.coordinator.scan()
    }

    Function("stopScan") {
      self.coordinator.stopScan()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startAccessoryScan`
    // @parity /modules/vescape-core/src/index.ts `startAccessoryScan`
    Function("startAccessoryScan") {
      AccessoryDiscovery.shared.startScan()
    }

    Function("stopAccessoryScan") {
      AccessoryDiscovery.shared.stopScan()
    }

    Function("cancelAccessoryInspection") {
      AccessoryDiscovery.shared.cancelInspection()
    }

    AsyncFunction("inspectAccessory") { (deviceId: String, promise: Promise) in
      AccessoryDiscovery.shared.inspect(deviceId: deviceId) { promise.resolve($0) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `enrollAccessory`
    // @parity /modules/vescape-core/src/index.ts `enrollAccessory`
    AsyncFunction("enrollAccessory") { (deviceId: String, promise: Promise) in
      AccessorySessionController.shared.enroll(deviceId: deviceId) { promise.resolve($0) }
    }

    AsyncFunction("forgetAccessory") { (accessoryId: String, promise: Promise) in
      AccessorySessionController.shared.forget(accessoryId: accessoryId) { promise.resolve($0) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `saveBrakeLightSettings`
    // @parity /modules/vescape-core/src/index.ts `saveBrakeLightSettings`
    AsyncFunction("saveBrakeLightSettings") { (accessoryId: String, capabilityId: String, sensitivity: Int, parked: String, promise: Promise) in
      AccessorySessionController.shared.saveBrakeLight(accessoryId: accessoryId, capabilityId: capabilityId, sensitivity: sensitivity, parked: parked) { promise.resolve($0) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setAccessoryCapabilityEnabled`
    // @parity /modules/vescape-core/src/index.ts `setAccessoryCapabilityEnabled`
    AsyncFunction("setAccessoryCapabilityEnabled") { (accessoryId: String, capabilityId: String, enabled: Bool, promise: Promise) in
      AccessorySessionController.shared.setCapabilityEnabled(accessoryId: accessoryId, capabilityId: capabilityId, enabled: enabled) { promise.resolve($0) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setAccessorySamplingRate`
    // @parity /modules/vescape-core/src/index.ts `setAccessorySamplingRate`
    AsyncFunction("setAccessorySamplingRate") { (accessoryId: String, capabilityId: String, rateHz: Double, promise: Promise) in
      AccessorySessionController.shared.setSamplingRate(accessoryId: accessoryId, capabilityId: capabilityId, rateHz: rateHz) { promise.resolve($0) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setBrakeLightPreview`
    // @parity /modules/vescape-core/src/index.ts `setBrakeLightPreview`
    AsyncFunction("setBrakeLightPreview") { (accessoryId: String, capabilityId: String, mode: String?, promise: Promise) in
      AccessorySessionController.shared.setLightPreview(accessoryId: accessoryId, capabilityId: capabilityId, mode: mode) { promise.resolve($0) }
    }
    Function("getAccessories") {
      AccessorySessionController.shared.snapshot()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setAccessoryPreview`
    // @parity /modules/vescape-core/src/index.ts `setAccessoryPreview`
    Function("setAccessoryPreview") { (accessoryId: String, capabilityId: String, open: Bool) in
      AccessorySessionController.shared.setPreview(
        accessoryId: accessoryId, capabilityId: capabilityId, open: open)
    }

    AsyncFunction("saveGroundClearanceCalibration") {
      (
        accessoryId: String, capabilityId: String, nearCm: Double, farCm: Double, direction: String,
        strengthPercent: Int, promise: Promise
      ) in
      AccessorySessionController.shared.saveGroundClearance(
        accessoryId: accessoryId, capabilityId: capabilityId, nearCm: nearCm, farCm: farCm,
        direction: direction, strengthPercent: strengthPercent) { promise.resolve($0) }
    }

    AsyncFunction("clearGroundClearanceCalibration") {
      (accessoryId: String, capabilityId: String, promise: Promise) in
      AccessorySessionController.shared.clearGroundClearance(
        accessoryId: accessoryId, capabilityId: capabilityId) { promise.resolve($0) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `refreshLocationDemand`
    Function("refreshLocationDemand") {
      DispatchQueue.main.async { self.coordinator.refreshGpsDemand() }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exitApp`
    // @platform-diff iOS cannot terminate its own process; graceful shutdown instead of kill.
    Function("exitApp") {
      self.coordinator.stopBoard()
      self.coordinator.stopLocationUpdates()
      self.coordinator.stopScan()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startGroupRideObserve`

    Function("startGroupRideObserve") { (serverUrl: String) in
      self.coordinator.startGroupRideObserve(serverUrl)
    }

    Function("stopGroupRideObserve") {
      self.coordinator.stopGroupRideObserve()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `dismissRideNotice`
    Function("getRideNotices") { () -> [[String: Any?]] in
      RideNotices.shared.current.map { $0.toMap() }
    }
    Function("dismissRideNotice") { (id: Int, rev: Int) in
      RideNotices.shared.dismiss(id: id, rev: rev)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `devPostRideNotice`
    // @parity /modules/vescape-core/src/index.ts `DevRideNoticeParams`
    Function("devPostRideNotice") { (notice: [String: Any]) in
      guard
        let severity = RideNoticeSeverity(rawValue: notice["severity"] as? String ?? ""),
        let key = notice["key"] as? String,
        let title = notice["title"] as? String,
        let details = notice["details"] as? String,
        let postedAt = (notice["postedAt"] as? NSNumber)?.int64Value,
        let revision = notice["revision"] as? String
      else {
        throw NSError(domain: "VescapeCore", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid Ride Notice"])
      }
      let lat = (notice["lat"] as? NSNumber)?.doubleValue
      let lng = (notice["lng"] as? NSNumber)?.doubleValue
      RideNotices.shared.post(
        key: key,
        content: RideNoticeContent(
          severity: severity,
          title: title,
          details: details,
          postedAt: postedAt,
          location: lat.flatMap { lat in lng.map { RideNoticeLocation(lat: lat, lng: $0) } },
          expiresAt: (notice["expiresAt"] as? NSNumber)?.int64Value
        ),
        revision: revision
      )
    }
    Function("devClearRideNotice") { (key: String) in
      RideNotices.shared.clear(key: key)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `sendGroupRideSignal`
    Function("sendGroupRideSignal") { (kind: String) in
      self.coordinator.sendGroupRideSignal(kind)
    }

    Function("clearGroupRideSignal") {
      self.coordinator.clearGroupRideSignal()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `sendGroupRideHazard`
    Function("sendGroupRideHazard") { (kind: String) in
      self.coordinator.sendGroupRideHazard(kind)
    }

    Function("clearGroupRideHazard") {
      self.coordinator.clearGroupRideHazard()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setPublicRide`
    Function("setPublicRide") { (on: Bool, until: Double?) in
      self.coordinator.setPublicRide(on: on, until: until.map { Int64($0) })
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setManualPublicRideSharing`
    // @parity /modules/vescape-core/src/index.ts `setManualPublicRideSharing`
    Function("setManualPublicRideSharing") { (enabled: Bool) in
      self.coordinator.setManualPublicRideSharing(enabled)
    }

    Function("watchPublicRiders") {
      self.coordinator.watchPublicRiders()
    }

    Function("stopWatchingPublicRiders") {
      self.coordinator.stopWatchingPublicRiders()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setTelemetryRecordingEnabled`
    Function("setTelemetryRecordingEnabled") { (enabled: Bool) in
      _ = self.coordinator.setTelemetryRecordingEnabled(enabled)
    }

    Function("reloadAlertRules") {
      self.coordinator.reloadAlertRules()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setBmsSeriesFocused`
    Function("setBmsSeriesFocused") { (focused: Bool) in
      self.coordinator.setBmsSeriesFocused(focused)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setFocusedSeriesMetrics`
    Function("setFocusedSeriesMetrics") { (metrics: [String]) in
      self.coordinator.setFocusedSeriesMetrics(metrics)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setLiveSeriesMetrics`
    Function("setLiveSeriesMetrics") { (metrics: [String]) in
      self.coordinator.setLiveSeriesMetrics(metrics)
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

    Function("previewAlertSound") { (spec: String) in
      self.coordinator.previewAlertSound(spec)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `previewWeatherAlert`
    // @parity /modules/vescape-core/src/index.ts `previewWeatherAlert`
    Function("previewWeatherAlert") { (kind: String, leadMinutes: Int, percent: Int?) in
      guard let line = WeatherAlertLine.preview(kind: kind, leadMinutes: leadMinutes, percent: percent) else { return }
      self.coordinator.previewWeatherAlert(line)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `playPackSound`
    Function("playPackSound") { (pack: String, slot: String) in
      self.coordinator.playPackSound(pack: pack, slot: slot)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `mySounds`
    AsyncFunction("mySounds") { MySounds.state() }
    AsyncFunction("importMySound") { (uri: String, name: String) in try MySounds.import(uri: uri, name: name) }
    AsyncFunction("renameMySound") { (id: String, name: String) in try MySounds.rename(id, name: name) }
    AsyncFunction("deleteMySound") { (id: String) in try MySounds.delete(id) }
    AsyncFunction("setSoundOverride") { (slot: String, id: String?) in try MySounds.setOverride(slot, id: id) }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `mapTile`
    AsyncFunction("mapTile") { (z: Int, x: Int, y: Int) async -> String? in
      await MapTiles.shared.tile(z: z, x: x, y: y)?.absoluteString
    }
    Function("getAlertSounds") {
      self.alertPresets
    }

    Function("startGeigerSimulation") { (spec: String, rangeDepth: Double) in
      self.coordinator.startGeigerSimulation(spec: spec, rangeDepth: rangeDepth)
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
        [controlId: controlId == "battery" ? 48.0 : value],
        batteryPercent: controlId == "battery" ? value : nil,
        onDiagnostic: { _, _ in }
      )
    }

    Function("stopAlertTest") {
      self.stopAlertTest()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getAppStatus`
    Function("getAppStatus") { () -> [String: Any?]? in
      AppStatusCoordinator.shared.current?.toMap()
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getServiceConfig`
    Function("getServiceConfig") { () -> [String: Any?] in
      ServiceConfigCoordinator.shared.current.toMap()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getWeather`
    Function("getWeather") { () -> [String: Any?]? in
      WeatherCoordinator.shared.current?.map
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getWeatherAlertThresholds`
    Function("getWeatherAlertThresholds") { () -> [String: [String: Double]] in
      Dictionary(uniqueKeysWithValues: WeatherAlertLevel.allCases.map {
        ($0.rawValue, ["gustKmh": $0.wind.minGustKmh, "rainPercent": Double($0.rain.minProbabilityPercent)])
      })
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
    Function("getDeviceCredentialState") { () throws -> [String: Any?] in
      try NativeAuthCoordinator.shared.stateMap()
    }
    AsyncFunction("revokeDeviceCredential") { () async throws in
      try await NativeAuthCoordinator.shared.revoke()
    }
    Function("clearDeviceCredential") {
      try NativeAuthCoordinator.shared.clear()
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `openAppUpdate`
    // @platform-diff iOS uses the stable iOS download route.
    // @parity /modules/vescape-core/src/index.ts `openAppUpdate`
    Function("openAppUpdate") {
      guard let url = URL(string: AppStatusCoordinator.iosDownloadUrl) else { return }
      DispatchQueue.main.async {
        UIApplication.shared.open(url)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getPhoneBatteryLevel`
    // @parity /modules/vescape-core/src/index.ts `getPhoneBatteryLevel`
    AsyncFunction("getPhoneBatteryLevel") { () -> Double? in
      self.coordinator.readPhoneBattery()
    }.runOnQueue(.main)

    Function("getLiveState") {
      self.liveState(includeRecent: true)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getGroundClearanceTilt`
    // @parity /modules/vescape-core/src/index.ts `getGroundClearanceTilt`
    AsyncFunction("getGroundClearanceTilt") { () -> [String: Any?] in
      self.coordinator.groundClearanceTiltState()
    }.runOnQueue(.main)
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRemoteTiltState`
    // @parity /modules/vescape-core/src/index.ts `getRemoteTiltState`
    AsyncFunction("getRemoteTiltState") { () -> [String: Any?]? in
      self.coordinator.remoteTiltState()
    }.runOnQueue(.main)

    Function("setSelectedBoard") { (boardId: String?) in
      do {
        try self.appData.updateSetting("selectedBoardId", rawValue: boardId)
        self.clearManualDisconnectAutoStartGate()
        self.selectedBoardId = boardId
        self.coordinator.pushWatchLastBattery()
      } catch {
        RecordingStorageFailure.report(operation: "setting_save", category: "write_failed", error: error)
        throw error
      }
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
        UnexpectedNativeError.report(operation: "debug_recording_list", category: "file_metadata_failed", error: error)
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
        UnexpectedNativeError.report(operation: "debug_recording_export", category: "file_copy_failed", error: error)
        promise.reject("ERR_EXPORT_DEBUG_RECORDING", error.localizedDescription)
      }
    }

    AsyncFunction("deleteDebugRecording") { (name: String, promise: Promise) in
      do {
        try DebugRecordingStore().delete(name: name)
        promise.resolve(nil)
      } catch {
        UnexpectedNativeError.report(operation: "debug_recording_delete", category: "file_delete_failed", error: error)
        promise.reject("ERR_DELETE_DEBUG_RECORDING", error.localizedDescription)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startDebugReplay`
    // @parity /modules/vescape-core/src/index.ts `DebugReplayOptions`
    AsyncFunction("startDebugReplay") { (name: String, options: [String: Any]?, promise: Promise) in
      self.coordinator.startReplay(
        recordingName: name,
        warmupMs: (options?["warmupMs"] as? NSNumber)?.int64Value ?? 0,
        loop: (options?["loop"] as? Bool) ?? false,
        onSuccess: { promise.resolve(nil) },
        onError: { code, message in promise.reject(code, message) }
      )
    }.runOnQueue(.main)

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setWatchRouteSpanM`
    Function("setWatchRouteSpanM") { (spanM: Double?) in
      WatchRouteMirror.shared.viewportSpanM = spanM
    }

    AsyncFunction("stopDebugReplay") { (promise: Promise) in
      self.coordinator.stopBoard()
      promise.resolve(nil)
    }
    Function("getDebugReplayState") { self.debugReplayStateMap { _ in } }
    Function("setDebugReplayPaused") { (paused: Bool) in self.debugReplayStateMap { $0.setPaused(paused) } }
    Function("setDebugReplayLoop") { (loop: Bool) in self.debugReplayStateMap { $0.setLoop(loop) } }
    Function("dropDebugReplayLink") { self.debugReplayStateMap { $0.dropLink() } }

    AsyncFunction("selectBoard") { (boardId: String, promise: Promise) in
      do {
        try self.appData.updateSetting("selectedBoardId", rawValue: boardId)
        self.clearManualDisconnectAutoStartGate()
        self.selectedBoardId = boardId
        self.coordinator.pushWatchLastBattery()
      } catch {
        RecordingStorageFailure.report(operation: "setting_save", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not select Board")
        return
      }
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
      Task { @MainActor in
        await BoardSessionCommands.stopRide()
        promise.resolve(nil)
      }
    }

    AsyncFunction("probeBoardLink") { (bleId: String, probeId: String, promise: Promise) in
      DispatchQueue.main.async { self.startProbe(bleId: bleId, probeId: probeId, promise: promise) }
    }

    AsyncFunction("finalizeBoardLink") {
      (probeId: String, boardId: String, bleId: String, candidate: [String: Any?], promise: Promise) in
      DispatchQueue.main.async {
        self.finalizeBoardLink(probeId: probeId, boardId: boardId, bleId: bleId, rawCandidate: candidate, promise: promise)
      }
    }

    Function("cancelBoardProbe") { (probeId: String) in
      DispatchQueue.main.async { self.cancelActiveProbe(probeId: probeId, reason: "js_cancelled") }
    }

    AsyncFunction("getTelemetryHistory") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getHistory(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_buckets_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride history", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRideHistoryPage`
    AsyncFunction("getRideHistoryPage") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try RideHistoryRepository.shared.getPage(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_page_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride history", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `countRideHistory`
    AsyncFunction("countRideHistory") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try RideHistoryRepository.shared.countRides(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_count_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not count ride history", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRideSession`
    AsyncFunction("getRideSession") { (id: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try RideHistoryRepository.shared.getSession(id)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_session_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride", cause: error)
      }
    }

    AsyncFunction("getTelemetrySamples") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getSamples(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_samples_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride history", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideGpx`
    // @parity /modules/vescape-core/src/index.ts `exportRideGpx`
    AsyncFunction("exportRideGpx") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.exportRideGpx(options)) }
      catch { promise.reject("ERR_RIDE_EXPORT", "Could not export ride", cause: error) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideCsv`
    // @parity /modules/vescape-core/src/index.ts `exportRideCsv`
    AsyncFunction("exportRideCsv") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.exportRideCsv(options)) }
      catch { promise.reject("ERR_RIDE_EXPORT", "Could not export ride", cause: error) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideFloaty`
    // @parity /modules/vescape-core/src/index.ts `exportRideFloaty`
    AsyncFunction("exportRideFloaty") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.exportRideFloaty(options)) }
      catch { promise.reject("ERR_RIDE_EXPORT", "Could not export ride", cause: error) }
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `registerRideBatch`
    /// @parity /modules/vescape-core/src/index.ts `exportRides`
    AsyncFunction("exportRides") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      self.rideExportCancelled.withLock { $0 = false }
      do {
        let rides = try RideHistoryRepository.shared.selectedRides(options["selection"] as? [String: Any] ?? [:])
        let file = try TelemetryRepository.shared.exportRides(rides, format: try RideBatch.format(options["format"]),
          isCancelled: { self.rideExportCancelled.withLock { $0 } }) { done, total in
          self.sendEvent("onRideExportProgress", ["done": done, "total": total])
        }
        promise.resolve(file)
      } catch RideBatch.RideBatchError.cancelled {
        promise.resolve(nil)
      } catch { promise.reject("ERR_RIDE_EXPORT", "Could not export rides", cause: error) }
    }

    Function("cancelRideExport") { self.rideExportCancelled.withLock { $0 = true } }

    AsyncFunction("deleteRides") { (selection: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.deleteRides(try RideHistoryRepository.shared.selectedRides(selection))) }
      catch { RecordingStorageFailure.report(operation: "ride_delete", category: "write_failed", error: error); promise.reject("ERR_RIDE_DELETE", "Could not delete rides", cause: error) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportLiveTelemetryCsv`
    // @parity /modules/vescape-core/src/index.ts `exportLiveTelemetryCsv`
    AsyncFunction("exportLiveTelemetryCsv") { (promise: Promise) in
      do {
        promise.resolve(try RideExport.liveCsv(self.coordinator.recentTelemetry(),
          directory: FileManager.default.temporaryDirectory))
      } catch {
        promise.reject("ERR_LIVE_EXPORT", "Could not export live telemetry", cause: error)
      }
    }

    AsyncFunction("getHistoryRange") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getRange(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_range_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride history", cause: error)
      }
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
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getDiagnosticEvents(options)) }
      catch { RecordingStorageFailure.reportRead(operation: "diagnostic_events_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read Diagnostic Events", cause: error) }
    }

    AsyncFunction("clearDiagnosticEvents") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try TelemetryRepository.shared.clearDiagnosticEvents(); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "diagnostic_events_clear", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not clear Diagnostic Events", cause: error) }
    }

    AsyncFunction("getBoardWarnings") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try BoardWarningRegistry.shared.allWarnings().map { $0.toMap() }) }
      catch { RecordingStorageFailure.reportRead(operation: "board_warnings_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read Board Warnings", cause: error) }
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getVescFaults`
    /// @parity /modules/vescape-core/src/index.ts `getVescFaults`
    AsyncFunction("getVescFaults") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try VescFaultCoordinator.shared.allFaults().map { $0.toMap() }) }
      catch { RecordingStorageFailure.reportRead(operation: "vesc_faults_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read VESC Faults", cause: error) }
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setVescFaultDismissed`
    /// @parity /modules/vescape-core/src/index.ts `setVescFaultDismissed`
    AsyncFunction("setVescFaultDismissed") { (id: String, dismissed: Bool, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try VescFaultCoordinator.shared.setDismissed(id: id, dismissed: dismissed); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "vesc_fault_dismiss", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not update VESC Fault", cause: error) }
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getVescFaultCapture`
    /// @parity /modules/vescape-core/src/index.ts `getVescFaultCapture`
    AsyncFunction("getVescFaultCapture") { (occurrenceId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        let captures = VescFaultCaptureCoordinator.shared
        guard let capture = try captures.capture(occurrenceId) else { promise.resolve(nil); return }
        var payload = capture.toMap()
        payload["samples"] = try captures.samples(occurrenceId).map { $0.toMap() }
        promise.resolve(payload)
      } catch {
        RecordingStorageFailure.reportRead(operation: "vesc_fault_capture_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read VESC Fault Capture", cause: error)
      }
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `readVescFaultLog`
    /// @parity /modules/vescape-core/src/index.ts `readVescFaultLog`
    AsyncFunction("readVescFaultLog") { (boardId: String, promise: Promise) in
      DispatchQueue.main.async {
        self.coordinator.readVescFaultLog(
          boardId: boardId,
          onSuccess: { promise.resolve($0) },
          onError: { promise.reject($0, $1) }
        )
      }
    }

    AsyncFunction("clearBoardWarning") { (boardId: String, kind: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try BoardWarningRegistry.shared.clearWarning(boardId: boardId, kind: kind); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "board_warning_clear", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not clear Board Warning", cause: error) }
    }

    AsyncFunction("clearAllBoardWarnings") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try BoardWarningRegistry.shared.clearAllWarnings(boardId: boardId); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "board_warnings_clear", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not clear Board Warnings", cause: error) }
    }

    AsyncFunction("devInjectBoardWarning") { (boardId: String, kind: String, severity: String, payloadJson: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      BoardWarningRegistry.shared.reportFinding(
        boardId: boardId,
        kind: kind,
        severity: BoardWarningRegistry.Severity.fromWire(severity),
        payloadJson: payloadJson
      )
      promise.resolve(nil)
    }

    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getBoardConfigValues`
    /// @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
    AsyncFunction("getBoardConfigValues") { (promise: Promise) in
      promise.resolve(self.coordinator.boardConfigValuesMap())
    }
    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getLastKnownBoardConfigValues`
    /// @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
    AsyncFunction("getLastKnownBoardConfigValues") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try BoardConfigStore.shared.loadLatest(boardId: boardId)?.toBridgeMap()) }
      catch { RecordingStorageFailure.reportRead(operation: "board_config_latest_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read cached Board Config", cause: error) }
    }
    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getMotorConfigValues`
    /// @parity /modules/vescape-core/src/index.ts `MotorConfigValues`
    AsyncFunction("getMotorConfigValues") { (promise: Promise) in
      promise.resolve(self.coordinator.motorConfigValuesMap())
    }
    /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getLastKnownMotorConfigValues`
    /// @parity /modules/vescape-core/src/index.ts `MotorConfigValues`
    AsyncFunction("getLastKnownMotorConfigValues") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try MotorConfigStore.shared.loadLatest(boardId: boardId)?.toBridgeMap()) }
      catch { RecordingStorageFailure.reportRead(operation: "motor_config_latest_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read cached Motor Config", cause: error) }
    }
    AsyncFunction("getBoardConfigChangeNotice") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try BoardConfigStore.shared.loadNotice(boardId: boardId)?.toMap()) }
      catch { RecordingStorageFailure.reportRead(operation: "board_config_notice_read", error: error); promise.reject("APP_STORAGE_READ_FAILED", "Could not read Board Config Change Notice", cause: error) }
    }
    AsyncFunction("dismissBoardConfigChangeNotice") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try BoardConfigStore.shared.dismissNotice(boardId: boardId); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "board_config_notice_delete", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not dismiss Board Config Change Notice", cause: error) }
    }

    AsyncFunction("devReportCleanBoardWarning") { (boardId: String, kind: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: kind)
      promise.resolve(nil)
    }

    AsyncFunction("getTelemetrySummary") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getSummary()) }
      catch {
        RecordingStorageFailure.reportRead(operation: "history_summary_read", error: error)
        promise.reject("ERR_HISTORY_READ", "Could not load ride history", cause: error)
      }
    }

    AsyncFunction("getDatabaseSizeBytes") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(Int(try VescapeDatabase.databaseSizeBytes())) }
      catch {
        RecordingStorageFailure.reportRead(operation: "database_size_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read database size", cause: error)
      }
    }

    AsyncFunction("backupDatabase") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try DatabaseBackupManager.createBackup())
        } catch {
          promise.reject("ERR_BACKUP_DATABASE", error.localizedDescription)
        }
      }
    }

    // idle before the async restore runs. @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `stopNativeWorkForDatabaseRestore`
    AsyncFunction("restoreDatabase") { (uri: String, promise: Promise) in
      self.coordinator.stopScan()
      self.coordinator.stopBoard()
      self.coordinator.stopLocationUpdates()
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          defer { MaintenanceRunner.shared.onDatabaseReplaced() }
          try DatabaseBackupManager.restoreBackup(uriString: uri)
          self.coordinator.pushWatchLastBattery()
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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `setRemoteTilt`
    AsyncFunction("setRemoteTilt") { (value: Int) -> Bool in
      self.coordinator.setRemoteTilt(value: value)
    }.runOnQueue(.main)

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `lockRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `lockRemoteTilt`
    AsyncFunction("lockRemoteTilt") { (value: Int) -> Bool in
      self.coordinator.lockRemoteTilt(value: value)
    }.runOnQueue(.main)

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `releaseRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `releaseRemoteTilt`
    AsyncFunction("releaseRemoteTilt") { (value: Int, durationMs: Int) -> Bool in
      self.coordinator.releaseRemoteTilt(value: value, durationMs: Int64(durationMs))
    }.runOnQueue(.main)

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `stopRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `stopRemoteTilt`
    AsyncFunction("stopRemoteTilt") { () -> Bool in
      self.coordinator.stopRemoteTilt()
    }.runOnQueue(.main)

    AsyncFunction("setBoardLights") { (enabled: Bool, headlightsEnabled: Bool) -> Bool in
      self.coordinator.setBoardLights(enabled: enabled, headlightsEnabled: headlightsEnabled)
    }

    AsyncFunction("startBoardMove") { (input: Int) -> Bool in
      self.coordinator.startBoardMove(input: input)
    }

    AsyncFunction("stopBoardMove") { () -> Bool in
      self.coordinator.stopBoardMove()
    }

    AsyncFunction("getTuneProfiles") { (boardId: String, refloatBaseVersion: String?, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TuneProfileStore.shared.getTuneProfiles(boardId, refloatBaseVersion: refloatBaseVersion)) }
      catch { RecordingStorageFailure.reportRead(operation: "tune_profiles_read", error: error); promise.reject(TuneProfileStore.errorCode, error.localizedDescription) }
    }

    AsyncFunction("getTuneProfile") { (profileId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TuneProfileStore.shared.getTuneProfile(profileId)) }
      catch { RecordingStorageFailure.reportRead(operation: "tune_profile_read", error: error); promise.reject(TuneProfileStore.errorCode, error.localizedDescription) }
    }

    AsyncFunction("createProfile") { (boardId: String, name: String, icon: String, color: String, fields: [String: Any], refloatBaseVersion: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(try TuneProfileStore.shared.createProfile(boardId: boardId, name: name, icon: icon, color: color, fields: fields, refloatBaseVersion: refloatBaseVersion))
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_create", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("renameProfile") { (profileId: String, name: String, icon: String, color: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(try TuneProfileStore.shared.renameProfile(profileId: profileId, name: name, icon: icon, color: color))
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_rename", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("deleteProfile") { (profileId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        try TuneProfileStore.shared.deleteProfile(profileId: profileId)
        promise.resolve(nil)
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_delete", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("getProfileHistory") { (profileId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TuneProfileStore.shared.getProfileHistory(profileId)) }
      catch { RecordingStorageFailure.reportRead(operation: "tune_history_read", error: error); promise.reject(TuneProfileStore.errorCode, error.localizedDescription) }
    }

    AsyncFunction("rollbackProfile") { (profileId: String, historyEntryId: Double, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(
          try TuneProfileStore.shared.rollbackProfile(profileId: profileId, historyEntryId: Int64(historyEntryId))
        )
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_rollback", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("copyProfileToBoard") { (profileId: String, targetBoardId: String, newName: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(
          try TuneProfileStore.shared.copyProfileToBoard(
            profileId: profileId,
            targetBoardId: targetBoardId,
            newName: newName
          )
        )
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_copy", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    AsyncFunction("saveProfile") { (profileId: String, fields: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(try TuneProfileStore.shared.saveProfile(profileId: profileId, fields: fields))
      } catch {
        reportTunePersistenceWrite(operation: "tune_profile_save", error: error)
        promise.reject(TuneProfileStore.errorCode, error.localizedDescription)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `pushProfileToBoard`
    AsyncFunction("pushProfileToBoard") { (profileId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      self.coordinator.pushProfileToBoard(
        profileId: profileId,
        onSuccess: { snapshot in promise.resolve(snapshot) },
        onError: { code, message in promise.reject(code, message) }
      )
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getProfileStatsSnapshot`
    AsyncFunction("getProfileStatsSnapshot") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try ProfileStatsRepository.shared.getProfileStatsSnapshot(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "profile_stats_read", error: error)
        promise.reject("ERR_PROFILE_STATS_READ", "Could not load profile stats", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getDayStats`
    AsyncFunction("getDayStats") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try ProfileStatsRepository.shared.getDayStats(options)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "day_stats_read", error: error)
        promise.reject("ERR_PROFILE_STATS_READ", "Could not load day stats", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRecentRideStats`
    AsyncFunction("getRecentRideStats") { (sinceMs: Double, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try ProfileStatsRepository.shared.getRecentRideStats(sinceMs: Int64(sinceMs))) }
      catch {
        RecordingStorageFailure.reportRead(operation: "recent_stats_read", error: error)
        promise.reject("ERR_PROFILE_STATS_READ", "Could not load recent ride stats", cause: error)
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFavorites`
    AsyncFunction("getFavorites") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getFavorites()) }
      catch {
        RecordingStorageFailure.reportRead(operation: "favorites_read", error: error)
        promise.reject("ERR_FAVORITES_READ", "Could not load Favorites", cause: error)
      }
    }

    AsyncFunction("createFavorite") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        guard let favorite = try TelemetryRepository.shared.createFavorite(options) else {
          promise.reject("ERR_CREATE_FAVORITE", "favorite range is invalid")
          return
        }
        promise.resolve(favorite)
      } catch {
        RecordingStorageFailure.report(operation: "favorite_create", category: "write_failed", error: error)
        promise.reject("ERR_CREATE_FAVORITE", "Favorite could not be stored", cause: error)
      }
    }

    AsyncFunction("updateFavorite") { (id: String, options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        guard let favorite = try TelemetryRepository.shared.updateFavorite(id, options: options) else {
          promise.reject("ERR_UPDATE_FAVORITE", "Favorite does not exist or range is invalid")
          return
        }
        promise.resolve(favorite)
      } catch {
        RecordingStorageFailure.report(operation: "favorite_update", category: "write_failed", error: error)
        promise.reject("ERR_UPDATE_FAVORITE", "Favorite could not be stored", cause: error)
      }
    }

    AsyncFunction("deleteFavorite") { (id: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        guard try TelemetryRepository.shared.deleteFavorite(id) else {
          promise.reject("ERR_DELETE_FAVORITE", "Favorite does not exist")
          return
        }
        promise.resolve(true)
      } catch let error as FavoriteMediaStoreError where error == .cleanupFailed {
        // @parity /src/modules/history/store/favoriteStore.ts `FAVORITE_MEDIA_CLEANUP_ERROR`
        UnexpectedNativeError.report(
          operation: "favorite_media_delete", category: "file_delete_failed", error: error
        )
        promise.reject("ERR_DELETE_FAVORITE_MEDIA_CLEANUP", "Favorite deleted but its media could not be removed", cause: error)
      } catch {
        RecordingStorageFailure.report(operation: "favorite_delete", category: "write_failed", error: error)
        promise.reject("ERR_DELETE_FAVORITE", "Favorite could not be deleted", cause: error)
      }
    }

    AsyncFunction("getFavoriteMedia") { (favoriteId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.getFavoriteMedia(favoriteId)) }
      catch {
        RecordingStorageFailure.reportRead(operation: "favorite_media_read", error: error)
        promise.reject("ERR_FAVORITE_MEDIA_READ", "Could not load Favorite Media", cause: error)
      }
    }

    AsyncFunction("importFavoriteMedia") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        promise.resolve(try TelemetryRepository.shared.importFavoriteMedia(options))
      } catch {
        RecordingStorageFailure.report(operation: "favorite_media_import", category: "write_failed", error: error)
        promise.reject("ERR_IMPORT_FAVORITE_MEDIA", error.localizedDescription)
      }
    }

    AsyncFunction("deleteTelemetryBefore") { (beforeMs: Double, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.deleteBefore(Int64(beforeMs))) }
      catch { RecordingStorageFailure.report(operation: "telemetry_prune", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not prune telemetry", cause: error) }
    }

    AsyncFunction("deleteTelemetryRange") { (options: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try TelemetryRepository.shared.deleteRange(options)) }
      catch { RecordingStorageFailure.report(operation: "telemetry_range_delete", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not delete telemetry", cause: error) }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getMaintenanceState`
    // @parity /modules/vescape-core/src/index.ts `getMaintenanceState`
    Function("getMaintenanceState") { () -> [String: Any?] in MaintenanceRunner.shared.snapshot() }

    AsyncFunction("clearTelemetryHistory") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      defer { MaintenanceRunner.shared.onDatabaseReplaced() }
      do { try TelemetryRepository.shared.clearAll(); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "telemetry_clear", category: "write_failed", error: error); promise.reject("APP_STORAGE_WRITE_FAILED", "Could not clear telemetry", cause: error) }
    }

    AsyncFunction("getBoards") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try self.appData.getBoards()) }
      catch {
        RecordingStorageFailure.reportRead(operation: "boards_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read Boards")
      }
    }

    AsyncFunction("upsertBoard") { (board: [String: Any], initialAlerts: [String: Any]?, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        try self.appData.upsertBoard(board, initialAlerts: initialAlerts)
        self.coordinator.pushWatchLastBattery()
        self.coordinator.reloadAlertRules()
        self.coordinator.reloadBoardDataForActiveBoard()
        self.connectSavedBoardLink(boardId: board["id"] as? String)
        promise.resolve(nil)
      } catch {
        RecordingStorageFailure.report(operation: "board_save", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not save Board")
      }
    }

    AsyncFunction("deleteBoard") { (id: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        try self.appData.deleteBoard(id)
        self.coordinator.pushWatchLastBattery()
        promise.resolve(nil)
      } catch {
        RecordingStorageFailure.report(operation: "board_delete", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not delete Board")
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `previewAlertPreset`
    // @parity /modules/vescape-core/src/index.ts `previewAlertPreset`
    Function("previewAlertPreset") { (metric: String, spec: String, topSpeedKmh: Double, hasBatteryConfig: Bool, distanceUnit: String) -> [[String: Any?]] in
      try AlertPresetPersistence.preview(
        metric: metric,
        spec: spec,
        topSpeedKmh: topSpeedKmh,
        hasBatteryConfig: hasBatteryConfig,
        distanceUnit: distanceUnit
      ).map { rule in
        [
          "id": rule.id,
          "controlId": rule.controlId,
          "threshold": rule.threshold,
          "thresholdMax": rule.thresholdMax,
          "spec": rule.spec,
          "repeatEverySeconds": rule.repeatEverySeconds,
        ]
      }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `applyAlertPreset`
    // @parity /modules/vescape-core/src/index.ts `applyAlertPreset`
    AsyncFunction("applyAlertPreset") { (boardId: String, metric: String, level: String?, geiger: String?, match: Bool?, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do {
        try self.appData.applyAlertPreset(boardId, metric, level, geiger, match)
        self.coordinator.reloadAlertRules()
        promise.resolve(nil)
      } catch {
        RecordingStorageFailure.report(operation: "alert_preset_apply", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not apply Alert Preset")
      }
    }
    AsyncFunction("getAlertRules") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try self.appData.getAlertRules(boardId)) }
      catch { RecordingStorageFailure.reportRead(operation: "alert_rules_read", error: error); promise.reject("ERR_ALERT_RULES_READ", "Could not load Alert Rules", cause: error) }
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getAlertPresets`
    // @parity /modules/vescape-core/src/index.ts `getAlertPresets`
    AsyncFunction("getAlertPresets") { (boardId: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try self.appData.getAlertPresets(boardId)) }
      catch { RecordingStorageFailure.reportRead(operation: "alert_rules_read", error: error); promise.reject("ERR_ALERT_RULES_READ", "Could not load Alert Presets", cause: error) }
    }

    AsyncFunction("upsertAlertRule") { (rule: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.upsertAlertRule(rule); self.coordinator.reloadAlertRules(); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "alert_rule_save", category: "write_failed", error: error); promise.reject("ERR_ALERT_RULE_WRITE", "Alert Rule could not be stored", cause: error) }
    }

    AsyncFunction("setAlertRuleEnabled") { (boardId: String, id: String, enabled: Bool, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.setAlertRuleEnabled(boardId, id, enabled); self.coordinator.reloadAlertRules(); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "alert_rule_enable", category: "write_failed", error: error); promise.reject("ERR_ALERT_RULE_WRITE", "Alert Rule could not be stored", cause: error) }
    }

    AsyncFunction("deleteAlertRule") { (boardId: String, id: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.deleteAlertRule(boardId, id); self.coordinator.reloadAlertRules(); promise.resolve(nil) }
      catch { RecordingStorageFailure.report(operation: "alert_rule_delete", category: "write_failed", error: error); promise.reject("ERR_ALERT_RULE_WRITE", "Alert Rule could not be deleted", cause: error) }
    }

    AsyncFunction("getPrivacyZones") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try self.appData.getPrivacyZones()) }
      catch { RecordingStorageFailure.reportRead(operation: "privacy_zones_read", error: error); promise.reject("ERR_PRIVACY_ZONE_READ", "Could not load Privacy Zones", cause: error) }
    }

    AsyncFunction("upsertPrivacyZone") { (zone: [String: Any], promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.upsertPrivacyZone(zone) }
      catch { RecordingStorageFailure.report(operation: "privacy_zone_save", category: "write_failed", error: error); promise.reject("ERR_PRIVACY_ZONE_WRITE", "Privacy Zone could not be stored", cause: error); return }
      do { try self.reloadPrivacyZonesIntoRecorder() }
      catch { RecordingStorageFailure.reportRead(operation: "privacy_zones_reload", error: error) }
      promise.resolve(nil)
    }

    AsyncFunction("setPrivacyZoneEnabled") { (id: String, enabled: Bool, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.setPrivacyZoneEnabled(id, enabled) }
      catch { RecordingStorageFailure.report(operation: "privacy_zone_enable", category: "write_failed", error: error); promise.reject("ERR_PRIVACY_ZONE_WRITE", "Privacy Zone could not be updated", cause: error); return }
      do { try self.reloadPrivacyZonesIntoRecorder() }
      catch { RecordingStorageFailure.reportRead(operation: "privacy_zones_reload", error: error) }
      promise.resolve(nil)
    }

    AsyncFunction("deletePrivacyZone") { (id: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.deletePrivacyZone(id) }
      catch { RecordingStorageFailure.report(operation: "privacy_zone_delete", category: "write_failed", error: error); promise.reject("ERR_PRIVACY_ZONE_WRITE", "Privacy Zone could not be deleted", cause: error); return }
      do { try self.reloadPrivacyZonesIntoRecorder() }
      catch { RecordingStorageFailure.reportRead(operation: "privacy_zones_reload", error: error) }
      promise.resolve(nil)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `searchMap`
    AsyncFunction("searchMap") { (query: String, limit: Int, proximity: String?, promise: Promise) in
      Task {
        do { promise.resolve(try await MapSearchApi.shared.search(query: query, limit: limit, proximity: proximity)) }
        catch { Self.rejectMapSearch(promise, error) }
      }
    }
    AsyncFunction("reverseGeocodeMap") { (latitude: Double, longitude: Double, promise: Promise) in
      Task {
        do { promise.resolve(try await MapSearchApi.shared.reverse(latitude: latitude, longitude: longitude)) }
        catch { Self.rejectMapSearch(promise, error) }
      }
    }

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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRiderProfile`
    AsyncFunction("getRiderProfile") { (promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.mine()) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("saveRiderProfile") { (nick: String, nationality: String?, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.save(nick: nick, nationality: nationality)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFriends`
    AsyncFunction("searchRiders") { (nick: String, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.search(nick: nick)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("getRider") { (accountId: String, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.rider(accountId)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("getFriends") { (promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.friends()) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("sendFriendRequest") { (accountId: String, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.requestFriend(accountId)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("acceptFriendRequest") { (accountId: String, promise: Promise) in
      Task {
        do { try await RiderProfileApi.shared.acceptFriend(accountId); promise.resolve(nil) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("deleteFriendRequest") { (accountId: String, promise: Promise) in
      Task {
        do { try await RiderProfileApi.shared.deleteFriendRequest(accountId); promise.resolve(nil) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("removeFriend") { (accountId: String, promise: Promise) in
      Task {
        do { try await RiderProfileApi.shared.removeFriend(accountId); promise.resolve(nil) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRodeWith`
    AsyncFunction("getRodeWith") { (from: String, to: String, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.rodeWith(from: from, to: to)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFriendRides`
    // @parity /modules/vescape-core/src/index.ts `getFriendRides`
    AsyncFunction("getFriendRides") { (accountId: String, limit: Int?, before: String?, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.friendRides(accountId, limit: limit, before: before)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFriendRideTrack`
    AsyncFunction("getFriendRideTrack") { (accountId: String, from: String, to: String, promise: Promise) in
      Task {
        do { promise.resolve(try await RiderProfileApi.shared.friendRideTrack(accountId, from: from, to: to)) }
        catch { Self.rejectRiderProfile(promise, error) }
      }
    }

    AsyncFunction("setDirectionPoint") { (latitude: Double?, longitude: Double?, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { try self.appData.setDirectionPoint(latitude: latitude, longitude: longitude) }
      catch {
        RecordingStorageFailure.report(operation: "direction_point_save", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not save Direction Point", cause: error)
        return
      }
      self.coordinator.loadGroupRideTarget()

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

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `recomputeNavigation`
    // @parity /modules/vescape-core/src/index.ts `recomputeNavigation`
    AsyncFunction("recomputeNavigation") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      self.recomputeNavigation()
      promise.resolve(nil)
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setNavigationProfile`
    // @parity /modules/vescape-core/src/index.ts `setNavigationProfile`
    AsyncFunction("setNavigationProfile") { (profile: String, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      NavigationController.shared.selectProfile(NavigationProfile.fromWire(profile))
      self.recomputeNavigation()
      promise.resolve(nil)
    }

    AsyncFunction("getSettings") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      do { promise.resolve(try self.appData.getSettings()) }
      catch {
        RecordingStorageFailure.reportRead(operation: "settings_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read settings")
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `refreshLegalPolicy`
    // @parity /modules/vescape-core/src/index.ts `refreshLegalPolicy`
    AsyncFunction("refreshLegalPolicy") { (promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      let settings: [String: Any?]
      do { settings = try self.appData.getSettings() }
      catch {
        RecordingStorageFailure.reportRead(operation: "legal_policy_settings_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read settings")
        return
      }
      let latitude = settings["lastGpsLatitude"] as? Double
      let longitude = settings["lastGpsLongitude"] as? Double
      Task {
        let resolution: LegalPolicyResolution = if let latitude, let longitude {
          await self.legalPolicyResolver.resolve(latitude: latitude, longitude: longitude)
        } else {
          .resolved(nil)
        }
        if case .cancelled = resolution {
          promise.reject("LEGAL_POLICY_CANCELLED", "Legal Policy refresh was cancelled")
          return
        }
        guard case .resolved(let countryCode) = resolution else {
          promise.reject("LEGAL_POLICY_UNAVAILABLE", "Could not resolve Legal Policy")
          return
        }
        do {
          try self.appData.updateLegalPolicy(jurisdictionCode: countryCode)
          self.coordinator.reloadAlertRules()
          promise.resolve(nil)
        } catch {
          RecordingStorageFailure.report(operation: "legal_policy_save", category: "write_failed", error: error)
          promise.reject("APP_STORAGE_WRITE_FAILED", "Could not save Legal Policy")
        }
      }
    }

    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setLegalMode`
    // @parity /modules/vescape-core/src/index.ts `setLegalMode`
    AsyncFunction("setLegalMode") { (boardId: String, enabled: Bool, promise: Promise) in
      try RecordingStorageFailure.requireAvailable()
      let board: [String: Any?]?
      do { board = try self.appData.getBoard(boardId) }
      catch {
        RecordingStorageFailure.reportRead(operation: "legal_mode_board_read", error: error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read Board")
        return
      }
      guard board != nil else {
        promise.reject("BOARD_NOT_FOUND", "Board not found: \(boardId)")
        return
      }
      if enabled {
        if let (code, message) = self.coordinator.legalModeEnableError(boardId: boardId) {
          promise.reject(code, message)
          return
        }
        let settings: [String: Any?]
        do { settings = try self.appData.getSettings() }
        catch {
          RecordingStorageFailure.reportRead(operation: "legal_mode_settings_read", error: error)
          promise.reject("APP_STORAGE_READ_FAILED", "Could not read settings")
          return
        }
        let jurisdictionCode =
          ((settings["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
        guard let jurisdictionCode, self.legalPolicyCatalog.speeds(countryCode: jurisdictionCode) != nil else {
          promise.reject("LEGAL_POLICY_UNRESOLVED", "Resolved Legal Policy required")
          return
        }
      }
      do {
        try self.appData.updateLegalMode(boardId: boardId, enabled: enabled)
        self.coordinator.reloadAlertRules()
        promise.resolve(nil)
      } catch {
        RecordingStorageFailure.report(operation: "legal_mode_save", category: "write_failed", error: error)
        promise.reject("APP_STORAGE_WRITE_FAILED", "Could not save Legal Mode")
      }
    }

    Function("updateSetting") { (key: String, value: JavaScriptValue) in
      do { try self.appData.updateSetting(key, rawValue: value.getAny()) }
      catch {
        RecordingStorageFailure.report(operation: "setting_save", category: "write_failed", error: error)
        throw error
      }
      if [
        "distanceUnit",
        "temperatureUnit",
        "liveHistoryLimit",
        "movingSpeedThresholdKmh",
        "avgSpeedCutoffKmh",
        "movingAvgSpeedThresholdKmh",
        "socEstimateWindowSeconds",
        "telemetryPollRateHz",
        "boardWarningsEnabled",
        "vescFaultCollectionEnabled",
        "connectionSoundsEnabled",
        "soundPack",
        "voice",
        "voiceLevel",
        "weatherRainAlertLevel",
        "weatherWindAlertLevel",
      ].contains(key) {
        self.coordinator.reloadTelemetrySettings()
      }
      if key == "navigationRerouteDistanceMeters" {
        NavigationController.shared.reloadRerouteDistance()
      }
      if key == "distanceUnit" { self.coordinator.reloadAlertRules() }
      MaintenanceRunner.shared.onSettingChanged(key)
      // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `updateSetting`
      if key == "distanceUnit" { self.alertTestCoordinator?.distanceUnit = (try self.appData.getSettings())["distanceUnit"] as? String ?? "km" }
      if key == "temperatureUnit" { self.alertTestCoordinator?.temperatureUnit = (try self.appData.getSettings())["temperatureUnit"] as? String ?? "celsius" }
      if watchSourceSettingKeys.contains(key) {
        self.coordinator.reloadWatchSettings()
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `debugReplayStateMap`
  private func debugReplayStateMap(_ control: @escaping (SimulatedBoard) -> Void) -> [String: Any]? {
    let read = { () -> [String: Any]? in
      guard let board = self.coordinator.replayPlayback else { return nil }
      control(board)
      let state = board.state()
      return [
        "recording": state.recording,
        "positionMs": state.positionMs,
        "durationMs": state.durationMs,
        "paused": state.paused,
        "loop": state.loop,
        "linked": state.linked,
      ]
    }
    return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
  }

  private func startAlertTest(_ ruleMaps: [[String: Any]]) {
    stopAlertTest()
    let rules = ruleMaps.compactMap(Self.alertTestRule)
    guard let controlId = rules.first?.controlId else { return }
    guard rules.allSatisfy({ $0.controlId == controlId }) else { return }

    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch { RecordingStorageFailure.reportRead(operation: "alert_test_settings", error: error); return }
    let player = AlertAudioPlayer()
    player.applySoundSettings(settings)
    let coordinator = AlertCoordinator(player: player, vibrateSingles: false)
    coordinator.distanceUnit = settings["distanceUnit"] as? String ?? "km"
    coordinator.temperatureUnit = settings["temperatureUnit"] as? String ?? "celsius"
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
      let spec = value["spec"] as? String
    else { return nil }
    return AlertRule(
      boardId: "alert-test",
      id: id,
      controlId: controlId,
      threshold: threshold,
      thresholdMax: (value["thresholdMax"] as? NSNumber)?.doubleValue,
      enabled: true,
      spec: spec,
      createdAt: 0,
      repeatEverySeconds: normalizedAlertRepeatSeconds((value["repeatEverySeconds"] as? NSNumber)?.doubleValue)
    )
  }

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
        self?.completedProbes[probeId] = result
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
    PendingLinkConnect.clear()
    if let probeId { completedProbes.removeValue(forKey: probeId) }
    guard let activeProbe else { return }
    if let probeId, activeProbe.id != probeId { return }
    self.activeProbe = nil
    activeProbe.detector.cancel(reason: reason)
    activeProbe.promise.reject("PROBE_CANCELLED", "Board Probe cancelled")
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `finalizeBoardLink`
  /// @parity /modules/vescape-core/src/index.ts `finalizeBoardLink`
  private func finalizeBoardLink(
    probeId: String, boardId: String, bleId: String,
    rawCandidate: [String: Any?], promise: Promise
  ) {
    guard let result = completedProbes[probeId] else {
      promise.reject("PROBE_NOT_FOUND", "Board Probe is no longer finalizable")
      return
    }
    guard let transport = BoardTransport.fromBridge(rawCandidate["transport"] ?? nil),
      let candidate = result.candidates.first(where: { $0.transport == transport }) else {
      promise.reject("PROBE_CANDIDATE_UNVERIFIED", "Candidate was not confirmed by this Board Probe")
      return
    }
    guard let baseVersion = candidate.refloatBaseVersion, !baseVersion.isEmpty else {
      promise.reject("PROBE_CONFIG_IDENTITY_MISSING", "Refloat Tune Compatibility is required")
      return
    }
    let previous: Int64
    let previousMotor: Int64
    do {
      previous = try BoardConfigStore.shared.load(boardId: boardId, refloatBaseVersion: baseVersion)?.capturedAtMs ?? Int64.min
      previousMotor = try MotorConfigStore.shared.loadLatest(boardId: boardId)?.capturedAtMs ?? Int64.min
    } catch {
      RecordingStorageFailure.reportRead(operation: "board_probe_config_read", error: error)
      promise.reject("APP_STORAGE_READ_FAILED", "Could not read saved Board config", cause: error)
      return
    }
    sendEvent("onBoardProbeProgress", [
      "probeId": probeId, "step": "session", "elapsedMs": 0, "transport": transport.bridgeValue,
    ])
    coordinator.connect(
      config: BoardConnectConfig(
        appBoardId: boardId, bleId: bleId, name: "Board Probe", transport: transport,
        linkVersion: 4, hasBms: candidate.hasBms,
        vescFirmwareVersion: candidate.vescFirmwareVersion,
        refloatVersion: candidate.refloatVersion, refloatBaseVersion: baseVersion,
        pollIntervalMs: 100, batteryConfig: nil, liveHistoryLimitMinutes: 5
      ),
      onSuccess: { [weak self] in
        self?.sendEvent("onBoardProbeProgress", [
          "probeId": probeId, "step": "config", "elapsedMs": 0, "transport": transport.bridgeValue,
        ])
        self?.awaitProbeConfig(
          probeId: probeId, boardId: boardId, bleId: bleId, candidate: candidate,
          previousCapturedAt: previous, previousMotorCapturedAt: previousMotor,
          attemptsRemaining: 120, promise: promise
        )
      },
      onError: { [weak self] code, message in
        self?.completedProbes.removeValue(forKey: probeId)
        self?.coordinator.stopBoard()
        promise.reject(code, message)
      }
    )
  }

  private func awaitProbeConfig(
    probeId: String, boardId: String, bleId: String,
    candidate: TransportDetection.Candidate, previousCapturedAt: Int64,
    previousMotorCapturedAt: Int64, attemptsRemaining: Int,
    promise: Promise
  ) {
    guard completedProbes[probeId] != nil else {
      coordinator.stopBoard()
      promise.reject("PROBE_CANCELLED", "Board Probe cancelled")
      return
    }
    let baseVersion = candidate.refloatBaseVersion!
    let values: BoardConfigValues?
    do { values = try BoardConfigStore.shared.load(boardId: boardId, refloatBaseVersion: baseVersion) }
    catch {
      coordinator.stopBoard()
      completedProbes.removeValue(forKey: probeId)
      RecordingStorageFailure.reportRead(operation: "board_probe_config_read", error: error)
      promise.reject("APP_STORAGE_READ_FAILED", "Could not read saved Board config", cause: error)
      return
    }
    if let values,
      values.capturedAtMs > previousCapturedAt {
      sendEvent("onBoardProbeProgress", [
        "probeId": probeId, "step": "motor-config", "elapsedMs": 0,
        "transport": candidate.transport.bridgeValue,
      ])
      awaitProbeMotorConfig(
        probeId: probeId, boardId: boardId, bleId: bleId, candidate: candidate,
        previousCapturedAt: previousMotorCapturedAt,
        attemptsRemaining: 80, promise: promise
      )
      return
    }
    guard attemptsRemaining > 0 else {
      coordinator.stopBoard()
      completedProbes.removeValue(forKey: probeId)
      promise.reject("PROBE_CONFIG_TIMEOUT", "Full Refloat config was not acquired")
      return
    }
    scheduler.postDelayed(250) { [weak self] in
      self?.awaitProbeConfig(
        probeId: probeId, boardId: boardId, bleId: bleId, candidate: candidate,
        previousCapturedAt: previousCapturedAt, previousMotorCapturedAt: previousMotorCapturedAt,
        attemptsRemaining: attemptsRemaining - 1,
        promise: promise
      )
    }
  }

  private func awaitProbeMotorConfig(
    probeId: String, boardId: String, bleId: String,
    candidate: TransportDetection.Candidate, previousCapturedAt: Int64,
    attemptsRemaining: Int, promise: Promise
  ) {
    guard completedProbes[probeId] != nil else {
      coordinator.stopBoard()
      promise.reject("PROBE_CANCELLED", "Board Probe cancelled")
      return
    }
    let values: MotorConfigValues?
    do { values = try MotorConfigStore.shared.loadLatest(boardId: boardId) }
    catch {
      coordinator.stopBoard()
      completedProbes.removeValue(forKey: probeId)
      RecordingStorageFailure.reportRead(operation: "board_probe_motor_config_read", error: error)
      promise.reject("APP_STORAGE_READ_FAILED", "Could not read saved motor config", cause: error)
      return
    }
    if let values,
      values.capturedAtMs > previousCapturedAt {
      finishBoardLink(
        probeId: probeId, boardId: boardId, bleId: bleId, candidate: candidate, promise: promise)
      return
    }
    guard attemptsRemaining > 0 else {
      coordinator.stopBoard()
      completedProbes.removeValue(forKey: probeId)
      promise.reject(
        "PROBE_MOTOR_CONFIG_TIMEOUT",
        "VESC motor config was not acquired — this firmware may not be supported yet"
      )
      return
    }
    scheduler.postDelayed(250) { [weak self] in
      self?.awaitProbeMotorConfig(
        probeId: probeId, boardId: boardId, bleId: bleId, candidate: candidate,
        previousCapturedAt: previousCapturedAt,
        attemptsRemaining: attemptsRemaining - 1, promise: promise
      )
    }
  }

  private func finishBoardLink(
    probeId: String, boardId: String, bleId: String,
    candidate: TransportDetection.Candidate, promise: Promise
  ) {
    guard completedProbes[probeId] != nil else {
      coordinator.stopBoard()
      promise.reject("PROBE_CANCELLED", "Board Probe cancelled")
      return
    }
    PendingLinkConnect.arm(boardId: boardId)
    coordinator.stopBoard()
    promise.resolve([
      "linkVersion": 4, "bleId": bleId, "transport": candidate.transport.bridgeValue,
      "hasBms": candidate.hasBms,
      "vescFirmwareVersion": candidate.vescFirmwareVersion,
      "refloatVersion": candidate.refloatVersion,
      "refloatBaseVersion": candidate.refloatBaseVersion!,
    ] as [String: Any?])
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `liveStateChanged`
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

  private func detachFromCoordinator() {
    coordinator.emit = nil
    coordinator.onStateChanged = nil
  }

  private func connectConfig(boardId: String) -> BoardConnectConfig? {
    BoardConnectConfig.resolve(
      boardId: boardId,
      appData: appData,
      recordingEnabled: requestedDebugRecordingEnabled
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `connectSavedBoardLink`
  private func connectSavedBoardLink(boardId: String?) {
    guard let boardId, PendingLinkConnect.consume(boardId: boardId), activeProbe == nil else { return }
    clearManualDisconnectAutoStartGate()
    guard let config = connectConfig(boardId: boardId) else { return }
    coordinator.connect(
      config: config,
      onSuccess: {},
      onError: { [weak self] _, message in
        self?.sendEvent("onError", ["message": message])
      }
    )
  }

  private func clearManualDisconnectAutoStartGate() {
    ManualBoardStop.clearAutoStartSuppression()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt `buildLiveState`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `liveStateMap`
  /// @parity /modules/vescape-core/src/index.ts `LiveStateEvent`
  private func liveState(includeRecent: Bool = false) -> [String: Any?] {
    RecordingStorageFailure.initialize()
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "live_state_settings_read", error: error)
      settings = [:]
    }
    return [
      "board": [
        "phase": coordinator.phase.rawValue,
        "selectedBoardId": selectedBoardId ?? settings["selectedBoardId"] ?? nil,
        "connectedBoardId": coordinator.connectedBoardId,
        "bleId": coordinator.bleId,
        "name": coordinator.boardName,
        "connectionSeq": coordinator.connectionSeq,
        "lastTelemetryAt": coordinator.lastTelemetryAt,
        "recentTelemetry": includeRecent ? coordinator.recentTelemetry() : [],
        "error": coordinator.boardError,
        "autoConnect": settings["autoConnect"] as? Bool ?? true,
        "linkIntegrity": coordinator.linkIntegrity.rawValue,
        "remoteTilt": coordinator.remoteTiltState(),
      ] as [String: Any?],
      "gps": [
        "phase": coordinator.gpsPhase(),
        "mode": coordinator.gpsMode(),
        "latestFix": coordinator.gpsLatestPreciseLocation(),
        "latestApproximateFix": coordinator.gpsLatestLocation(),
        "latestPreciseFix": coordinator.gpsLatestPreciseLocation(),
        "recentLocations": includeRecent ? coordinator.gpsRecentLocations() : [],
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
        // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt
        "startedAt": nil,
        "failure": coordinator.recordingFailure().map(recordingFailureState),
      ] as [String: Any?],
    ]
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `emitRideNotices`
  /// @parity /modules/vescape-core/src/index.ts `RideNoticesEvent`
  private func emitRideNotices(_ notices: [RideNotice]) {
    guard shouldEmitToFrontend("onRideNotices") else { return }
    sendEvent("onRideNotices", ["notices": notices.map { $0.toMap() }])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `shouldEmitToFrontend`
  private func shouldEmitToFrontend(_ name: String) -> Bool {
    frontendActive && observedEvents.contains(name)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `emitMaintenanceState`
  private func emitMaintenanceState(_ state: [String: Any?]) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onMaintenanceState") else { return }
      self.sendEvent("onMaintenanceState", state)
    }
  }

  private func reloadPrivacyZonesIntoRecorder() throws {
    TelemetryRepository.shared.reloadPrivacyZones(try appData.getEnabledPrivacyZoneEntities())
    coordinator.loadPrivacyZones()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `notifyDataChanged`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `definition`
  private func sendAppDataChanged(_ scope: String) {
    DispatchQueue.main.async { self.sendEvent("onAppDataChanged", ["scope": scope]) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
  /// @parity /modules/vescape-core/src/index.ts `BoardWarningsEvent`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onVescFaults`
  /// @parity /modules/vescape-core/src/index.ts `VescFaultsEvent`
  private func sendVescFaults(_ boardId: String, _ faults: [VescFaultOccurrence]) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onVescFaults") else { return }
      self.sendEvent("onVescFaults", ["boardId": boardId, "faults": faults.map { $0.toMap() }])
    }
  }

  private func sendBoardWarnings(_ boardId: String, _ warnings: [BoardWarning]) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onBoardWarnings") else { return }
      self.sendEvent("onBoardWarnings", ["boardId": boardId, "warnings": warnings.map { $0.toMap() }])
    }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onServiceConfig`
  /// @parity /modules/vescape-core/src/index.ts `ServiceConfigEvent`
  private func sendServiceConfig(_ config: ServiceConfig) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onServiceConfig") else { return }
      self.sendEvent("onServiceConfig", ["config": config.toMap()])
    }
  }

  private func recomputeNavigation() {
    let directionPoint: (latitude: Double, longitude: Double)?
    do { directionPoint = try appData.getDirectionPoint() }
    catch {
      RecordingStorageFailure.reportRead(operation: "direction_point_read", error: error)
      return
    }
    guard let directionPoint else { return }
    let origin = navigationOrigin()
    NavigationController.shared.recompute(
      toLatitude: directionPoint.latitude,
      toLongitude: directionPoint.longitude,
      fromLatitude: origin?.latitude,
      fromLongitude: origin?.longitude
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `navigationOrigin`
  private func navigationOrigin() -> (latitude: Double, longitude: Double)? {
    if let live = coordinator.riderPosition() { return live }
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "navigation_origin_settings_read", error: error)
      return nil
    }
    guard let latitude = settings["lastGpsLatitude"] as? Double,
          let longitude = settings["lastGpsLongitude"] as? Double
    else { return nil }
    return (latitude, longitude)
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onRouteProgress`
  /// @parity /modules/vescape-core/src/index.ts `RouteProgressEvent`
  private func sendRouteProgress(_ progress: RouteProgress?) {
    DispatchQueue.main.async {
      guard self.shouldEmitToFrontend("onRouteProgress") else { return }
      self.sendEvent("onRouteProgress", ["progress": progress?.toMap()])
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `MapPointApiException`
  private static func rejectMapSearch(_ promise: Promise, _ error: Error) {
    let apiError = error as? MapSearchApiError
    promise.reject(apiError?.code ?? MapSearchApiError.unavailable, apiError?.message ?? error.localizedDescription)
  }

  private static func rejectMapPoint(_ promise: Promise, _ error: Error) {
    guard let apiError = error as? MapPointApiError else {
      promise.reject(MapPointApiError.refused, error.localizedDescription)
      return
    }
    promise.reject(apiError.code, apiError.message)
  }

  private static func rejectRiderProfile(_ promise: Promise, _ error: Error) {
    guard let apiError = error as? RiderProfileApiError else {
      promise.reject(RiderProfileApiError.refused, error.localizedDescription)
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
