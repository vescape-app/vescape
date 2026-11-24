package expo.modules.vescapecore

import expo.modules.vescapecore.riderprofiles.RiderStatsSender
import expo.modules.vescapecore.notices.RideNotice
import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeLocation
import expo.modules.vescapecore.notices.RideNoticeSeverity
import expo.modules.vescapecore.notices.RideNotices
import expo.modules.vescapecore.weather.WeatherAlertLevel
import expo.modules.vescapecore.weather.WeatherAlertLine
import expo.modules.vescapecore.watch.WatchLastBatteryPusher
import expo.modules.vescapecore.watch.WatchRideNoticePusher
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
import expo.modules.vescapecore.telemetry.ConfigPersistence
import expo.modules.vescapecore.telemetry.FavoriteMediaCleanupException

import expo.modules.vescapecore.accessory.AccessoryDiscovery
import expo.modules.vescapecore.accessory.AccessorySessionManager
import expo.modules.vescapecore.alerts.MySounds
import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.alerts.normalizedAlertRepeatSeconds
import expo.modules.vescapecore.alerts.AlertCoordinator
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.serviceconfig.ServiceConfigCoordinator
import expo.modules.vescapecore.maps.MapSearchApi
import expo.modules.vescapecore.weather.WeatherCoordinator
import expo.modules.vescapecore.auth.NativeAuthCoordinator
import expo.modules.vescapecore.service.BoardProbeAutoStartGate
import expo.modules.vescapecore.connection.readPhoneBattery
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.connection.BoardTransportDetector
import expo.modules.vescapecore.service.CompanionPresence
import expo.modules.vescapecore.service.CompanionRestartGate
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.recording.DebugRecordingStore
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.recording.StorageOutageEventBridge
import expo.modules.vescapecore.replay.ReplayRecording
import expo.modules.vescapecore.replay.ReplayRecordings
import expo.modules.vescapecore.replay.SimulatedBoard
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.service.ManualDisconnectAutoStartGate
import expo.modules.vescapecore.service.ReplaySpec
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.connection.TransportDetection
import expo.modules.vescapecore.connection.PendingLinkConnect
import expo.modules.vescapecore.connection.buildSessionConfig

import expo.modules.vescapecore.maptiles.MapTiles
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.navigation.NavigationProfile
import expo.modules.vescapecore.watch.WATCH_SOURCE_SETTING_KEYS
import expo.modules.vescapecore.watch.WatchRouteMirror
import expo.modules.vescapecore.faults.VescFaultCaptureCoordinator
import expo.modules.vescapecore.faults.VescFaultCoordinator
import expo.modules.vescapecore.warnings.BoardWarningRegistry
import expo.modules.vescapecore.warnings.BoardWarningSeverity
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.vescapecore.mappoints.MapPointApi
import expo.modules.vescapecore.riderprofiles.RiderProfileApi
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.database.DatabaseBackupManager
import expo.modules.vescapecore.telemetry.MaintenanceRunner
import expo.modules.vescapecore.telemetry.ProfileStatsRepository
import expo.modules.vescapecore.telemetry.RideBatch
import expo.modules.vescapecore.telemetry.RideExport
import expo.modules.vescapecore.telemetry.RideHistoryRepository
import expo.modules.vescapecore.database.DATABASE_NAME
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.database.VescapeDatabase
import expo.modules.vescapecore.database.AlertRuleEntity
import expo.modules.vescapecore.telemetry.AlertPresetPersistence
import expo.modules.vescapecore.location.LegalPolicyResolver
import expo.modules.vescapecore.location.LegalPolicyResolution
import expo.modules.vescapecore.location.LegalPolicyCatalog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "VescapeCore"
private const val SCAN_RETRY_LIMIT = 3

