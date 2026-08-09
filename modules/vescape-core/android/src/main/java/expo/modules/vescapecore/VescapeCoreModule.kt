package expo.modules.vescapecore

import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.alerts.normalizedAlertBeepCount
import expo.modules.vescapecore.alerts.normalizedAlertRepeatSeconds
import expo.modules.vescapecore.alerts.AlertCoordinator
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.auth.NativeAuthCoordinator
import expo.modules.vescapecore.service.BoardProbeAutoStartGate
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.connection.BoardTransportDetector
import expo.modules.vescapecore.service.CompanionPresence
import expo.modules.vescapecore.service.CompanionRestartGate
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.recording.DebugRecordingStore
import expo.modules.vescapecore.replay.ReplayRecordings
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.service.ManualDisconnectAutoStartGate
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.connection.TransportDetection
import expo.modules.vescapecore.connection.buildSessionConfig

import expo.modules.vescapecore.navigation.NavigationController
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
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.DatabaseBackupManager
import expo.modules.vescapecore.telemetry.ProfileStatsRepository
import expo.modules.vescapecore.telemetry.TELEMETRY_DATABASE_NAME
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.telemetry.AlertRuleEntity
import expo.modules.vescapecore.location.LegalPolicyResolver
import expo.modules.vescapecore.location.LegalPolicyCatalog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

private const val TAG = "VescapeCore"
private const val SCAN_RETRY_LIMIT = 3