private fun Map<String, Any?>.toAlertTestRule(): AlertRuleEntity? {
  val id = this["id"] as? String ?: return null
  val controlId = this["controlId"] as? String ?: return null
  val threshold = (this["threshold"] as? Number)?.toDouble() ?: return null
  val thresholdMax = (this["thresholdMax"] as? Number)?.toDouble()
  val spec = this["spec"] as? String ?: return null
  return AlertRuleEntity(
    boardId = "alert-test",
    id = id,
    controlId = controlId,
    threshold = threshold,
    thresholdMax = thresholdMax,
    enabled = true,
    spec = spec,
    createdAt = 0,
    repeatEverySeconds = normalizedAlertRepeatSeconds((this["repeatEverySeconds"] as? Number)?.toDouble()),
  )
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift
 */
@SuppressLint("MissingPermission")
class VescapeCoreModule : Module() {
  private class ActiveBoardProbe(
    val id: String,
    val result: CompletableDeferred<TransportDetection.Result>,
  ) {
    var detector: BoardTransportDetector? = null
  }

  private var scanner: android.bluetooth.le.BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var scanRetryCount = 0
  private var scanRetryRunnable: Runnable? = null
  private var scanStatus: String = "idle"
  private var requestedDebugRecordingEnabled = false
  @Volatile
  private var frontendActive = true
  private val observedEvents: MutableSet<String> = ConcurrentHashMap.newKeySet()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val rideExportCancelled = java.util.concurrent.atomic.AtomicBoolean(false)
  private var activeProbe: ActiveBoardProbe? = null
  private val completedProbes = ConcurrentHashMap<String, TransportDetection.Result>()
  private var previewAlertFeedback: AlertFeedback? = null
  private var alertTestFeedback: AlertFeedback? = null
  private var alertTestCoordinator: AlertCoordinator? = null
  private var alertTestControlId: String? = null
  private var appStatusUnsub: (() -> Unit)? = null
  private var rideNoticesUnsub: (() -> Unit)? = null
  private var serviceConfigUnsub: (() -> Unit)? = null
  private val companionPresence by lazy {
    CompanionPresence(context.applicationContext, activityProvider = { appContext.currentActivity })
  }
  private val legalPolicyResolver by lazy { LegalPolicyResolver(context.applicationContext) }
  private val legalPolicyCatalog by lazy { LegalPolicyCatalog(context.applicationContext) }

  private val context: Context get() = appContext.reactContext
    ?: throw IllegalStateException("No React context")
  private val btAdapter: BluetoothAdapter get() =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

  override fun definition() = ModuleDefinition {
    Name("VescapeCore")

    CoreForegroundService.emitEvent = eventListener

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `attachToCoordinator`
    CoreForegroundService.liveStateChanged = liveStateListener

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `Events`
    // @parity /modules/vescape-core/src/index.ts `VescapeCoreEvents`
    Events(
      "onDevice",
      "onRideExportProgress",
      "onError",
      "onLiveState",
      "onLiveTick",
      "onLiveSeries",
      "onFocusedSeries",
      "onBms",
      "onBmsSeries",
      "onLocation",
      "onMaintenanceState",
      "onBoardProbeProgress",
      "onGroupRideConnection",
      "onGroupRideSignalAvailability",
      "onPublicRideStatus",
      "onPublicRiders",
      "onPublicPins",
      "onAppDataChanged",
      "onBoardWarnings",
      "onVescFaults",
      "onBoardConfigValues",
      "onMotorConfigValues",
      "onBoardConfigChangeNotice",
      "onBoardLights",
      "onAppStatus",
      "onServiceConfig",
      "onNavigation",
      "onRouteProgress",
      "onWeather",
      "onAccessoryDevice",
      "onAccessoryScanError",
      "onAccessoryState",
      "onAccessoryReading",
      "onRideNotices",
    )

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `AccessoryDiscovery`
    AccessoryDiscovery.emit = { name, body ->
      mainHandler.post { if (shouldEmitToFrontend(name)) sendEvent(name, body) }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `AccessorySessionController`
    AccessorySessionManager.emit = { name, body ->
      mainHandler.post { if (shouldEmitToFrontend(name)) sendEvent(name, body) }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendAppStatus`
    // @parity /modules/vescape-core/src/index.ts `AppStatusEvent`
    appStatusUnsub = AppStatusCoordinator.get(context).addChangeListener { status ->
      if (shouldEmitToFrontend("onAppStatus")) {
        sendEvent("onAppStatus", mapOf("status" to status?.toMap()))
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `onServiceConfig`
    // @parity /modules/vescape-core/src/index.ts `ServiceConfigEvent`
    serviceConfigUnsub = ServiceConfigCoordinator.get(context).addChangeListener { config ->
      if (shouldEmitToFrontend("onServiceConfig")) {
        sendEvent("onServiceConfig", mapOf("config" to config.toMap()))
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendNavigation`
    // @parity /modules/vescape-core/src/index.ts `NavigationEvent`
    NavigationController.get(context).onChange = { navigation ->
      if (shouldEmitToFrontend("onNavigation")) {
        sendEvent(
          "onNavigation",
          mapOf(
            "navigation" to navigation?.toMap(),
            "computing" to NavigationController.get(context).computing,
          ),
        )
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendRouteProgress`
    // @parity /modules/vescape-core/src/index.ts `RouteProgressEvent`
    NavigationController.get(context).onProgressChange = { progress ->
      if (shouldEmitToFrontend("onRouteProgress")) {
        sendEvent("onRouteProgress", mapOf("progress" to progress?.toMap()))
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendBoardWarnings`
    // @parity /modules/vescape-core/src/index.ts `BoardWarningsEvent`
    BoardWarningRegistry.get(context).onChange = { boardId, warnings ->
      if (shouldEmitToFrontend("onBoardWarnings")) {
        mainHandler.post {
          if (shouldEmitToFrontend("onBoardWarnings")) {
            sendEvent(
              "onBoardWarnings",
              mapOf("boardId" to boardId, "warnings" to warnings.map { it.toMap() }),
            )
          }
        }
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendVescFaults`
    // @parity /modules/vescape-core/src/index.ts `VescFaultsEvent`
    VescFaultCoordinator.get(context).onChange = { boardId, faults ->
      if (shouldEmitToFrontend("onVescFaults")) {
        mainHandler.post {
          if (shouldEmitToFrontend("onVescFaults")) {
            sendEvent(
              "onVescFaults",
              mapOf("boardId" to boardId, "faults" to faults.map { it.toMap() }),
            )
          }
        }
      }
    }

    OnStartObserving("onDevice") { startObserving("onDevice") }
    OnStopObserving("onDevice") { stopObserving("onDevice") }
    OnStartObserving("onError") { startObserving("onError") }
    OnStopObserving("onError") { stopObserving("onError") }
    OnStartObserving("onLiveState") { startObserving("onLiveState") }
    OnStopObserving("onLiveState") { stopObserving("onLiveState") }
    OnStartObserving("onLiveTick") { startObserving("onLiveTick") }
    OnStopObserving("onLiveTick") { stopObserving("onLiveTick") }
    OnStartObserving("onLiveSeries") { startObserving("onLiveSeries") }
    OnStopObserving("onLiveSeries") { stopObserving("onLiveSeries") }
    OnStartObserving("onFocusedSeries") { startObserving("onFocusedSeries") }
    OnStopObserving("onFocusedSeries") { stopObserving("onFocusedSeries") }
    OnStartObserving("onBms") { startObserving("onBms") }
    OnStopObserving("onBms") { stopObserving("onBms") }
    OnStartObserving("onBmsSeries") { startObserving("onBmsSeries") }
    OnStopObserving("onBmsSeries") { stopObserving("onBmsSeries") }
    OnStartObserving("onLocation") { startObserving("onLocation") }
    OnStopObserving("onLocation") { stopObserving("onLocation") }
    OnStartObserving("onMaintenanceState") {
      startObserving("onMaintenanceState")
      emitMaintenanceState(MaintenanceRunner.snapshot())
    }
    OnStopObserving("onMaintenanceState") { stopObserving("onMaintenanceState") }
    OnStartObserving("onBoardProbeProgress") { startObserving("onBoardProbeProgress") }
    OnStopObserving("onBoardProbeProgress") { stopObserving("onBoardProbeProgress") }
    OnStartObserving("onGroupRideConnection") {
      startObserving("onGroupRideConnection")
      CoreForegroundService.replayGroupRideEvent("onGroupRideConnection")
    }
    OnStopObserving("onGroupRideConnection") { stopObserving("onGroupRideConnection") }
    OnStartObserving("onGroupRideSignalAvailability") {
      startObserving("onGroupRideSignalAvailability")
      CoreForegroundService.replayGroupRideEvent("onGroupRideSignalAvailability")
    }
    OnStopObserving("onGroupRideSignalAvailability") { stopObserving("onGroupRideSignalAvailability") }
    OnStartObserving("onPublicRideStatus") {
      startObserving("onPublicRideStatus")
      CoreForegroundService.replayGroupRideEvent("onPublicRideStatus")
    }
    OnStopObserving("onPublicRideStatus") { stopObserving("onPublicRideStatus") }
    OnStartObserving("onPublicRiders") {
      startObserving("onPublicRiders")
      CoreForegroundService.replayGroupRideEvent("onPublicRiders")
    }
    OnStopObserving("onPublicRiders") { stopObserving("onPublicRiders") }
    OnStartObserving("onPublicPins") {
      startObserving("onPublicPins")
      CoreForegroundService.replayGroupRideEvent("onPublicPins")
    }
    OnStopObserving("onPublicPins") { stopObserving("onPublicPins") }
    OnStartObserving("onBoardWarnings") {
      startObserving("onBoardWarnings")
      CoroutineScope(Dispatchers.IO).launch { BoardWarningRegistry.get(context).emitSnapshot() }
    }
    OnStopObserving("onBoardWarnings") { stopObserving("onBoardWarnings") }

    OnStartObserving("onVescFaults") {
      startObserving("onVescFaults")
      CoroutineScope(Dispatchers.IO).launch { VescFaultCoordinator.get(context).emitSnapshot() }
    }
    OnStopObserving("onVescFaults") { stopObserving("onVescFaults") }
    OnStartObserving("onBoardConfigValues") {
      startObserving("onBoardConfigValues")
      sendEvent("onBoardConfigValues", mapOf("values" to CoreForegroundService.getBoardConfigValues()))
    }
    OnStopObserving("onBoardConfigValues") { stopObserving("onBoardConfigValues") }
    OnStartObserving("onMotorConfigValues") {
      startObserving("onMotorConfigValues")
      sendEvent("onMotorConfigValues", mapOf("values" to CoreForegroundService.getMotorConfigValues()))
    }
    OnStopObserving("onMotorConfigValues") { stopObserving("onMotorConfigValues") }
    OnStartObserving("onBoardConfigChangeNotice") { startObserving("onBoardConfigChangeNotice") }
    OnStopObserving("onBoardConfigChangeNotice") { stopObserving("onBoardConfigChangeNotice") }
    OnStartObserving("onBoardLights") {
      startObserving("onBoardLights")
      sendEvent("onBoardLights", CoreForegroundService.lightsEventBody())
    }
    OnStopObserving("onBoardLights") { stopObserving("onBoardLights") }
    OnStartObserving("onAppStatus") {
      startObserving("onAppStatus")
      sendEvent("onAppStatus", mapOf("status" to AppStatusCoordinator.get(context).current?.toMap()))
    }
    OnStopObserving("onAppStatus") { stopObserving("onAppStatus") }
    OnStartObserving("onServiceConfig") {
      startObserving("onServiceConfig")
      sendEvent("onServiceConfig", mapOf("config" to ServiceConfigCoordinator.get(context).current.toMap()))
    }
    OnStopObserving("onServiceConfig") { stopObserving("onServiceConfig") }
    OnStartObserving("onNavigation") {
      startObserving("onNavigation")
      sendEvent(
        "onNavigation",
        mapOf(
          "navigation" to NavigationController.get(context).current?.toMap(),
          "computing" to NavigationController.get(context).computing,
        ),
      )
    }
    OnStopObserving("onNavigation") { stopObserving("onNavigation") }
    OnStartObserving("onRouteProgress") {
      startObserving("onRouteProgress")
      sendEvent(
        "onRouteProgress",
        mapOf("progress" to NavigationController.get(context).currentProgress?.toMap()),
      )
    }
    OnStopObserving("onRouteProgress") { stopObserving("onRouteProgress") }
    OnStartObserving("onWeather") {
      startObserving("onWeather")
      sendEvent("onWeather", mapOf("weather" to WeatherCoordinator.get().current?.toMap()))
    }
    OnStopObserving("onWeather") { stopObserving("onWeather") }
    OnStartObserving("onAccessoryDevice") { startObserving("onAccessoryDevice") }
    OnStopObserving("onAccessoryDevice") { stopObserving("onAccessoryDevice") }
    OnStartObserving("onAccessoryScanError") { startObserving("onAccessoryScanError") }
    OnStopObserving("onAccessoryScanError") { stopObserving("onAccessoryScanError") }
    OnStartObserving("onAccessoryState") { startObserving("onAccessoryState") }
    OnStopObserving("onAccessoryState") { stopObserving("onAccessoryState") }
    OnStartObserving("onAccessoryReading") { startObserving("onAccessoryReading") }
    OnStopObserving("onAccessoryReading") { stopObserving("onAccessoryReading") }
    OnStartObserving("onRideNotices") {
      startObserving("onRideNotices")
      emitRideNotices(RideNotices.current)
    }
    OnStopObserving("onRideNotices") { stopObserving("onRideNotices") }

    OnCreate {
      val storageOutageEvents = StorageOutageEventBridge(
        shouldEmit = { shouldEmitToFrontend("onLiveState") },
        emit = { postLiveState(CoreForegroundService::storageUnavailableLiveState) },
      )
      RecordingStorageFailure.observeOutage(storageOutageEvents::onOutage)
      AppStatusCoordinator.get(context).refresh()
      ServiceConfigCoordinator.get(context).refresh()
      RiderStatsSender.get(context).foreground()
      MaintenanceRunner.onChange = ::emitMaintenanceState
      MaintenanceRunner.start(context.applicationContext)
      rideNoticesUnsub = RideNotices.addListener(::emitRideNotices)
      WatchRideNoticePusher.start(context)
    }

    OnActivityEntersForeground {
      frontendActive = true
      CompanionRestartGate.clear(context.applicationContext)
      CoreForegroundService.setAppVisible(context.applicationContext, true)
      AppStatusCoordinator.get(context).refresh()
      ServiceConfigCoordinator.get(context).refresh()
      RiderStatsSender.get(context).foreground()
      emitMaintenanceState(MaintenanceRunner.snapshot())
      emitRideNotices(RideNotices.current)
      RideNotices.expireNow()
      CoreForegroundService.resyncGroupRide()
    }
    OnActivityEntersBackground {
      frontendActive = false
      CoreForegroundService.setAppVisible(context.applicationContext, false)
    }
    OnActivityResult { _, result ->
      companionPresence.onActivityResult(result.requestCode, result.resultCode)
    }
    OnDestroy {
      MaintenanceRunner.onChange = null
      RecordingStorageFailure.observeOutage(null)
      frontendActive = false
      observedEvents.clear()
      BoardWarningRegistry.get(context).onChange = null
      VescFaultCoordinator.get(context).onChange = null
      NavigationController.get(context).onChange = null
      NavigationController.get(context).onProgressChange = null
      appStatusUnsub?.invoke()
      appStatusUnsub = null
      serviceConfigUnsub?.invoke()
      serviceConfigUnsub = null
      rideNoticesUnsub?.invoke()
      rideNoticesUnsub = null
      previewAlertFeedback?.release()
      previewAlertFeedback = null
      stopAlertTest()
      cancelActiveProbe(null, "module_destroyed")
      AccessoryDiscovery.emit = null
      AccessoryDiscovery.stopScan()
      AccessoryDiscovery.cancelInspection()
      AccessorySessionManager.emit = null
      AccessorySessionManager.releasePreviews()
      if (CoreForegroundService.emitEvent === eventListener) {
        CoreForegroundService.emitEvent = null
      }
      if (CoreForegroundService.liveStateChanged === liveStateListener) {
        CoreForegroundService.liveStateChanged = null
      }
    }

    Function("scan") { startScan(resetRetries = true) }
    Function("stopScan") { stopScanInternal() }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `startAccessoryScan`
    // @parity /modules/vescape-core/src/index.ts `startAccessoryScan`
    Function("startAccessoryScan") { AccessoryDiscovery.startScan(context.applicationContext) }
    Function("stopAccessoryScan") { AccessoryDiscovery.stopScan() }
    Function("cancelAccessoryInspection") { AccessoryDiscovery.cancelInspection() }
    AsyncFunction("inspectAccessory") { deviceId: String, promise: Promise ->
      AccessoryDiscovery.inspect(context.applicationContext, deviceId) { promise.resolve(it) }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `enrollAccessory`
    // @parity /modules/vescape-core/src/index.ts `enrollAccessory`
    AsyncFunction("enrollAccessory") { deviceId: String, promise: Promise ->
      AccessorySessionManager.enroll(context.applicationContext, deviceId) { promise.resolve(it) }
    }
    AsyncFunction("forgetAccessory") { accessoryId: String, promise: Promise ->
      AccessorySessionManager.forget(context.applicationContext, accessoryId) { promise.resolve(it) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `saveBrakeLightSettings`
    // @parity /modules/vescape-core/src/index.ts `saveBrakeLightSettings`
    AsyncFunction("saveBrakeLightSettings") { accessoryId: String, capabilityId: String, sensitivity: Int, parked: String, promise: Promise ->
      AccessorySessionManager.saveBrakeLight(accessoryId, capabilityId, sensitivity, parked) { promise.resolve(it) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setAccessoryCapabilityEnabled`
    // @parity /modules/vescape-core/src/index.ts `setAccessoryCapabilityEnabled`
    AsyncFunction("setAccessoryCapabilityEnabled") { accessoryId: String, capabilityId: String, enabled: Boolean, promise: Promise ->
      AccessorySessionManager.setCapabilityEnabled(accessoryId, capabilityId, enabled) { promise.resolve(it) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setAccessorySamplingRate`
    // @parity /modules/vescape-core/src/index.ts `setAccessorySamplingRate`
    AsyncFunction("setAccessorySamplingRate") { accessoryId: String, capabilityId: String, rateHz: Double, promise: Promise ->
      AccessorySessionManager.setSamplingRate(accessoryId, capabilityId, rateHz) { promise.resolve(it) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setBrakeLightPreview`
    // @parity /modules/vescape-core/src/index.ts `setBrakeLightPreview`
    AsyncFunction("setBrakeLightPreview") { accessoryId: String, capabilityId: String, mode: String?, promise: Promise ->
      AccessorySessionManager.setLightPreview(accessoryId, capabilityId, mode) { promise.resolve(it) }
    }
    Function("getAccessories") { AccessorySessionManager.snapshot() }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setAccessoryPreview`
    // @parity /modules/vescape-core/src/index.ts `setAccessoryPreview`
    Function("setAccessoryPreview") { accessoryId: String, capabilityId: String, open: Boolean ->
      AccessorySessionManager.setPreview(accessoryId, capabilityId, open)
    }
    AsyncFunction("saveGroundClearanceCalibration") {
      accessoryId: String,
      capabilityId: String,
      nearCm: Double,
      farCm: Double,
      direction: String,
      strengthPercent: Int,
      promise: Promise,
      ->
      AccessorySessionManager.saveGroundClearance(
        accessoryId = accessoryId,
        capabilityId = capabilityId,
        nearCm = nearCm,
        farCm = farCm,
        direction = direction,
        strengthPercent = strengthPercent,
      ) { promise.resolve(it) }
    }
    AsyncFunction("clearGroundClearanceCalibration") {
      accessoryId: String,
      capabilityId: String,
      promise: Promise,
      ->
      AccessorySessionManager.clearGroundClearance(accessoryId, capabilityId) { promise.resolve(it) }
    }
    Function("exitApp") { CoreForegroundService.exitApp(context.applicationContext) }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshLocationDemand`
    Function("refreshLocationDemand") { refreshLocationDemand() }
    registerGroupRide()
    Function("setWatchRouteSpanM") { spanM: Double? ->
      WatchRouteMirror.viewportSpanM = spanM
    }
    Function("setTelemetryRecordingEnabled") { enabled: Boolean -> setTelemetryRecordingEnabled(enabled) }
    Function("setBmsSeriesFocused") { focused: Boolean ->
      CoreForegroundService.setBmsSeriesFocused(focused)
    }
    Function("setFocusedSeriesMetrics") { metrics: List<String> ->
      CoreForegroundService.setFocusedSeriesMetrics(metrics)
    }
    Function("setLiveSeriesMetrics") { metrics: List<String> ->
      CoreForegroundService.setLiveSeriesMetrics(metrics)
    }
    Function("reloadAlertRules") {
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    Function("previewAlertSound") { spec: String ->
      CoreForegroundService.previewAlertSound(context.applicationContext, spec)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `previewWeatherAlert`
    // @parity /modules/vescape-core/src/index.ts `previewWeatherAlert`
    Function("previewWeatherAlert") { kind: String, leadMinutes: Int, percent: Int? ->
      WeatherAlertLine.preview(kind, leadMinutes, percent)?.let { CoreForegroundService.previewWeatherAlert(context.applicationContext, it) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `playPackSound`
    Function("playPackSound") { pack: String, slot: String ->
      CoreForegroundService.playPackSound(context.applicationContext, pack, slot)
    }
    registerMySounds()
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `mapTile`
    AsyncFunction("mapTile") Coroutine { z: Int, x: Int, y: Int ->
      MapTiles.get(context.applicationContext).tile(z, x, y)?.let { Uri.fromFile(it).toString() }
    }
    Function("getAlertSounds") {
      CoreForegroundService.alertSoundPresets()
    }
    Function("startGeigerSimulation") { spec: String, rangeDepth: Double ->
      val feedback = previewAlertFeedback ?: AlertFeedback(context.applicationContext, mainHandler)
        .also { previewAlertFeedback = it }
      val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context.applicationContext).getTypedSettings() }
      feedback.setSoundSettings(settings)
      feedback.updateGeiger("preview", spec, rangeDepth)
    }
    Function("stopGeigerSimulation") {
      previewAlertFeedback?.stopGeiger("preview")
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `startAlertTest`
    // @parity /modules/vescape-core/src/index.ts `startAlertTest`
    Function("startAlertTest") { rules: List<Map<String, Any?>> ->
      startAlertTest(rules)
    }
    Function("updateAlertTest") { value: Double ->
      val controlId = alertTestControlId ?: return@Function
      alertTestCoordinator?.evaluateValues(
        values = mapOf(controlId to if (controlId == "battery") 48.0 else value),
        batteryPercent = value.takeIf { controlId == "battery" },
        onDiagnostic = { _, _ -> },
      )
    }
    Function("stopAlertTest") {
      stopAlertTest()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getPhoneBatteryLevel`
    // @parity /modules/vescape-core/src/index.ts `getPhoneBatteryLevel`
    AsyncFunction("getPhoneBatteryLevel") {
      readPhoneBattery(context)
    }
    Function("getLiveState") {
      liveStateWithScan(CoreForegroundService.currentLiveState(context.applicationContext))
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getAppStatus`
    Function("getAppStatus") {
      AppStatusCoordinator.get(context).current?.toMap()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getServiceConfig`
    Function("getServiceConfig") {
      ServiceConfigCoordinator.get(context).current.toMap()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getWeather`
    Function("getWeather") {
      WeatherCoordinator.get().current?.toMap()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getWeatherAlertThresholds`
    Function("getWeatherAlertThresholds") {
      WeatherAlertLevel.entries.associate {
        it.key to mapOf("gustKmh" to it.wind.minGustKmh, "rainPercent" to it.rain.minProbabilityPercent)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshWeather`
    Function("refreshWeather") {
      mainHandler.post { WeatherCoordinator.get().refresh() }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `provisionDeviceCredential`
    AsyncFunction("provisionDeviceCredential") Coroutine {
        serverUrl: String,
        deviceToken: String,
        accountId: String,
      ->
      NativeAuthCoordinator.get(context).provision(serverUrl, deviceToken, accountId)
    }
    Function("getDeviceCredentialState") {
      NativeAuthCoordinator.get(context).stateMap()
    }
    AsyncFunction("revokeDeviceCredential") Coroutine { ->
      NativeAuthCoordinator.get(context).revoke()
    }
    Function("clearDeviceCredential") {
      NativeAuthCoordinator.get(context).clear()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `requestAppleAuthorizationCode`
    // @platform-diff Sign in with Apple token revocation is iOS-only.
    // @parity /modules/vescape-core/src/index.ts `requestAppleAuthorizationCode`
    AsyncFunction("requestAppleAuthorizationCode") { null as String? }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `openAppUpdate`
    // @platform-diff Android uses the stable Android download route.
    // @parity /modules/vescape-core/src/index.ts `openAppUpdate`
    Function("openAppUpdate") {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(AppStatusCoordinator.androidDownloadUrl()))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "Cannot open the download route: ${e.message}")
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getGroundClearanceTilt`
    // @parity /modules/vescape-core/src/index.ts `getGroundClearanceTilt`
    AsyncFunction("getGroundClearanceTilt") {
      CoreForegroundService.currentGroundClearanceTilt()
    }.runOnQueue(Queues.MAIN)
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRemoteTiltState`
    // @parity /modules/vescape-core/src/index.ts `getRemoteTiltState`
    AsyncFunction("getRemoteTiltState") {
      CoreForegroundService.currentRemoteTiltState()
    }.runOnQueue(Queues.MAIN)
    Function("setSelectedBoard") { boardId: String? ->
      try {
        runBlocking { AppDataRepository.get(context.applicationContext).setSelectedBoardId(boardId) }
      } catch (error: Exception) {
        RecordingStorageFailure.report("setting_save", "write_failed", error)
        throw error
      }
      ManualDisconnectAutoStartGate.clear(context.applicationContext)
      WatchLastBatteryPusher.push(context)
      companionPresence.refreshForSelectedBoard()
    }
    Function("setDebugRecordingEnabled") { enabled: Boolean ->
      requestedDebugRecordingEnabled = enabled
    }
    AsyncFunction("listDebugRecordings") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(DebugRecordingStore(context.applicationContext).list())
        } catch (e: Exception) {
          UnexpectedNativeError.report("debug_recording_list", "file_metadata_failed", e)
          promise.reject("ERR_LIST_DEBUG_RECORDINGS", e.message, e)
        }
      }
    }
    AsyncFunction("listBundledDebugFixtures") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(ReplayRecordings.listBundled(context.applicationContext))
        } catch (e: Exception) {
          promise.reject("ERR_LIST_BUNDLED_FIXTURES", e.message, e)
        }
      }
    }
    AsyncFunction("exportDebugRecording") { name: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(DebugRecordingStore(context.applicationContext).export(name))
        } catch (e: Exception) {
          UnexpectedNativeError.report("debug_recording_export", "file_copy_failed", e)
          promise.reject("ERR_EXPORT_DEBUG_RECORDING", e.message, e)
        }
      }
    }
    AsyncFunction("deleteDebugRecording") { name: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          DebugRecordingStore(context.applicationContext).delete(name)
          promise.resolve(null)
        } catch (e: Exception) {
          UnexpectedNativeError.report("debug_recording_delete", "file_delete_failed", e)
          promise.reject("ERR_DELETE_DEBUG_RECORDING", e.message, e)
        }
      }
    }
    AsyncFunction("startDebugReplay") { name: String, options: Map<String, Any?>?, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          startDebugReplay(name, options, promise)
        } catch (e: Exception) {
          promise.reject("ERR_START_DEBUG_REPLAY", e.message, e)
        }
      }
    }
    AsyncFunction("stopDebugReplay") { promise: Promise ->
      CoreForegroundService.stopBoardSession(context.applicationContext) { promise.resolve(null) }
    }
    Function("getDebugReplayState") { debugReplayStateMap {} }
    Function("setDebugReplayPaused") { paused: Boolean -> debugReplayStateMap { it.setPaused(paused) } }
    Function("setDebugReplayLoop") { loop: Boolean -> debugReplayStateMap { it.setLoop(loop) } }
    Function("dropDebugReplayLink") { debugReplayStateMap { it.dropLink() } }
    Function("reportUiError") { message: String, source: String?, stack: String? ->
      DiagnosticReporter.get(context.applicationContext).capture(
        "ui_error",
        mapOf(
          "operation" to "ui",
          "message" to message,
          "source" to source,
          "stack" to stack,
        ),
      )
    }
    Function("reportDiagnosticTest") {
      val reporter = DiagnosticReporter.get(context.applicationContext)
      reporter.capture(
        "diagnostic_test",
        mapOf(
          "operation" to "dev_diagnostics",
          "source" to "settings_dev",
          "message" to "Manual diagnostic test",
        ),
      )
      reporter.status()
    }
    Function("getDiagnosticStatus") {
      DiagnosticReporter.get(context.applicationContext).status()
    }

    AsyncFunction("selectBoard") Coroutine { boardId: String ->
      selectBoard(boardId)
    }
    AsyncFunction("setCompanionPresenceEnabled") { enabled: Boolean, promise: Promise ->
      companionPresence.setEnabled(enabled, promise)
    }
    AsyncFunction("getCompanionPresenceBoards") Coroutine { ->
      companionPresence.getBoards()
    }
    AsyncFunction("addCompanionPresenceBoard") { boardId: String, promise: Promise ->
      companionPresence.addBoard(boardId, promise)
    }
    AsyncFunction("removeCompanionPresenceBoard") { boardId: String, promise: Promise ->
      companionPresence.removeBoard(boardId, promise)
    }
    AsyncFunction("stopBoard") { promise: Promise ->
      stopBoardSession(promise)
    }
    AsyncFunction("probeBoardLink") Coroutine { bleId: String, probeId: String ->
      probeBoardLink(bleId, probeId)
    }
    AsyncFunction("finalizeBoardLink") Coroutine {
        probeId: String, boardId: String, bleId: String, candidate: Map<String, Any?> ->
      finalizeBoardLink(probeId, boardId, bleId, candidate)
    }
    Function("cancelBoardProbe") { probeId: String ->
      cancelActiveProbe(probeId, "js_cancelled")
    }
    AsyncFunction("getTelemetryHistory") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).getHistory(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_buckets_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride history", error)
      }
    }
    registerRideHistory()
    registerRideBatch()
    AsyncFunction("getTelemetrySamples") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).getSamples(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_samples_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride history", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideGpx`
    // @parity /modules/vescape-core/src/index.ts `exportRideGpx`
    AsyncFunction("exportRideGpx") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).exportRideGpx(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_RIDE_EXPORT", "Could not export ride", error) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideCsv`
    // @parity /modules/vescape-core/src/index.ts `exportRideCsv`
    AsyncFunction("exportRideCsv") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).exportRideCsv(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_RIDE_EXPORT", "Could not export ride", error) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideFloaty`
    // @parity /modules/vescape-core/src/index.ts `exportRideFloaty`
    AsyncFunction("exportRideFloaty") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).exportRideFloaty(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_RIDE_EXPORT", "Could not export ride", error) }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportLiveTelemetryCsv`
    // @parity /modules/vescape-core/src/index.ts `exportLiveTelemetryCsv`
    AsyncFunction("exportLiveTelemetryCsv") Coroutine { ->
      try {
        withContext(Dispatchers.IO) {
          RideExport.liveCsv(CoreForegroundService.recentTelemetry(), context.applicationContext.cacheDir)
        }
      }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_LIVE_EXPORT", "Could not export live telemetry", error) }
    }
    AsyncFunction("getHistoryRange") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).getRange(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_range_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride history", error)
      }
    }
    AsyncFunction("getTelemetrySummary") {
      RecordingStorageFailure.requireAvailable()
      try { runBlocking { TelemetryRepository.get(context.applicationContext).getSummary() } }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_summary_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride history", error)
      }
    }
    AsyncFunction("getDiagnosticEvents") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      TelemetryRepository.get(context.applicationContext).getDiagnosticEvents(options)
    }
    AsyncFunction("getBoardWarnings") Coroutine { ->
      RecordingStorageFailure.requireAvailable()
      try { BoardWarningRegistry.get(context).allWarnings().map { it.toMap() } }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("board_warnings_read", error); throw error }
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getVescFaults`
     * @parity /modules/vescape-core/src/index.ts `getVescFaults`
     */
    AsyncFunction("getVescFaults") Coroutine { ->
      RecordingStorageFailure.requireAvailable()
      try { VescFaultCoordinator.get(context).allFaults().map { it.toMap() } }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("vesc_faults_read", error); throw error }
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setVescFaultDismissed`
     * @parity /modules/vescape-core/src/index.ts `setVescFaultDismissed`
     */
    AsyncFunction("setVescFaultDismissed") Coroutine { id: String, dismissed: Boolean ->
      RecordingStorageFailure.requireAvailable()
      try { VescFaultCoordinator.get(context).setDismissed(id, dismissed) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("vesc_fault_dismiss", "write_failed", error); throw error }
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getVescFaultCapture`
     * @parity /modules/vescape-core/src/index.ts `getVescFaultCapture`
     */
    AsyncFunction("getVescFaultCapture") Coroutine { occurrenceId: String ->
      RecordingStorageFailure.requireAvailable()
      try {
        val captures = VescFaultCaptureCoordinator.get(context)
        captures.capture(occurrenceId)?.let { capture -> capture.toMap() + mapOf("samples" to captures.samples(occurrenceId).map { it.toMap() }) }
      } catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("vesc_fault_capture_read", error); throw error }
    }
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `readVescFaultLog`
     * @parity /modules/vescape-core/src/index.ts `readVescFaultLog`
     */
    AsyncFunction("readVescFaultLog") { boardId: String, promise: Promise ->
      mainHandler.post {
        CoreForegroundService.readVescFaultLog(
          boardId,
          onSuccess = { promise.resolve(it) },
          onError = { code, message -> promise.reject(code, message, null) },
        )
      }
    }
    registerBoardConfig()
    AsyncFunction("clearBoardWarning") Coroutine { boardId: String, kind: String ->
      RecordingStorageFailure.requireAvailable()
      try { BoardWarningRegistry.get(context).clearWarning(boardId, kind) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("board_warning_clear", "write_failed", error); throw error }
    }
    AsyncFunction("clearAllBoardWarnings") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { BoardWarningRegistry.get(context).clearAllWarnings(boardId) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("board_warnings_clear_all", "write_failed", error); throw error }
    }
    AsyncFunction("devInjectBoardWarning") Coroutine { boardId: String, kind: String, severity: String, payloadJson: String ->
      RecordingStorageFailure.requireAvailable()
      BoardWarningRegistry.get(context)
        .reportFinding(boardId, kind, BoardWarningSeverity.fromWire(severity), payloadJson)
    }
    AsyncFunction("devReportCleanBoardWarning") Coroutine { boardId: String, kind: String ->
      RecordingStorageFailure.requireAvailable()
      BoardWarningRegistry.get(context).reportCleanEvaluation(boardId, kind)
    }
    AsyncFunction("clearDiagnosticEvents") {
      RecordingStorageFailure.requireAvailable()
      runBlocking { TelemetryRepository.get(context.applicationContext).clearDiagnosticEvents() }
    }
    AsyncFunction("getDatabaseSizeBytes") { promise: Promise ->
      RecordingStorageFailure.requireAvailable()
      val dbFile = context.applicationContext.getDatabasePath(DATABASE_NAME)
      try {
        promise.resolve(VescapeDatabase.databaseSizeBytes(dbFile))
      } catch (error: Exception) {
        RecordingStorageFailure.reportRead("database_size_read", error)
        promise.reject("APP_STORAGE_READ_FAILED", "Could not read database size", error)
      }
    }
    AsyncFunction("backupDatabase") { promise: Promise ->
      RecordingStorageFailure.requireAvailable()
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(DatabaseBackupManager.createBackup(context.applicationContext))
        } catch (e: Exception) {
          promise.reject("ERR_BACKUP_DATABASE", e.message, e)
        }
      }
    }
    AsyncFunction("restoreDatabase") Coroutine { uri: String ->
      stopNativeWorkForDatabaseRestore()
      try {
        DatabaseBackupManager.restoreBackup(context.applicationContext, uri)
      } finally {
        MaintenanceRunner.onDatabaseReplaced()
      }
      WatchLastBatteryPusher.push(context)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshBoardConfigValues`
    // @parity /modules/vescape-core/src/index.ts `refreshBoardConfigValues`
    AsyncFunction("refreshBoardConfigValues") { promise: Promise ->
      CoreForegroundService.refreshBoardConfigValues(
        onSuccess = { values -> promise.resolve(values) },
        onError = { code, message -> promise.reject(code, message, null) },
      )
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `setRemoteTilt`
    AsyncFunction("setRemoteTilt") { value: Int ->
      CoreForegroundService.setRemoteTilt(value)
    }.runOnQueue(Queues.MAIN)
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `lockRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `lockRemoteTilt`
    AsyncFunction("lockRemoteTilt") { value: Int ->
      CoreForegroundService.lockRemoteTilt(value)
    }.runOnQueue(Queues.MAIN)
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `releaseRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `releaseRemoteTilt`
    AsyncFunction("releaseRemoteTilt") { value: Int, durationMs: Int ->
      CoreForegroundService.releaseRemoteTilt(value, durationMs.toLong())
    }.runOnQueue(Queues.MAIN)
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `stopRemoteTilt`
    // @parity /modules/vescape-core/src/index.ts `stopRemoteTilt`
    AsyncFunction("stopRemoteTilt") {
      CoreForegroundService.stopRemoteTilt()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setBoardLights") { enabled: Boolean, headlightsEnabled: Boolean ->
      CoreForegroundService.setBoardLights(enabled, headlightsEnabled)
    }
    AsyncFunction("startBoardMove") { input: Int ->
      CoreForegroundService.startBoardMove(input)
    }
    AsyncFunction("stopBoardMove") {
      CoreForegroundService.stopBoardMove()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `applyBoardConfigChangeset`
    // @parity /modules/vescape-core/src/index.ts `applyBoardConfigChangeset`
    AsyncFunction("applyBoardConfigChangeset") { boardId: String, changes: Map<String, Any?>, promise: Promise ->
      CoreForegroundService.applyBoardConfigChangeset(
        boardId,
        changes,
        onSuccess = { snapshot -> promise.resolve(snapshot) },
        onError = { code, message -> promise.reject(code, message, null) },
      )
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `pushProfileToBoard`
    // @parity /modules/vescape-core/src/index.ts `pushProfileToBoard`
    AsyncFunction("pushProfileToBoard") { profileId: String, promise: Promise ->
      RecordingStorageFailure.requireAvailable()
      CoreForegroundService.pushProfileToBoard(
        profileId,
        onSuccess = { snapshot -> promise.resolve(snapshot) },
        onError = { code, message -> promise.reject(code, message, null) },
      )
    }
    AsyncFunction("getTuneProfiles") Coroutine { boardId: String, refloatBaseVersion: String? ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).getTuneProfiles(boardId, refloatBaseVersion) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.reportRead("tune_profiles_read", error); throw error }
    }
    AsyncFunction("getTuneProfile") Coroutine { profileId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).getTuneProfile(profileId) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.reportRead("tune_profile_read", error); throw error }
    }
    AsyncFunction("createProfile") Coroutine { boardId: String, name: String, icon: String, color: String, fields: Map<String, Any?>, refloatBaseVersion: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).createProfile(boardId, name, icon, color, fields, refloatBaseVersion) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { if (error !is IllegalArgumentException && error !is IllegalStateException) RecordingStorageFailure.report("tune_profile_create", "write_failed", error); throw error }
    }
    AsyncFunction("renameProfile") Coroutine { profileId: String, name: String, icon: String, color: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).renameProfile(profileId, name, icon, color) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { if (error !is IllegalArgumentException && error !is IllegalStateException) RecordingStorageFailure.report("tune_profile_rename", "write_failed", error); throw error }
    }
    AsyncFunction("deleteProfile") Coroutine { profileId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).deleteProfile(profileId) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { if (error !is IllegalArgumentException && error !is IllegalStateException) RecordingStorageFailure.report("tune_profile_delete", "write_failed", error); throw error }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getBoardConfigRevisions`
    // @parity /modules/vescape-core/src/index.ts `getBoardConfigRevisions`
    AsyncFunction("getBoardConfigRevisions") Coroutine { boardId: String, limit: Int? ->
      RecordingStorageFailure.requireAvailable()
      try {
        AppDataRepository.get(context.applicationContext)
          .getBoardConfigRevisions(boardId, limit ?: ConfigPersistence.DEFAULT_REVISIONS_LIMIT)
      }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.reportRead("board_config_revisions_read", error); throw error }
    }
    AsyncFunction("copyProfileToBoard") Coroutine { profileId: String, targetBoardId: String, newName: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).copyProfileToBoard(profileId, targetBoardId, newName) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { if (error !is IllegalArgumentException && error !is IllegalStateException) RecordingStorageFailure.report("tune_profile_copy", "write_failed", error); throw error }
    }
    AsyncFunction("saveProfile") Coroutine { profileId: String, fields: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).saveProfile(profileId, fields) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { if (error !is IllegalArgumentException && error !is IllegalStateException) RecordingStorageFailure.report("tune_profile_save", "write_failed", error); throw error }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getProfileStatsSnapshot`
    AsyncFunction("getProfileStatsSnapshot") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try {
        ProfileStatsRepository.get(context.applicationContext).getProfileStatsSnapshot(options)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("profile_stats_read", error)
        throw CodedException("ERR_PROFILE_STATS_READ", "Could not load profile stats", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getDayStats`
    AsyncFunction("getDayStats") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try {
        ProfileStatsRepository.get(context.applicationContext).getDayStats(options)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("day_stats_read", error)
        throw CodedException("ERR_PROFILE_STATS_READ", "Could not load day stats", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRecentRideStats`
    AsyncFunction("getRecentRideStats") Coroutine { sinceMs: Double ->
      RecordingStorageFailure.requireAvailable()
      try {
        ProfileStatsRepository.get(context.applicationContext).getRecentRideStats(sinceMs.toLong())
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("recent_stats_read", error)
        throw CodedException("ERR_PROFILE_STATS_READ", "Could not load recent ride stats", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFavorites`
    AsyncFunction("getFavorites") Coroutine { ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).getFavorites() }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.reportRead("favorites_read", error)
        throw CodedException("ERR_FAVORITES_READ", "Could not load Favorites", error)
      }
    }
    AsyncFunction("createFavorite") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      val favorite = try {
        TelemetryRepository.get(context.applicationContext).createFavorite(options)
      } catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.report("favorite_create", "write_failed", error)
        throw CodedException("ERR_CREATE_FAVORITE", "Favorite could not be stored", error)
      }
      favorite ?: throw CodedException("ERR_CREATE_FAVORITE", "favorite range is invalid", null)
    }
    AsyncFunction("updateFavorite") Coroutine { id: String, options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      val favorite = try {
        TelemetryRepository.get(context.applicationContext).updateFavorite(id, options)
      } catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.report("favorite_update", "write_failed", error)
        throw CodedException("ERR_UPDATE_FAVORITE", "Favorite could not be stored", error)
      }
      favorite ?: throw CodedException("ERR_UPDATE_FAVORITE", "Favorite does not exist or range is invalid", null)
    }
    AsyncFunction("deleteFavorite") Coroutine { id: String ->
      RecordingStorageFailure.requireAvailable()
      val deleted = try {
        TelemetryRepository.get(context.applicationContext).deleteFavorite(id)
      } catch (error: CancellationException) { throw error }
      catch (error: FavoriteMediaCleanupException) {
        // @parity /src/modules/history/store/favoriteStore.ts `FAVORITE_MEDIA_CLEANUP_ERROR`
        UnexpectedNativeError.report("favorite_media_delete", "file_delete_failed", error)
        throw CodedException("ERR_DELETE_FAVORITE_MEDIA_CLEANUP", "Favorite deleted but its media could not be removed", error)
      }
      catch (error: Throwable) {
        RecordingStorageFailure.report("favorite_delete", "write_failed", error)
        throw CodedException("ERR_DELETE_FAVORITE", "Favorite could not be deleted", error)
      }
      if (!deleted) throw CodedException("ERR_DELETE_FAVORITE", "Favorite does not exist", null)
      true
    }
    AsyncFunction("getFavoriteMedia") Coroutine { favoriteId: String ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).getFavoriteMedia(favoriteId) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.reportRead("favorite_media_read", error)
        throw CodedException("ERR_FAVORITE_MEDIA_READ", "Could not load Favorite Media", error)
      }
    }
    AsyncFunction("importFavoriteMedia") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { TelemetryRepository.get(context.applicationContext).importFavoriteMedia(options) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.report("favorite_media_import", "write_failed", error)
        throw CodedException("ERR_IMPORT_FAVORITE_MEDIA", "Could not save Favorite Media", error)
      }
    }
    AsyncFunction("deleteTelemetryBefore") Coroutine { beforeMs: Double ->
      RecordingStorageFailure.requireAvailable()
      TelemetryRepository.get(context.applicationContext).deleteBefore(beforeMs.toLong())
    }
    AsyncFunction("deleteTelemetryRange") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      TelemetryRepository.get(context.applicationContext).deleteRange(options)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getMaintenanceState`
    // @parity /modules/vescape-core/src/index.ts `getMaintenanceState`
    Function("getMaintenanceState") { MaintenanceRunner.snapshot() }
    AsyncFunction("clearTelemetryHistory") {
      RecordingStorageFailure.requireAvailable()
      try {
        runBlocking { TelemetryRepository.get(context.applicationContext).clearAll() }
      } finally {
        MaintenanceRunner.onDatabaseReplaced()
      }
    }
    AsyncFunction("getBoards") {
      RecordingStorageFailure.requireAvailable()
      try {
        runBlocking { AppDataRepository.get(context.applicationContext).getBoards() }
      } catch (error: Exception) {
        RecordingStorageFailure.reportRead("boards_read", error)
        throw error
      }
    }
    AsyncFunction("upsertBoard") Coroutine { board: Map<String, Any?>, initialAlerts: Map<String, Any?>? ->
      RecordingStorageFailure.requireAvailable()
      try {
        AppDataRepository.get(context.applicationContext).upsertBoard(board, initialAlerts)
        WatchLastBatteryPusher.push(context)
        CoreForegroundService.reloadAlertRules(context.applicationContext)
        CoreForegroundService.reloadBoardData()
        connectSavedBoardLink(board["id"] as? String)
      } catch (error: Exception) {
        RecordingStorageFailure.report("board_save", "write_failed", error)
        throw error
      }
    }
    AsyncFunction("deleteBoard") Coroutine { id: String ->
      RecordingStorageFailure.requireAvailable()
      try {
        AppDataRepository.get(context.applicationContext).deleteBoard(id)
        WatchLastBatteryPusher.push(context)
      } catch (error: Exception) {
        RecordingStorageFailure.report("board_delete", "write_failed", error)
        throw error
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `previewAlertPreset`
    // @parity /modules/vescape-core/src/index.ts `previewAlertPreset`
    Function("previewAlertPreset") { metric: String, spec: String, topSpeedKmh: Double, hasBatteryConfig: Boolean, distanceUnit: String ->
      AlertPresetPersistence.preview(metric, spec, topSpeedKmh, hasBatteryConfig, distanceUnit).map { rule ->
        mapOf(
          "id" to rule.id,
          "controlId" to rule.controlId,
          "threshold" to rule.threshold,
          "thresholdMax" to rule.thresholdMax,
          "spec" to rule.spec,
          "repeatEverySeconds" to rule.repeatEverySeconds,
        )
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `applyAlertPreset`
    // @parity /modules/vescape-core/src/index.ts `applyAlertPreset`
    AsyncFunction("applyAlertPreset") Coroutine { boardId: String, metric: String, level: String?, geiger: String?, match: Boolean? ->
      RecordingStorageFailure.requireAvailable()
      try {
        AppDataRepository.get(context.applicationContext).applyAlertPreset(boardId, metric, level, geiger, match)
        CoreForegroundService.reloadAlertRules(context.applicationContext)
      } catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.report("alert_preset_apply", "write_failed", error); throw error }
    }
    AsyncFunction("getAlertRules") { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { runBlocking { AppDataRepository.get(context.applicationContext).getAlertRules(boardId) } }
      catch (error: Throwable) { RecordingStorageFailure.reportRead("alert_rules_read", error); throw error }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getAlertPresets`
    // @parity /modules/vescape-core/src/index.ts `getAlertPresets`
    AsyncFunction("getAlertPresets") { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { runBlocking { AppDataRepository.get(context.applicationContext).getAlertPresets(boardId) } }
      catch (error: Throwable) { RecordingStorageFailure.reportRead("alert_rules_read", error); throw error }
    }
    AsyncFunction("upsertAlertRule") Coroutine { rule: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).upsertAlertRule(rule); CoreForegroundService.reloadAlertRules(context.applicationContext) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.report("alert_rule_save", "write_failed", error); throw error }
    }
    AsyncFunction("setAlertRuleEnabled") Coroutine { boardId: String, id: String, enabled: Boolean ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).setAlertRuleEnabled(boardId, id, enabled); CoreForegroundService.reloadAlertRules(context.applicationContext) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.report("alert_rule_enable", "write_failed", error); throw error }
    }
    AsyncFunction("deleteAlertRule") Coroutine { boardId: String, id: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context.applicationContext).deleteAlertRule(boardId, id); CoreForegroundService.reloadAlertRules(context.applicationContext) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) { RecordingStorageFailure.report("alert_rule_delete", "write_failed", error); throw error }
    }
    AsyncFunction("getPrivacyZones") {
      RecordingStorageFailure.requireAvailable()
      runBlocking { AppDataRepository.get(context.applicationContext).getPrivacyZones() }
    }
    AsyncFunction("upsertPrivacyZone") Coroutine { zone: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).upsertPrivacyZone(zone)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    AsyncFunction("setPrivacyZoneEnabled") Coroutine { id: String, enabled: Boolean ->
      RecordingStorageFailure.requireAvailable()
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).setPrivacyZoneEnabled(id, enabled)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    AsyncFunction("deletePrivacyZone") Coroutine { id: String ->
      RecordingStorageFailure.requireAvailable()
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).deletePrivacyZone(id)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    registerMapServices()
    AsyncFunction("setDirectionPoint") Coroutine { latitude: Double?, longitude: Double? ->
      RecordingStorageFailure.requireAvailable()
      val appCtx = context.applicationContext
      val repository = AppDataRepository.get(appCtx)
      try { repository.setDirectionPoint(latitude, longitude) }
      catch (error: CancellationException) { throw error }
      catch (error: Throwable) {
        RecordingStorageFailure.report("direction_point_save", "write_failed", error)
        throw error
      }
      CoreForegroundService.reloadGroupRideTarget(appCtx)

      val navigation = NavigationController.get(appCtx)
      if (latitude == null || longitude == null) {
        navigation.clear()
      } else {
        val origin = navigationOrigin(repository)
        navigation.setTarget(latitude, longitude, origin?.first, origin?.second)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `recomputeNavigation`
    // @parity /modules/vescape-core/src/index.ts `recomputeNavigation`
    AsyncFunction("recomputeNavigation") Coroutine { ->
      RecordingStorageFailure.requireAvailable()
      recomputeNavigation(context.applicationContext)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setNavigationProfile`
    // @parity /modules/vescape-core/src/index.ts `setNavigationProfile`
    AsyncFunction("setNavigationProfile") Coroutine { profile: String ->
      RecordingStorageFailure.requireAvailable()
      val appCtx = context.applicationContext
      NavigationController.get(appCtx).selectProfile(NavigationProfile.fromWire(profile))
      recomputeNavigation(appCtx)
    }
    AsyncFunction("getSettings") {
      RecordingStorageFailure.requireAvailable()
      try {
        runBlocking { AppDataRepository.get(context.applicationContext).getSettings() }
      } catch (error: Exception) {
        RecordingStorageFailure.reportRead("settings_read", error)
        throw error
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshLegalPolicy`
    // @parity /modules/vescape-core/src/index.ts `refreshLegalPolicy`
    AsyncFunction("refreshLegalPolicy") Coroutine { ->
      RecordingStorageFailure.requireAvailable()
      val repository = AppDataRepository.get(context.applicationContext)
      val settings = repository.getTypedSettings()
      val latitude = settings.lastGpsLatitude
      val longitude = settings.lastGpsLongitude
      val resolution = if (latitude != null && longitude != null) {
        legalPolicyResolver.resolve(latitude, longitude)
      } else {
        LegalPolicyResolution.Resolved(null)
      }
      if (resolution is LegalPolicyResolution.Unavailable) {
        throw IllegalStateException("Could not resolve Legal Policy")
      }
      repository.updateLegalPolicy((resolution as LegalPolicyResolution.Resolved).countryCode)
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setLegalMode`
    // @parity /modules/vescape-core/src/index.ts `setLegalMode`
    AsyncFunction("setLegalMode") { boardId: String, enabled: Boolean, promise: Promise ->
      RecordingStorageFailure.requireAvailable()
      CoroutineScope(Dispatchers.IO).launch {
        val repository = AppDataRepository.get(context.applicationContext)
        if (repository.getBoard(boardId) == null) {
          promise.reject("BOARD_NOT_FOUND", "Board not found: $boardId", null)
          return@launch
        }
        if (enabled) {
          CoreForegroundService.legalModeEnableError(boardId)?.let { (code, message) ->
            promise.reject(code, message, null)
            return@launch
          }
          val jurisdictionCode = repository.getTypedSettings().legalPolicy?.get("jurisdictionCode")
          if (jurisdictionCode == null || legalPolicyCatalog.speeds(jurisdictionCode) == null) {
            promise.reject("LEGAL_POLICY_UNRESOLVED", "Resolved Legal Policy required", null)
            return@launch
          }
        }
        repository.updateLegalMode(boardId, enabled)
        CoreForegroundService.reloadAlertRules(context.applicationContext)
        promise.resolve(null)
      }
    }
    AsyncFunction("updateSetting") Coroutine { key: String, value: Any? ->
      RecordingStorageFailure.requireAvailable()
      try {
        AppDataRepository.get(context.applicationContext).updateSetting(key, value)
      } catch (error: Exception) {
        RecordingStorageFailure.report("setting_save", "write_failed", error)
        throw error
      }
      if (key == "navigationRerouteDistanceMeters") {
        NavigationController.get(context.applicationContext).reloadRerouteDistance()
      }
      if (key == "distanceUnit") {
        CoreForegroundService.reloadAlertRules(context.applicationContext)
        val units = AppDataRepository.get(context.applicationContext).getTypedSettings().distanceUnit
        mainHandler.post { alertTestCoordinator?.distanceUnit = units }
      }
      if (key == "temperatureUnit") {
        val unit = AppDataRepository.get(context.applicationContext).getTypedSettings().temperatureUnit
        mainHandler.post { alertTestCoordinator?.temperatureUnit = unit }
      }
      if (key == "liveHistoryLimit") {
        CoreForegroundService.setLiveHistoryLimit(value as? Number)
      }
      MaintenanceRunner.onSettingChanged(key)
      if (
        key == "movingSpeedThresholdKmh" ||
        key == "avgSpeedCutoffKmh" ||
        key == "movingAvgSpeedThresholdKmh" ||
        key == "socEstimateWindowSeconds" ||
        key == "telemetryPollRateHz" ||
        key == "wearAutoLaunchOnConnect" ||
        key in WATCH_SOURCE_SETTING_KEYS ||
        key == "boardWarningsEnabled" ||
        key == "vescFaultCollectionEnabled" ||
        key == "connectionSoundsEnabled" ||
        key == "soundPack" ||
        key == "audioSource" ||
        key == "voice" ||
        key == "voiceLevel" ||
        key == "weatherRainAlertLevel" ||
        key == "weatherWindAlertLevel" ||
        key == "temperatureUnit" ||
        key == "autoCloseEnabled" ||
        key == "autoCloseDelayMinutes"
      ) {
        CoreForegroundService.reloadTelemetrySettings(context.applicationContext)
      }
    }
  }

  private fun ModuleDefinitionBuilder.registerBoardConfig() {
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getBoardConfigValues`
     * @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
     */
    AsyncFunction("getBoardConfigValues") {
      CoreForegroundService.getBoardConfigValues()
    }
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getMotorConfigValues`
     * @parity /modules/vescape-core/src/index.ts `MotorConfigValues`
     */
    AsyncFunction("getMotorConfigValues") {
      CoreForegroundService.getMotorConfigValues()
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getLastKnownMotorConfigValues`
     * @parity /modules/vescape-core/src/index.ts `MotorConfigValues`
     */
    AsyncFunction("getLastKnownMotorConfigValues") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).getLatestMotorConfigValues(boardId)?.toBridgeMap() }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("motor_config_latest_read", error); throw error }
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getLastKnownBoardConfigValues`
     * @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
     */
    AsyncFunction("getLastKnownBoardConfigValues") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).getLatestBoardConfigValues(boardId)?.toBridgeMap() }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("board_config_latest_read", error); throw error }
    }
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getBoardConfigSchema`
     * @parity /modules/vescape-core/src/index.ts `BoardConfigSchema`
     */
    AsyncFunction("getBoardConfigSchema") Coroutine { schemaHash: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).getBoardConfigSchema(schemaHash)?.toBridgeMap() }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("board_config_schema_read", error); throw error }
    }
    AsyncFunction("getBoardConfigChangeNotice") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).getBoardConfigChangeNotice(boardId)?.toMap() }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.reportRead("board_config_notice_read", error); throw error }
    }
    AsyncFunction("dismissBoardConfigChangeNotice") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).dismissBoardConfigChangeNotice(boardId) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("board_config_notice_dismiss", "write_failed", error); throw error }
    }
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setBoardConfigChangeFieldIgnored`
     * @parity /modules/vescape-core/src/index.ts `setBoardConfigChangeFieldIgnored`
     */
    AsyncFunction("setBoardConfigChangeFieldIgnored") Coroutine { boardId: String, fieldId: String, ignored: Boolean ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).setBoardConfigChangeFieldIgnored(boardId, fieldId, ignored) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("board_config_ignored_field_write", "write_failed", error); throw error }
    }
    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `clearIgnoredBoardConfigChangeFields`
     * @parity /modules/vescape-core/src/index.ts `clearIgnoredBoardConfigChangeFields`
     */
    AsyncFunction("clearIgnoredBoardConfigChangeFields") Coroutine { boardId: String ->
      RecordingStorageFailure.requireAvailable()
      try { AppDataRepository.get(context).clearIgnoredBoardConfigChangeFields(boardId) }
      catch (error: Throwable) { if (error is kotlinx.coroutines.CancellationException) throw error; RecordingStorageFailure.report("board_config_ignored_fields_clear", "write_failed", error); throw error }
    }
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRides`
   * @parity /modules/vescape-core/src/index.ts `exportRides`
   */
  private fun ModuleDefinitionBuilder.registerRideBatch() {
    AsyncFunction("exportRides") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      val app = context.applicationContext
      rideExportCancelled.set(false)
      try {
        @Suppress("UNCHECKED_CAST")
        val rides = RideHistoryRepository.get(app).selectedRides(options["selection"] as? Map<String, Any?> ?: emptyMap())
        TelemetryRepository.get(app).exportRides(rides, RideBatch.format(options["format"]), rideExportCancelled::get) { done, total ->
          mainHandler.post { sendEvent("onRideExportProgress", mapOf("done" to done, "total" to total)) }
        }
      } catch (error: RideBatch.Cancelled) { null }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_RIDE_EXPORT", "Could not export rides", error) }
    }
    Function("cancelRideExport") { rideExportCancelled.set(true) }
    AsyncFunction("deleteRides") Coroutine { selection: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      val app = context.applicationContext
      try { TelemetryRepository.get(app).deleteRides(RideHistoryRepository.get(app).selectedRides(selection)) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { throw CodedException("ERR_RIDE_DELETE", "Could not delete rides", error) }
    }
  }

  private fun ModuleDefinitionBuilder.registerRideHistory() {
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRideHistoryPage`
    AsyncFunction("getRideHistoryPage") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try {
        RideHistoryRepository.get(context.applicationContext).getPage(options)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_page_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride history", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `countRideHistory`
    AsyncFunction("countRideHistory") Coroutine { options: Map<String, Any?> ->
      RecordingStorageFailure.requireAvailable()
      try {
        RideHistoryRepository.get(context.applicationContext).countRides(options)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_count_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not count ride history", error)
      }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRideSession`
    AsyncFunction("getRideSession") Coroutine { id: String ->
      RecordingStorageFailure.requireAvailable()
      try {
        RideHistoryRepository.get(context.applicationContext).getSession(id)
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) {
        RecordingStorageFailure.reportRead("history_session_read", error)
        throw CodedException("ERR_HISTORY_READ", "Could not load ride", error)
      }
    }
  }

  private fun ModuleDefinitionBuilder.registerMapServices() {
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getNearbyMapPoints`
    AsyncFunction("getNearbyMapPoints") Coroutine { latitude: Double, longitude: Double, radiusMeters: Int ->
      MapPointApi.get(context.applicationContext).nearby(latitude, longitude, radiusMeters)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `searchMap`
    AsyncFunction("searchMap") Coroutine { query: String, limit: Int, proximity: String? ->
      MapSearchApi.get(context.applicationContext).search(query, limit, proximity)
    }
    AsyncFunction("reverseGeocodeMap") Coroutine { latitude: Double, longitude: Double ->
      MapSearchApi.get(context.applicationContext).reverse(latitude, longitude)
    }
    AsyncFunction("createMapPoint") Coroutine { values: Map<String, Any?> ->
      MapPointApi.get(context.applicationContext).create(values)
    }
    AsyncFunction("updateMapPoint") Coroutine { id: String, patch: Map<String, Any?> ->
      MapPointApi.get(context.applicationContext).update(id, patch)
    }
    AsyncFunction("deleteMapPoint") Coroutine { id: String ->
      MapPointApi.get(context.applicationContext).delete(id)
    }
    AsyncFunction("setMapPointReaction") Coroutine { id: String, reaction: String? ->
      MapPointApi.get(context.applicationContext).setReaction(id, reaction)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRiderProfile`
    AsyncFunction("getRiderProfile") Coroutine { ->
      RiderProfileApi.get(context.applicationContext).mine()
    }
    AsyncFunction("saveRiderProfile") Coroutine { nick: String, nationality: String? ->
      RiderProfileApi.get(context.applicationContext).save(nick, nationality)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFriends`
    AsyncFunction("searchRiders") Coroutine { nick: String ->
      RiderProfileApi.get(context.applicationContext).search(nick)
    }
    AsyncFunction("getRider") Coroutine { accountId: String ->
      RiderProfileApi.get(context.applicationContext).rider(accountId)
    }
    AsyncFunction("getFriends") Coroutine { ->
      RiderProfileApi.get(context.applicationContext).friends()
    }
    AsyncFunction("sendFriendRequest") Coroutine { accountId: String ->
      RiderProfileApi.get(context.applicationContext).requestFriend(accountId)
    }
    AsyncFunction("acceptFriendRequest") Coroutine { accountId: String ->
      RiderProfileApi.get(context.applicationContext).acceptFriend(accountId)
    }
    AsyncFunction("deleteFriendRequest") Coroutine { accountId: String ->
      RiderProfileApi.get(context.applicationContext).deleteFriendRequest(accountId)
    }
    AsyncFunction("removeFriend") Coroutine { accountId: String ->
      RiderProfileApi.get(context.applicationContext).removeFriend(accountId)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRodeWith`
    AsyncFunction("getRodeWith") Coroutine { from: String, to: String ->
      RiderProfileApi.get(context.applicationContext).rodeWith(from, to)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFriendRides`
    // @parity /modules/vescape-core/src/index.ts `getFriendRides`
    AsyncFunction("getFriendRides") Coroutine { accountId: String, limit: Int?, before: String? ->
      RiderProfileApi.get(context.applicationContext).friendRides(accountId, limit, before)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFriendRideTrack`
    AsyncFunction("getFriendRideTrack") Coroutine { accountId: String, from: String, to: String ->
      RiderProfileApi.get(context.applicationContext).friendRideTrack(accountId, from, to)
    }
  }

  private fun ModuleDefinitionBuilder.registerGroupRide() {
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `startGroupRideObserve`
    Function("startGroupRideObserve") { serverUrl: String ->
      CoreForegroundService.startGroupRideObserve(context.applicationContext, serverUrl)
    }
    Function("stopGroupRideObserve") {
      CoreForegroundService.stopGroupRideObserve()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `dismissRideNotice`
    Function("getRideNotices") { RideNotices.current.map { it.toMap() } }
    Function("dismissRideNotice") { id: Int, rev: Int -> RideNotices.dismiss(id, rev) }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `devPostRideNotice`
    // @parity /modules/vescape-core/src/index.ts `DevRideNoticeParams`
    Function("devPostRideNotice") { notice: Map<String, Any?> ->
      val severity = RideNoticeSeverity.fromWire(notice["severity"] as? String)
        ?: throw IllegalArgumentException("Unknown Ride Notice severity")
      val lat = (notice["lat"] as? Number)?.toDouble()
      val lng = (notice["lng"] as? Number)?.toDouble()
      RideNotices.post(
        key = notice["key"] as String,
        content = RideNoticeContent(
          severity = severity,
          title = notice["title"] as String,
          details = notice["details"] as String,
          postedAt = (notice["postedAt"] as Number).toLong(),
          location = if (lat != null && lng != null) RideNoticeLocation(lat, lng) else null,
          expiresAt = (notice["expiresAt"] as? Number)?.toLong(),
        ),
        revision = notice["revision"] as String,
      )
    }
    Function("devClearRideNotice") { key: String -> RideNotices.clear(key) }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendGroupRideSignal`
    Function("sendGroupRideSignal") { kind: String ->
      CoreForegroundService.sendGroupRideSignal(kind)
    }
    Function("clearGroupRideSignal") {
      CoreForegroundService.clearGroupRideSignal()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendGroupRideHazard`
    Function("sendGroupRideHazard") { kind: String ->
      CoreForegroundService.sendGroupRideHazard(kind)
    }
    Function("clearGroupRideHazard") {
      CoreForegroundService.clearGroupRideHazard()
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setPublicRide`
    Function("setPublicRide") { on: Boolean, until: Double? ->
      CoreForegroundService.setPublicRide(on, until?.toLong())
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setManualPublicRideSharing`
    // @parity /modules/vescape-core/src/index.ts `setManualPublicRideSharing`
    Function("setManualPublicRideSharing") { enabled: Boolean ->
      CoreForegroundService.setManualPublicRideSharing(enabled)
    }
    Function("watchPublicRiders") {
      CoreForegroundService.watchPublicRiders()
    }
    Function("stopWatchingPublicRiders") {
      CoreForegroundService.stopWatchingPublicRiders()
    }
  }

  private fun ModuleDefinitionBuilder.registerMySounds() {
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `mySounds`
    AsyncFunction("mySounds") { MySounds.state(context.applicationContext) }
    AsyncFunction("importMySound") { uri: String, name: String -> MySounds.import(context.applicationContext, uri, name) }
    AsyncFunction("renameMySound") { id: String, name: String -> MySounds.rename(context.applicationContext, id, name) }
    AsyncFunction("deleteMySound") { id: String -> MySounds.delete(context.applicationContext, id) }
    AsyncFunction("setSoundOverride") { slot: String, id: String? -> MySounds.setOverride(context.applicationContext, slot, id) }
  }

  private fun startAlertTest(ruleMaps: List<Map<String, Any?>>) {
    stopAlertTest()
    val rules = ruleMaps.mapNotNull { it.toAlertTestRule() }
    val controlId = rules.firstOrNull()?.controlId ?: return
    if (rules.any { it.controlId != controlId }) return

    val feedback = AlertFeedback(context.applicationContext, mainHandler)
    val settings = kotlinx.coroutines.runBlocking { AppDataRepository.get(context.applicationContext).getTypedSettings() }
    feedback.setSoundSettings(settings)
    val coordinator = AlertCoordinator(feedback = { feedback }, vibrateSingles = false)
    coordinator.distanceUnit = settings.distanceUnit
    coordinator.temperatureUnit = settings.temperatureUnit
    coordinator.replaceRules(rules)
    alertTestFeedback = feedback
    alertTestCoordinator = coordinator
    alertTestControlId = controlId
  }

  private fun stopAlertTest() {
    alertTestCoordinator?.stopAllGeiger()
    alertTestCoordinator = null
    alertTestControlId = null
    alertTestFeedback?.release()
    alertTestFeedback = null
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `emitMaintenanceState`
   */
  private fun emitMaintenanceState(state: Map<String, Any?>) {
    if (!shouldEmitToFrontend("onMaintenanceState")) return
    mainHandler.post {
      if (shouldEmitToFrontend("onMaintenanceState")) sendEvent("onMaintenanceState", state)
    }
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `emitRideNotices`
   * @parity /modules/vescape-core/src/index.ts `RideNoticesEvent`
   */
  private fun emitRideNotices(notices: List<RideNotice>) {
    if (!shouldEmitToFrontend("onRideNotices")) return
    val body = mapOf("notices" to notices.map { it.toMap() })
    mainHandler.post { if (shouldEmitToFrontend("onRideNotices")) sendEvent("onRideNotices", body) }
  }

  private fun shouldEmitToFrontend(name: String): Boolean = frontendActive && observedEvents.contains(name)

  private fun startObserving(name: String) {
    observedEvents.add(name)
  }

  private fun stopObserving(name: String) {
    observedEvents.remove(name)
  }

  private val eventListener: (String, Map<String, Any?>) -> Unit = { name, body ->
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendAppDataChanged`
    if (name == "onAppDataChanged") {
      mainHandler.post { sendEvent(name, body) }
    } else if (shouldEmitToFrontend(name)) {
      mainHandler.post {
        if (shouldEmitToFrontend(name)) sendEvent(name, body)
      }
    }
  }

  private val liveStatePostPending = AtomicBoolean(false)

  private val liveStateListener: () -> Unit = {
    if (shouldEmitToFrontend("onLiveState") && liveStatePostPending.compareAndSet(false, true)) {
      mainHandler.post {
        liveStatePostPending.set(false)
        val ctx = appContext.reactContext?.applicationContext ?: return@post
        if (shouldEmitToFrontend("onLiveState")) {
          val state = CoreForegroundService.currentLiveState(ctx, includeRecent = false)
          sendEvent("onLiveState", liveStateWithScan(state))
        }
      }
    }
  }

  private fun postLiveState(build: () -> Map<String, Any?>) {
    if (!shouldEmitToFrontend("onLiveState")) return
    mainHandler.post {
      if (shouldEmitToFrontend("onLiveState")) sendEvent("onLiveState", liveStateWithScan(build()))
    }
  }

  private fun liveStateWithScan(state: Map<String, Any?>): Map<String, Any?> {
    return state + mapOf(
      "scan" to mapOf(
        "phase" to scanStatus,
        "devices" to emptyList<Map<String, Any?>>(),
        "error" to null,
      ),
    )
  }

  private suspend fun stopNativeWorkForDatabaseRestore() {
    stopScanInternal()
    val stopped = CompletableDeferred<Unit>()
    CoreForegroundService.stopBoardSession(context.applicationContext) {
      stopped.complete(Unit)
    }
    stopped.await()
    CoreForegroundService.stopGpsMonitoring(context.applicationContext)
  }

  private fun startScan(resetRetries: Boolean = true) {
    if (resetRetries) {
      scanRetryCount = 0
    }
    stopScanInternal()

    val s = btAdapter.bluetoothLeScanner ?: run {
      scanStatus = "error"
      sendEvent("onError", mapOf("message" to "BLE scanner unavailable (BT off?)"))
      return
    }

    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val device = result.device
        val name = result.scanRecord?.deviceName ?: device.name ?: ""
        val serviceUUIDs = result.scanRecord?.serviceUuids
          ?.map { it.uuid.toString() }
          ?: emptyList()

        sendEvent("onDevice", mapOf(
          "id" to device.address,
          "name" to name,
          "rssi" to result.rssi,
          "serviceUUIDs" to serviceUUIDs,
        ))
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
      }

      override fun onScanFailed(errorCode: Int) {
        Log.e(TAG, "Scan failed errorCode=$errorCode")
        scanner = null
        scanCallback = null
        scanStatus = "error"

        if (
          errorCode == ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED &&
          scanRetryCount < SCAN_RETRY_LIMIT
        ) {
          scanRetryCount += 1
          val delayMs = 750L * scanRetryCount
          Log.w(TAG, "Retrying scan after registration failure in ${delayMs}ms")
          val retry = Runnable {
            scanRetryRunnable = null
            startScan(resetRetries = false)
          }
          scanRetryRunnable = retry
          mainHandler.postDelayed(retry, delayMs)
          return
        }

        sendEvent("onError", mapOf("message" to "Scan failed: $errorCode"))
      }
    }

    s.startScan(
      null,
      ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
        .build(),
      cb,
    )

    scanner = s
    scanCallback = cb
    scanStatus = "scanning"
    Log.d(TAG, "scan started")
  }

  private fun stopScanInternal() {
    scanRetryRunnable?.let { mainHandler.removeCallbacks(it) }
    scanRetryRunnable = null
    try {
      scanner?.stopScan(scanCallback)
    } catch (e: Exception) {
      Log.w(TAG, "stopScan failed: ${e.message}")
    }
    scanner = null
    scanCallback = null
    scanStatus = "idle"
  }

  private fun refreshLocationDemand() {
    val hasFine = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    if (!hasFine) {
      sendEvent("onError", mapOf("message" to "Location permission not granted"))
      return
    }
    CoreForegroundService.startGpsMonitoring(context.applicationContext)
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `connectSavedBoardLink`
   */
  private suspend fun connectSavedBoardLink(boardId: String?) {
    if (boardId == null || !PendingLinkConnect.consume(boardId)) return
    if (BoardProbeAutoStartGate.isActive()) return
    val appCtx = context.applicationContext
    ManualDisconnectAutoStartGate.clear(appCtx)
    val config = try {
      buildSessionConfig(appCtx, boardId, requestedDebugRecordingEnabled)
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (error: Throwable) {
      Log.w(TAG, "Board Link saved but session config failed: ${error.message}")
      return
    }
    CoreForegroundService.startBoardSession(
      appCtx,
      config,
      onSuccess = {},
      onError = { _, message -> sendEvent("onError", mapOf("message" to message)) },
    )
  }

  private suspend fun selectBoard(boardId: String) {
    val appCtx = context.applicationContext
    try {
      AppDataRepository.get(appCtx).setSelectedBoardId(boardId)
    } catch (error: Exception) {
      RecordingStorageFailure.report("setting_save", "write_failed", error)
      throw error
    }
    WatchLastBatteryPusher.push(appCtx)
    ManualDisconnectAutoStartGate.clear(appCtx)
    companionPresence.refreshForSelectedBoard()
    val config = buildSessionConfig(appCtx, boardId, requestedDebugRecordingEnabled)
    CoreForegroundService.startBoardSession(
      appCtx,
      config,
      onSuccess = {},
      onError = { _, message ->
        sendEvent("onError", mapOf("message" to message))
      },
    )
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `startDebugReplay`
   * @parity /modules/vescape-core/src/index.ts `DebugReplayOptions`
   */
  private suspend fun startDebugReplay(name: String, options: Map<String, Any?>?, promise: Promise) {
    val appCtx = context.applicationContext
    val boardId = AppDataRepository.get(appCtx).getTypedSettings().selectedBoardId
    if (boardId == null) {
      promise.reject("ERR_NO_BOARD", "Replay runs as the selected Board: select one first", null)
      return
    }
    val recording = ReplayRecording.parse(name, ReplayRecordings.read(appCtx, name))
    val config = buildSessionConfig(appCtx, boardId, recordingEnabled = false, hardware = recording.hardware)
      .copy(
        replay = ReplaySpec(
          recording = recording,
          warmupMs = ((options?.get("warmupMs") as? Number)?.toLong() ?: 0L).coerceIn(0L, recording.durationMs),
          loop = options?.get("loop") as? Boolean ?: false,
        ),
      )
    CoreForegroundService.startBoardSession(
      appCtx,
      config,
      onSuccess = { promise.resolve(null) },
      onError = { code, message -> promise.reject(code, message, null) },
    )
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `debugReplayStateMap`
   */
  private fun debugReplayStateMap(control: (SimulatedBoard) -> Unit): Map<String, Any?>? {
    val read = FutureTask {
      CoreForegroundService.replayPlayback()?.let { board ->
        control(board)
        val state = board.state()
        mapOf(
          "recording" to state.recording,
          "positionMs" to state.positionMs,
          "durationMs" to state.durationMs,
          "paused" to state.paused,
          "loop" to state.loop,
          "linked" to state.linked,
        )
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) read.run() else Handler(Looper.getMainLooper()).post(read)
    return read.get()
  }

  private suspend fun probeBoardLink(bleId: String, probeId: String): Map<String, Any?> {
    if (bleId.isBlank()) {
      throw IllegalArgumentException("Board Probe needs a BLE peripheral id")
    }
    if (probeId.isBlank()) {
      throw IllegalArgumentException("Board Probe needs a probe id")
    }
    val appCtx = context.applicationContext

    cancelActiveProbe(null, "replaced")
    BoardProbeAutoStartGate.enter()

    try {
      val stopped = CompletableDeferred<Unit>()
      CoreForegroundService.stopBoardSession(appCtx) { stopped.complete(Unit) }
      stopped.await()

      val device = btAdapter.getRemoteDevice(bleId)
      val result = CompletableDeferred<TransportDetection.Result>()
      val active = ActiveBoardProbe(probeId, result)
      activeProbe = active
      mainHandler.post {
        if (activeProbe !== active) return@post
        val detector = BoardTransportDetector(
          context = appCtx,
          handler = mainHandler,
          probeId = probeId,
          device = device,
          recordDiagnostic = { name, props ->
            TelemetryRepository.get(appCtx).recordDiagnosticEvent(name, props)
          },
          onProgress = { progress ->
            if (activeProbe === active) sendEvent("onBoardProbeProgress", progress)
          },
          onComplete = {
            if (activeProbe === active) {
              activeProbe = null
              completedProbes[probeId] = it
              result.complete(it)
            }
          },
          onError = { code, message ->
            if (activeProbe === active) {
              activeProbe = null
              result.completeExceptionally(IllegalStateException("$code: $message"))
            }
          },
        )
        active.detector = detector
        detector.start()
      }
      return probeResultToBridge(result.await())
    } catch (error: Throwable) {
      completedProbes.remove(probeId)
      throw error
    } finally {
      BoardProbeAutoStartGate.leave()
    }
  }

  private fun cancelActiveProbe(probeId: String?, reason: String) {
    PendingLinkConnect.clear()
    if (probeId != null) completedProbes.remove(probeId)
    val active = activeProbe ?: return
    if (probeId != null && active.id != probeId) return
    activeProbe = null
    active.detector?.cancel(reason)
    active.result.completeExceptionally(IllegalStateException("PROBE_CANCELLED: Board Probe cancelled"))
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `finalizeBoardLink`
   * @parity /modules/vescape-core/src/index.ts `finalizeBoardLink`
   */
  private suspend fun finalizeBoardLink(
    probeId: String,
    boardId: String,
    bleId: String,
    rawCandidate: Map<String, Any?>,
  ): Map<String, Any?> {
    val result = completedProbes[probeId] ?: error("PROBE_NOT_FOUND: Board Probe is no longer finalizable")
    val transport = BoardTransport.fromBridge(rawCandidate["transport"])
      ?: error("PROBE_CANDIDATE_INVALID: Invalid Board Transport")
    val candidate = result.candidates.firstOrNull { it.transport == transport }
      ?: error("PROBE_CANDIDATE_UNVERIFIED: Candidate was not confirmed by this Board Probe")
    val baseVersion = candidate.refloatBaseVersion
      ?: error("PROBE_CONFIG_IDENTITY_MISSING: Refloat Tune Compatibility is required")
    sendEvent("onBoardProbeProgress", mapOf("probeId" to probeId, "step" to "session", "elapsedMs" to 0, "transport" to BoardTransport.toBridge(transport)))
    val appCtx = context.applicationContext
    val repo = AppDataRepository.get(appCtx)
    val previousCapturedAt = repo.getBoardConfigValues(boardId, baseVersion)?.capturedAtMs ?: Long.MIN_VALUE
    val previousMotorCapturedAt = repo.getLatestMotorConfigValues(boardId)?.capturedAtMs ?: Long.MIN_VALUE
    val connected = CompletableDeferred<Unit>()
    CoreForegroundService.startBoardSession(
      appCtx,
      SessionConfig(
        appBoardId = boardId,
        deviceId = bleId,
        deviceName = "Board Probe",
        transport = transport,
        linkVersion = 4,
        hasBms = candidate.hasBms,
        vescFirmwareVersion = candidate.vescFirmwareVersion,
        refloatVersion = candidate.refloatVersion,
        refloatBaseVersion = baseVersion,
        pollIntervalMs = 100,
        recordingEnabled = false,
        telemetryRecordingEnabled = false,
        autoReconnect = false,
      ),
      onSuccess = { connected.complete(Unit) },
      onError = { code, message -> connected.completeExceptionally(IllegalStateException("$code: $message")) },
    )
    try {
      connected.await()
      sendEvent("onBoardProbeProgress", mapOf("probeId" to probeId, "step" to "config", "elapsedMs" to 0, "transport" to BoardTransport.toBridge(transport)))
      if (!awaitUntil(120) { (repo.getBoardConfigValues(boardId, baseVersion)?.capturedAtMs ?: Long.MIN_VALUE) > previousCapturedAt }) {
        error("PROBE_CONFIG_TIMEOUT: Full Refloat config was not acquired")
      }
      sendEvent("onBoardProbeProgress", mapOf("probeId" to probeId, "step" to "motor-config", "elapsedMs" to 0, "transport" to BoardTransport.toBridge(transport)))
      if (!awaitUntil(80) { (repo.getLatestMotorConfigValues(boardId)?.capturedAtMs ?: Long.MIN_VALUE) > previousMotorCapturedAt }) {
        error("PROBE_MOTOR_CONFIG_TIMEOUT: VESC motor config was not acquired — this firmware may not be supported yet")
      }
      PendingLinkConnect.arm(boardId)
      return mapOf(
        "linkVersion" to 4,
        "bleId" to bleId,
        "transport" to BoardTransport.toBridge(transport),
        "hasBms" to candidate.hasBms,
        "vescFirmwareVersion" to candidate.vescFirmwareVersion,
        "refloatVersion" to candidate.refloatVersion,
        "refloatBaseVersion" to baseVersion,
      )
    } finally {
      val stopped = CompletableDeferred<Unit>()
      CoreForegroundService.stopBoardSession(appCtx) { stopped.complete(Unit) }
      stopped.await()
    }
  }

  private suspend fun awaitUntil(attempts: Int, condition: suspend () -> Boolean): Boolean {
    repeat(attempts) {
      if (condition()) return true
      delay(250)
    }
    return false
  }

  private fun probeResultToBridge(result: TransportDetection.Result): Map<String, Any?> {
    val candidates = result.candidates.map {
      mapOf(
        "transport" to BoardTransport.toBridge(it.transport),
        "hasBms" to it.hasBms,
        "vescFirmwareVersion" to it.vescFirmwareVersion,
        "refloatVersion" to it.refloatVersion,
        "refloatBaseVersion" to it.refloatBaseVersion,
      )
    }
    val outcome = when (result.outcome) {
      is TransportDetection.Outcome.Resolved -> "resolved"
      is TransportDetection.Outcome.NeedsPick -> "needs-pick"
      TransportDetection.Outcome.None -> "none"
    }
    return mapOf(
      "outcome" to outcome,
      "transport" to BoardTransport.toBridge(result.resolvedTransport),
      "candidates" to candidates,
    )
  }

  private fun stopBoardSession(promise: Promise) {
    CoreForegroundService.stopBoardSession(context.applicationContext) {
      promise.resolve(null)
    }
  }

  private suspend fun recomputeNavigation(appContext: Context) {
    val repository = AppDataRepository.get(appContext)
    val directionPoint = repository.getDirectionPoint() ?: return
    val origin = navigationOrigin(repository)
    NavigationController.get(appContext).recompute(
      directionPoint.first,
      directionPoint.second,
      origin?.first,
      origin?.second,
    )
  }

  /**
   * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `navigationOrigin`
   */
  private suspend fun navigationOrigin(repository: AppDataRepository): Pair<Double, Double>? {
    CoreForegroundService.currentRiderPosition()?.let { return it.latitude to it.longitude }
    val settings = repository.getTypedSettings()
    val latitude = settings.lastGpsLatitude ?: return null
    val longitude = settings.lastGpsLongitude ?: return null
    return latitude to longitude
  }

  private suspend fun reloadPrivacyZonesIntoRecorder(appContext: Context) {
    val zones = AppDataRepository.get(appContext).getEnabledPrivacyZoneEntities()
    TelemetryRepository.get(appContext).reloadPrivacyZones(zones)
    CoreForegroundService.reloadPrivacyZones(appContext)
  }

  private fun setTelemetryRecordingEnabled(enabled: Boolean) {
    CoreForegroundService.setTelemetryRecordingEnabled(context.applicationContext, enabled)
    if (!enabled) {
      TelemetryRepository.get(context.applicationContext).flushBlocking()
    }
  }
}