/** Parse the minimal, ephemeral rule shape accepted from JS for an alert test. */
private fun Map<String, Any?>.toAlertTestRule(): AlertRuleEntity? {
  val id = this["id"] as? String ?: return null
  val controlId = this["controlId"] as? String ?: return null
  val threshold = (this["threshold"] as? Number)?.toDouble() ?: return null
  val thresholdMax = (this["thresholdMax"] as? Number)?.toDouble()
  val soundType = this["soundType"] as? String ?: return null
  return AlertRuleEntity(
    boardId = "alert-test",
    id = id,
    controlId = controlId,
    threshold = threshold,
    thresholdMax = thresholdMax,
    enabled = true,
    soundType = soundType,
    createdAt = 0,
    repeatEverySeconds = normalizedAlertRepeatSeconds((this["repeatEverySeconds"] as? Number)?.toDouble()),
    beepCount = normalizedAlertBeepCount((this["beepCount"] as? Number)?.toInt()),
    source = null,
  )
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift
 */
@SuppressLint("MissingPermission") // permissions are requested at the JS/RN layer
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
  private val observedEvents = mutableSetOf<String>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var activeProbe: ActiveBoardProbe? = null
  private var previewAlertFeedback: AlertFeedback? = null
  /** UI alert tests own feedback + evaluator state separate from the live Board Session. */
  private var alertTestFeedback: AlertFeedback? = null
  private var alertTestCoordinator: AlertCoordinator? = null
  private var alertTestControlId: String? = null
  /** Remover for this module's App Status mirror listener; cleared in OnDestroy. */
  private var appStatusUnsub: (() -> Unit)? = null
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

    CoreForegroundService.emitEvent = { name, body ->
      if (name == "onLiveState" && shouldEmitToFrontend("onLiveState")) {
        mainHandler.post {
          if (shouldEmitToFrontend("onLiveState")) sendEvent("onLiveState", liveStateWithScan(body))
        }
      } else if (shouldEmitToFrontend(name)) {
        mainHandler.post {
          if (shouldEmitToFrontend(name)) sendEvent(name, body)
        }
      }
    }

    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `Events`
    // @parity /modules/vescape-core/src/index.ts `VescapeCoreEvents`
    Events(
      "onDevice",
      "onError",
      "onLiveState",
      "onLiveTick",
      "onLiveSeries",
      "onTelemetryHistory",
      "onBms",
      "onBmsSeries",
      "onLocation",
      "onReplayPhoneHeading",
      "onTelemetryRebuildProgress",
      "onBoardProbeProgress",
      "onGroupRideConnection",
      "onGroupRideSnapshot",
      "onGroupRideCreated",
      "onGroupRideUpdated",
      "onGroupRideEnded",
      "onGroupRideJoined",
      "onGroupRideRoster",
      "onGroupRideError",
      "onAppDataChanged",
      "onBoardWarnings",
      "onAppStatus",
      "onNavigation",
    )

    // Native owns App Status truth; JS mirrors it. Push every successful refresh (late subscribers
    // pull the current snapshot below and through `getAppStatus`).
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendAppStatus`
    // @parity /modules/vescape-core/src/index.ts `AppStatusEvent`
    // The coordinator already notifies on the main thread, so emit straight from the callback.
    appStatusUnsub = AppStatusCoordinator.get(context).addChangeListener { status ->
      if (shouldEmitToFrontend("onAppStatus")) {
        sendEvent("onAppStatus", mapOf("status" to status?.toMap()))
      }
    }

    // Navigation is native-owned; JS only renders the coordinates it is handed. Push every change,
    // including the clear to `null` (late subscribers replay below and through `getNavigation`).
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendNavigation`
    // @parity /modules/vescape-core/src/index.ts `NavigationEvent`
    NavigationController.get(context).onChange = { navigation ->
      if (shouldEmitToFrontend("onNavigation")) {
        sendEvent("onNavigation", mapOf("navigation" to navigation?.toMap()))
      }
    }

    // JS keeps a dumb mirror of the durable Board Warning registry; push the full board list on
    // every registry change so late subscribers self-heal on the next emit (and on subscribe below).
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
    OnStartObserving("onTelemetryHistory") { startObserving("onTelemetryHistory") }
    OnStopObserving("onTelemetryHistory") { stopObserving("onTelemetryHistory") }
    OnStartObserving("onBms") { startObserving("onBms") }
    OnStopObserving("onBms") { stopObserving("onBms") }
    OnStartObserving("onBmsSeries") { startObserving("onBmsSeries") }
    OnStopObserving("onBmsSeries") { stopObserving("onBmsSeries") }
    OnStartObserving("onLocation") { startObserving("onLocation") }
    OnStopObserving("onLocation") { stopObserving("onLocation") }
    OnStartObserving("onTelemetryRebuildProgress") { startObserving("onTelemetryRebuildProgress") }
    OnStopObserving("onTelemetryRebuildProgress") { stopObserving("onTelemetryRebuildProgress") }
    OnStartObserving("onBoardProbeProgress") { startObserving("onBoardProbeProgress") }
    OnStopObserving("onBoardProbeProgress") { stopObserving("onBoardProbeProgress") }
    OnStartObserving("onGroupRideConnection") { startObserving("onGroupRideConnection") }
    OnStopObserving("onGroupRideConnection") { stopObserving("onGroupRideConnection") }
    OnStartObserving("onGroupRideSnapshot") { startObserving("onGroupRideSnapshot") }
    OnStopObserving("onGroupRideSnapshot") { stopObserving("onGroupRideSnapshot") }
    OnStartObserving("onGroupRideCreated") { startObserving("onGroupRideCreated") }
    OnStopObserving("onGroupRideCreated") { stopObserving("onGroupRideCreated") }
    OnStartObserving("onGroupRideUpdated") { startObserving("onGroupRideUpdated") }
    OnStopObserving("onGroupRideUpdated") { stopObserving("onGroupRideUpdated") }
    OnStartObserving("onGroupRideEnded") { startObserving("onGroupRideEnded") }
    OnStopObserving("onGroupRideEnded") { stopObserving("onGroupRideEnded") }
    OnStartObserving("onGroupRideJoined") { startObserving("onGroupRideJoined") }
    OnStopObserving("onGroupRideJoined") { stopObserving("onGroupRideJoined") }
    OnStartObserving("onGroupRideRoster") { startObserving("onGroupRideRoster") }
    OnStopObserving("onGroupRideRoster") { stopObserving("onGroupRideRoster") }
    OnStartObserving("onGroupRideError") { startObserving("onGroupRideError") }
    OnStopObserving("onGroupRideError") { stopObserving("onGroupRideError") }
    OnStartObserving("onBoardWarnings") {
      startObserving("onBoardWarnings")
      CoroutineScope(Dispatchers.IO).launch { BoardWarningRegistry.get(context).emitSnapshot() }
    }
    OnStopObserving("onBoardWarnings") { stopObserving("onBoardWarnings") }
    OnStartObserving("onAppStatus") {
      startObserving("onAppStatus")
      sendEvent("onAppStatus", mapOf("status" to AppStatusCoordinator.get(context).current?.toMap()))
    }
    OnStopObserving("onAppStatus") { stopObserving("onAppStatus") }
    OnStartObserving("onNavigation") {
      startObserving("onNavigation")
      // Late subscriber: replay the current Navigation so JS is immediately consistent.
      sendEvent("onNavigation", mapOf("navigation" to NavigationController.get(context).current?.toMap()))
    }
    OnStopObserving("onNavigation") { stopObserving("onNavigation") }

    OnCreate {
      // Cold start: fetch App Status before JS asks. A foreground event arriving right after is
      // coalesced into this request.
      AppStatusCoordinator.get(context).refresh()
    }

    OnActivityEntersForeground {
      frontendActive = true
      // User opened the app again — re-arm companion auto start immediately.
      CompanionRestartGate.clear(context.applicationContext)
      AppStatusCoordinator.get(context).refresh()
    }
    OnActivityEntersBackground {
      frontendActive = false
    }
    OnActivityResult { _, result ->
      companionPresence.onActivityResult(result.requestCode, result.resultCode)
    }
    OnDestroy {
      frontendActive = false
      observedEvents.clear()
      // Detach the JS-facing emit sink so the process-singleton registry doesn't keep the destroyed
      // module reachable (mirrors iOS OnDestroy nulling `onChange`). A fresh module re-attaches in
      // its own definition().
      BoardWarningRegistry.get(context).onChange = null
      appStatusUnsub?.invoke()
      appStatusUnsub = null
      previewAlertFeedback?.release()
      previewAlertFeedback = null
      stopAlertTest()
      cancelActiveProbe(null, "module_destroyed")
      if (CoreForegroundService.emitEvent != null) {
        CoreForegroundService.emitEvent = null
      }
    }

    Function("scan") { startScan(resetRetries = true) }
    Function("stopScan") { stopScanInternal() }
    Function("exitApp") { CoreForegroundService.exitApp(context.applicationContext) }
    Function("startLocationUpdates") { startLocationUpdates() }
    Function("stopLocationUpdates") { stopLocationUpdates() }
    Function("startGroupRideObserve") { serverUrl: String ->
      CoreForegroundService.startGroupRideObserve(context.applicationContext, serverUrl)
    }
    Function("stopGroupRideObserve") {
      CoreForegroundService.stopGroupRideObserve(context.applicationContext)
    }
    Function("createGroupRide") { riderId: String, riderName: String, riderColor: String?, name: String?, lat: Double, lng: Double ->
      CoreForegroundService.createGroupRide(context.applicationContext, riderId, riderName, riderColor, name, lat, lng)
    }
    Function("joinGroupRide") { riderId: String, riderName: String, riderColor: String?, rideId: String ->
      CoreForegroundService.joinGroupRide(context.applicationContext, riderId, riderName, riderColor, rideId)
    }
    Function("leaveGroupRide") {
      CoreForegroundService.leaveGroupRide(context.applicationContext)
    }
    Function("updateGroupRideIdentity") { riderId: String, riderName: String, riderColor: String? ->
      CoreForegroundService.updateGroupRideIdentity(context.applicationContext, riderId, riderName, riderColor)
    }
    Function("recordPhoneHeading") { headingDeg: Double ->
      CoreForegroundService.recordPhoneHeading(context.applicationContext, headingDeg)
    }
    Function("setTelemetryRecordingEnabled") { enabled: Boolean -> setTelemetryRecordingEnabled(enabled) }
    Function("setBmsSeriesFocused") { focused: Boolean ->
      CoreForegroundService.setBmsSeriesFocused(focused)
    }
    Function("reloadAlertRules") {
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    Function("previewAlertSound") { soundType: String ->
      CoreForegroundService.previewAlertSound(context.applicationContext, soundType)
    }
    Function("getAlertSounds") {
      CoreForegroundService.alertSoundPresets()
    }
    Function("startGeigerSimulation") { soundType: String, rangeDepth: Double ->
      val feedback = previewAlertFeedback ?: AlertFeedback(context.applicationContext, mainHandler)
        .also { previewAlertFeedback = it }
      feedback.updateGeiger("preview", soundType, rangeDepth)
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
        // Battery thresholds compare synthetic SoC, while message `{voltage}` keeps a plausible
        // raw sample instead of incorrectly speaking the percentage as volts.
        values = mapOf(controlId to if (controlId == "battery") 48.0 else value),
        batteryPercent = value.takeIf { controlId == "battery" },
        onDiagnostic = { _, _ -> },
      )
    }
    Function("stopAlertTest") {
      stopAlertTest()
    }
    Function("getLiveState") {
      liveStateWithScan(CoreForegroundService.currentLiveState(context.applicationContext))
    }
    // Last successful App Status for this process, or null while none has been fetched (fail-open).
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getAppStatus`
    Function("getAppStatus") {
      AppStatusCoordinator.get(context).current?.toMap()
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
    // Stable Vescape route keeps the app decoupled from the final store destination.
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `openAppUpdate`
    // @platform-diff Android uses the stable Android download route.
    // @parity /modules/vescape-core/src/index.ts `openAppUpdate`
    Function("openAppUpdate") {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(AppStatusCoordinator.androidDownloadUrl()))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (e: ActivityNotFoundException) {
        // No browser to take the link. This is the App Block's only action, so failing loudly here
        // would crash the one screen the rider can still see.
        Log.w(TAG, "Cannot open the download route: ${e.message}")
      }
    }
    Function("getRemoteTiltState") {
      CoreForegroundService.currentRemoteTiltState()
    }
    Function("setSelectedBoard") { boardId: String? ->
      ManualDisconnectAutoStartGate.clear(context.applicationContext)
      runBlocking { AppDataRepository.get(context.applicationContext).setSelectedBoardId(boardId) }
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
    AsyncFunction("stopBoard") { promise: Promise ->
      stopBoardSession(promise)
    }
    AsyncFunction("probeBoardLink") Coroutine { bleId: String, probeId: String ->
      probeBoardLink(bleId, probeId)
    }
    Function("cancelBoardProbe") { probeId: String ->
      cancelActiveProbe(probeId, "js_cancelled")
    }
    AsyncFunction("getTelemetryHistory") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).getHistory(options)
    }
    AsyncFunction("getTelemetrySamples") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).getSamples(options)
    }
    AsyncFunction("getHistoryRange") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).getRange(options)
    }
    AsyncFunction("getTelemetrySummary") {
      runBlocking { TelemetryRepository.get(context.applicationContext).getSummary() }
    }
    AsyncFunction("getDiagnosticEvents") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).getDiagnosticEvents(options)
    }
    AsyncFunction("getBoardWarnings") Coroutine { ->
      BoardWarningRegistry.get(context).allWarnings().map { it.toMap() }
    }
    AsyncFunction("clearBoardWarning") Coroutine { boardId: String, kind: String ->
      BoardWarningRegistry.get(context).clearWarning(boardId, kind)
    }
    AsyncFunction("clearAllBoardWarnings") Coroutine { boardId: String ->
      BoardWarningRegistry.get(context).clearAllWarnings(boardId)
    }
    AsyncFunction("devInjectBoardWarning") Coroutine { boardId: String, kind: String, severity: String, payloadJson: String ->
      BoardWarningRegistry.get(context)
        .reportFinding(boardId, kind, BoardWarningSeverity.fromWire(severity), payloadJson)
    }
    AsyncFunction("devReportCleanBoardWarning") Coroutine { boardId: String, kind: String ->
      BoardWarningRegistry.get(context).reportCleanEvaluation(boardId, kind)
    }
    AsyncFunction("clearDiagnosticEvents") {
      runBlocking { TelemetryRepository.get(context.applicationContext).clearDiagnosticEvents() }
    }
    AsyncFunction("getDatabaseSizeBytes") {
      val dbFile = context.applicationContext.getDatabasePath(TELEMETRY_DATABASE_NAME)
      if (dbFile.exists()) dbFile.length() else 0L
    }
    AsyncFunction("backupDatabase") { promise: Promise ->
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
      DatabaseBackupManager.restoreBackup(context.applicationContext, uri)
    }
    AsyncFunction("getRefloatConfigSnapshot") { promise: Promise ->
      CoreForegroundService.getRefloatConfigSnapshot(
        onSuccess = { snapshot -> promise.resolve(snapshot) },
        onError = { code, message -> promise.reject(code, message, null) },
      )
    }
    AsyncFunction("setRemoteTilt") { value: Int ->
      CoreForegroundService.setRemoteTilt(value)
    }
    AsyncFunction("lockRemoteTilt") { value: Int ->
      CoreForegroundService.lockRemoteTilt(value)
    }
    AsyncFunction("releaseRemoteTilt") { value: Int, durationMs: Int ->
      CoreForegroundService.releaseRemoteTilt(value, durationMs.toLong())
    }
    AsyncFunction("stopRemoteTilt") {
      CoreForegroundService.stopRemoteTilt()
    }
    AsyncFunction("startBoardMove") { input: Int ->
      CoreForegroundService.startBoardMove(input)
    }
    AsyncFunction("stopBoardMove") {
      CoreForegroundService.stopBoardMove()
    }
    AsyncFunction("pushProfileToBoard") { profileId: String, promise: Promise ->
      CoreForegroundService.pushProfileToBoard(
        context.applicationContext,
        profileId,
        onSuccess = { snapshot -> promise.resolve(snapshot) },
        onError = { code, message -> promise.reject(code, message, null) },
      )
    }
    AsyncFunction("getTuneProfiles") Coroutine { boardId: String, refloatBaseVersion: String? ->
      AppDataRepository.get(context.applicationContext).getTuneProfiles(boardId, refloatBaseVersion)
    }
    AsyncFunction("getTuneProfile") Coroutine { profileId: String ->
      AppDataRepository.get(context.applicationContext).getTuneProfile(profileId)
    }
    AsyncFunction("createProfile") Coroutine { boardId: String, name: String, icon: String, color: String, fields: Map<String, Any?>, refloatBaseVersion: String ->
      AppDataRepository.get(context.applicationContext).createProfile(boardId, name, icon, color, fields, refloatBaseVersion)
    }
    AsyncFunction("renameProfile") Coroutine { profileId: String, name: String, icon: String, color: String ->
      AppDataRepository.get(context.applicationContext).renameProfile(profileId, name, icon, color)
    }
    AsyncFunction("deleteProfile") Coroutine { profileId: String ->
      AppDataRepository.get(context.applicationContext).deleteProfile(profileId)
    }
    AsyncFunction("getProfileHistory") Coroutine { profileId: String ->
      AppDataRepository.get(context.applicationContext).getProfileHistory(profileId)
    }
    AsyncFunction("rollbackProfile") Coroutine { profileId: String, historyEntryId: Double ->
      AppDataRepository.get(context.applicationContext).rollbackProfile(profileId, historyEntryId.toLong())
    }
    AsyncFunction("copyProfileToBoard") Coroutine { profileId: String, targetBoardId: String, newName: String ->
      AppDataRepository.get(context.applicationContext).copyProfileToBoard(profileId, targetBoardId, newName)
    }
    AsyncFunction("saveProfile") Coroutine { profileId: String, fields: Map<String, Any?> ->
      AppDataRepository.get(context.applicationContext).saveProfile(profileId, fields)
    }
    AsyncFunction("getTotalProfileStats") {
      runBlocking { ProfileStatsRepository.get(context.applicationContext).getTotalProfileStats() }
    }
    AsyncFunction("getMonthlyProfileStats") Coroutine { options: Map<String, Any?> ->
      ProfileStatsRepository.get(context.applicationContext).getMonthlyProfileStats(options)
    }
    AsyncFunction("getProfileStatMonths") {
      runBlocking { ProfileStatsRepository.get(context.applicationContext).getProfileStatMonths() }
    }
    // Favorites (ADR 0029). JS supplies only the range and an optional name; identity, timestamps
    // and the denormalized summary are native.
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFavorites`
    AsyncFunction("getFavorites") Coroutine { ->
      TelemetryRepository.get(context.applicationContext).getFavorites()
    }
    AsyncFunction("createFavorite") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).createFavorite(options)
        ?: throw CodedException("ERR_CREATE_FAVORITE", "favorite range is invalid or could not be stored", null)
    }
    AsyncFunction("updateFavorite") Coroutine { id: String, options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).updateFavorite(id, options)
        ?: throw CodedException("ERR_UPDATE_FAVORITE", "favorite does not exist or could not be stored", null)
    }
    AsyncFunction("deleteFavorite") Coroutine { id: String ->
      TelemetryRepository.get(context.applicationContext).deleteFavorite(id)
    }
    AsyncFunction("getFavoriteMedia") Coroutine { favoriteId: String ->
      TelemetryRepository.get(context.applicationContext).getFavoriteMedia(favoriteId)
    }
    AsyncFunction("importFavoriteMedia") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).importFavoriteMedia(options)
    }
    AsyncFunction("deleteTelemetryBefore") Coroutine { beforeMs: Double ->
      TelemetryRepository.get(context.applicationContext).deleteBefore(beforeMs.toLong())
    }
    AsyncFunction("deleteTelemetryRange") Coroutine { options: Map<String, Any?> ->
      TelemetryRepository.get(context.applicationContext).deleteRange(options)
    }
    AsyncFunction("rebuildTelemetryBuckets") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val appContext = context.applicationContext
          val repository = TelemetryRepository.get(appContext)
          repository.applySettings(AppDataRepository.get(appContext).getTypedSettings())
          val count = repository.rebuildBuckets { current, total ->
            if (shouldEmitToFrontend("onTelemetryRebuildProgress")) {
              mainHandler.post {
                if (shouldEmitToFrontend("onTelemetryRebuildProgress")) {
                  sendEvent(
                    "onTelemetryRebuildProgress",
                    mapOf("current" to current, "total" to total),
                  )
                }
              }
            }
          }
          promise.resolve(count)
        } catch (e: Exception) {
          promise.reject("ERR_REBUILD", e.message, e)
        }
      }
    }
    AsyncFunction("clearTelemetryHistory") {
      runBlocking { TelemetryRepository.get(context.applicationContext).clearAll() }
    }
    AsyncFunction("getBoards") {
      runBlocking { AppDataRepository.get(context.applicationContext).getBoards() }
    }
    AsyncFunction("upsertBoard") Coroutine { board: Map<String, Any?> ->
      AppDataRepository.get(context.applicationContext).upsertBoard(board)
      CoreForegroundService.reloadBoardData()
    }
    AsyncFunction("deleteBoard") Coroutine { id: String ->
      AppDataRepository.get(context.applicationContext).deleteBoard(id)
    }
    AsyncFunction("getAlertRules") { boardId: String ->
      runBlocking { AppDataRepository.get(context.applicationContext).getAlertRules(boardId) }
    }
    AsyncFunction("upsertAlertRule") Coroutine { rule: Map<String, Any?> ->
      AppDataRepository.get(context.applicationContext).upsertAlertRule(rule)
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    AsyncFunction("setAlertRuleEnabled") Coroutine { boardId: String, id: String, enabled: Boolean ->
      AppDataRepository.get(context.applicationContext).setAlertRuleEnabled(boardId, id, enabled)
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    AsyncFunction("deleteAlertRule") Coroutine { boardId: String, id: String ->
      AppDataRepository.get(context.applicationContext).deleteAlertRule(boardId, id)
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    AsyncFunction("getPrivacyZones") {
      runBlocking { AppDataRepository.get(context.applicationContext).getPrivacyZones() }
    }
    AsyncFunction("upsertPrivacyZone") Coroutine { zone: Map<String, Any?> ->
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).upsertPrivacyZone(zone)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    AsyncFunction("setPrivacyZoneEnabled") Coroutine { id: String, enabled: Boolean ->
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).setPrivacyZoneEnabled(id, enabled)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    AsyncFunction("deletePrivacyZone") Coroutine { id: String ->
      val appCtx = context.applicationContext
      AppDataRepository.get(appCtx).deletePrivacyZone(id)
      reloadPrivacyZonesIntoRecorder(appCtx)
    }
    // Map Points are server-owned; native holds no copy. @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getNearbyMapPoints`
    AsyncFunction("getNearbyMapPoints") Coroutine { latitude: Double, longitude: Double, radiusMeters: Int ->
      MapPointApi.get(context.applicationContext).nearby(latitude, longitude, radiusMeters)
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
    // The direction target is personal client state, never a Map Point. Native keeps it so Group
    // Ride presence can read it while JS is gone.
    AsyncFunction("setDirectionPoint") Coroutine { latitude: Double?, longitude: Double? ->
      val appCtx = context.applicationContext
      val repository = AppDataRepository.get(appCtx)
      repository.setDirectionPoint(latitude, longitude)
      CoreForegroundService.reloadGroupRideTarget(appCtx)

      // A Navigation belongs to exactly one Direction Point: setting one asks for a path, clearing
      // one ends it. The Directions call runs off the promise so the pin lands immediately.
      val navigation = NavigationController.get(appCtx)
      if (latitude == null || longitude == null) {
        navigation.clear()
      } else {
        val settings = repository.getTypedSettings()
        CoroutineScope(Dispatchers.IO).launch {
          navigation.setTarget(latitude, longitude, settings.lastGpsLatitude, settings.lastGpsLongitude)
        }
      }
    }
    AsyncFunction("getSettings") {
      runBlocking { AppDataRepository.get(context.applicationContext).getSettings() }
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshLegalPolicy`
    // @parity /modules/vescape-core/src/index.ts `refreshLegalPolicy`
    AsyncFunction("refreshLegalPolicy") Coroutine { ->
      val repository = AppDataRepository.get(context.applicationContext)
      val settings = repository.getTypedSettings()
      val latitude = settings.lastGpsLatitude
      val longitude = settings.lastGpsLongitude
      val countryCode = if (latitude != null && longitude != null) {
        legalPolicyResolver.resolve(latitude, longitude)
      } else {
        null
      }
      repository.updateLegalPolicy(countryCode)
      CoreForegroundService.reloadAlertRules(context.applicationContext)
    }
    // @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setLegalMode`
    // @parity /modules/vescape-core/src/index.ts `setLegalMode`
    AsyncFunction("setLegalMode") { boardId: String, enabled: Boolean, promise: Promise ->
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
      AppDataRepository.get(context.applicationContext).updateSetting(key, value)
      if (key == "liveHistoryLimit") {
        CoreForegroundService.setLiveHistoryLimit(value as? Number)
      }
      if (
        key == "movingSpeedThresholdKmh" ||
        key == "avgSpeedCutoffKmh" ||
        key == "movingAvgSpeedThresholdKmh" ||
        key == "freeSpinMaxSpeedDeltaKmh" ||
        key == "freeSpinStationaryBoardCapKmh" ||
        key == "socEstimateWindowSeconds" ||
        key == "telemetryPollRateHz" ||
        key == "wearMirrorIntervalMs" ||
key == "wearAutoLaunchOnConnect" ||
        key == "boardWarningsEnabled"
      ) {
        CoreForegroundService.reloadTelemetrySettings(context.applicationContext)
      }
    }
  }

  private fun startAlertTest(ruleMaps: List<Map<String, Any?>>) {
    stopAlertTest()
    val rules = ruleMaps.mapNotNull { it.toAlertTestRule() }
    val controlId = rules.firstOrNull()?.controlId ?: return
    if (rules.any { it.controlId != controlId }) return

    val feedback = AlertFeedback(context.applicationContext, mainHandler)
    val coordinator = AlertCoordinator(feedback = { feedback }, vibrateSingles = false)
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

  private fun shouldEmitToFrontend(name: String): Boolean = frontendActive && observedEvents.contains(name)

  private fun startObserving(name: String) {
    observedEvents.add(name)
  }

  private fun stopObserving(name: String) {
    observedEvents.remove(name)
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

  private fun startLocationUpdates() {
    val hasFine = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    if (!hasFine) {
      sendEvent("onError", mapOf("message" to "Location permission not granted"))
      return
    }
    CoreForegroundService.startGpsMonitoring(context.applicationContext)
  }

  private suspend fun selectBoard(boardId: String) {
    val appCtx = context.applicationContext
    ManualDisconnectAutoStartGate.clear(appCtx)
    AppDataRepository.get(appCtx).setSelectedBoardId(boardId)
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
   * Start a dev-mode replay session (ADR 0024): a Debug Recording played through the real session
   * stack via ReplayTransport, keyed under a synthetic `replay:` board id so durable writes stay
   * isolated from real boards. Stop = normal disconnect (`stopDebugReplay` / `stopBoard`).
   *
   * `warmupMs` / `warmupSpeed` are opt-in and default to a plain 1× replay, so the Replay UI plays a
   * ride exactly as it happened. A caller that needs the live charts populated up front — the
   * screenshot run, an E2E flow — asks for a warmup window and how much faster than real time to
   * deliver it.
   */
  private fun startDebugReplay(name: String, options: Map<String, Any?>?, promise: Promise) {
    val appCtx = context.applicationContext
    val meta = ReplayRecordings.readMeta(appCtx, name)
    val replayBoardId = "replay:" + name.removeSuffix(".jsonl")
    val config = SessionConfig(
      appBoardId = replayBoardId,
      deviceId = replayBoardId,
      deviceName = meta?.optString("deviceName")?.takeIf { it.isNotBlank() } ?: name,
      transport = BoardTransport.Direct,
      pollIntervalMs = meta?.optLong("pollIntervalMs") ?: 0L,
      recordingEnabled = false,
      telemetryRecordingEnabled = false,
      autoReconnect = false,
      replayRecordingName = name,
      replayWarmupMs = (options?.get("warmupMs") as? Number)?.toLong() ?: 0L,
      replayWarmupSpeed = (options?.get("warmupSpeed") as? Number)?.toDouble() ?: 1.0,
    )
    CoreForegroundService.startBoardSession(
      appCtx,
      config,
      onSuccess = { promise.resolve(null) },
      onError = { code, message -> promise.reject(code, message, null) },
    )
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
      // A Board Probe owns the single BLE connection: tear down any live Board
      // Session before probing so the probe isn't fighting an active session.
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
    } finally {
      BoardProbeAutoStartGate.leave()
    }
  }

  private fun cancelActiveProbe(probeId: String?, reason: String) {
    val active = activeProbe ?: return
    if (probeId != null && active.id != probeId) return
    activeProbe = null
    active.detector?.cancel(reason)
    active.result.completeExceptionally(IllegalStateException("PROBE_CANCELLED: Board Probe cancelled"))
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

  private fun stopLocationUpdates() {
    CoreForegroundService.stopGpsMonitoring(context.applicationContext)
    TelemetryRepository.get(context.applicationContext).flushBlocking()
  }

  private fun stopBoardSession(promise: Promise) {
    CoreForegroundService.stopBoardSession(context.applicationContext) {
      promise.resolve(null)
    }
  }

  private suspend fun reloadPrivacyZonesIntoRecorder(appContext: Context) {
    val zones = AppDataRepository.get(appContext).getEnabledPrivacyZoneEntities()
    TelemetryRepository.get(appContext).reloadPrivacyZones(zones)
    // Keep the Group Ride presence egress gate (issue #144) in sync with the same zones.
    CoreForegroundService.reloadPrivacyZones(appContext)
  }

  private fun setTelemetryRecordingEnabled(enabled: Boolean) {
    CoreForegroundService.setTelemetryRecordingEnabled(context.applicationContext, enabled)
    if (!enabled) {
      TelemetryRepository.get(context.applicationContext).flushBlocking()
    }
  }
}
