package expo.modules.vescapecore.service

import expo.modules.vescapecore.accessory.AccessorySessionManager
import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.connection.BoardSessionController
import expo.modules.vescapecore.weather.WeatherAlertLine
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.replay.ReplayRecording
import expo.modules.vescapecore.replay.SimulatedBoard
import expo.modules.vescapecore.notification.NotificationController
import expo.modules.vescapecore.config.BoardConfigRevisionSource
import expo.modules.vescapecore.config.PendingConfigRead
import expo.modules.vescapecore.config.PendingConfigWrite
import expo.modules.vescapecore.config.RefloatConfigErrorCode
import expo.modules.vescapecore.alerts.alertSoundMaps

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.recording.RecordingStorageFailureKind
import expo.modules.vescapecore.recording.recordingFailureState
import expo.modules.vescapecore.liveStateWithStorageFailure
import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.location.GpsPowerMode
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.telemetry.AccessoryPersistence
import expo.modules.vescapecore.watch.WatchSettingsPusher
import expo.modules.vescapecore.watch.toWatchSettings
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.DEFAULT_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.telemetry.MAX_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.telemetry.MIN_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.database.VescapeDatabase
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.watch.WatchLightsSwitch
import expo.modules.vescapecore.watch.WatchMirrorWakeLevel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal const val VESC_SESSION_TAG = "VescSession"
internal const val ACTION_START_SESSION = "expo.modules.vescapecore.ACTION_START_SESSION"
private const val ACTION_STOP_SESSION = "expo.modules.vescapecore.ACTION_STOP_SESSION"
internal const val ACTION_EXIT_FROM_NOTIFICATION = "expo.modules.vescapecore.ACTION_EXIT_FROM_NOTIFICATION"
internal const val ACTION_CONNECT_FROM_NOTIFICATION = "expo.modules.vescapecore.ACTION_CONNECT_FROM_NOTIFICATION"
internal const val ACTION_DISCONNECT_FROM_NOTIFICATION = "expo.modules.vescapecore.ACTION_DISCONNECT_FROM_NOTIFICATION"
internal const val ACTION_START_GPS_MONITORING = "expo.modules.vescapecore.ACTION_START_GPS_MONITORING"
private const val ACTION_STOP_GPS_MONITORING = "expo.modules.vescapecore.ACTION_STOP_GPS_MONITORING"
internal const val ACTION_START_GROUP_RIDE_OBSERVE = "expo.modules.vescapecore.ACTION_START_GROUP_RIDE_OBSERVE"
internal const val ACTION_AUTO_CONNECT_SELECTED_BOARD = "expo.modules.vescapecore.ACTION_AUTO_CONNECT_SELECTED_BOARD"
internal const val ACTION_AUTO_CONNECT_ACCESSORIES = "expo.modules.vescapecore.ACTION_AUTO_CONNECT_ACCESSORIES"
internal const val ACTION_COMPANION_DEVICE_APPEARED = "expo.modules.vescapecore.ACTION_COMPANION_DEVICE_APPEARED"
internal const val EXTRA_COMPANION_ADDRESS = "expo.modules.vescapecore.EXTRA_COMPANION_ADDRESS"
internal const val TELEMETRY_STALE_MS = 4_000L

internal data class SessionConfig(
    val appBoardId: String?,
    val deviceId: String?,
    val deviceName: String,
    val transport: BoardTransport?,
    val linkVersion: Int? = null,
    val hasBms: Boolean? = null,
    val vescFirmwareVersion: String? = null,
    val refloatVersion: String? = null,
    val refloatBaseVersion: String? = null,
    val pollIntervalMs: Long,
    val recordingEnabled: Boolean,
    val telemetryRecordingEnabled: Boolean,
    val autoReconnect: Boolean = false,
    val replay: ReplaySpec? = null,
)

/**
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `ReplaySpec`
 */
internal data class ReplaySpec(
    val recording: ReplayRecording,
    val warmupMs: Long,
    val loop: Boolean,
)

internal data class PendingStart(
    val boardConfig: SessionConfig,
    val onSuccess: () -> Unit,
    val onError: (String, String) -> Unit,
)

internal data class PendingStop(val onSuccess: () -> Unit)

@SuppressLint("MissingPermission")
class CoreForegroundService : Service() {
    companion object {
        @Volatile var emitEvent: ((String, Map<String, Any?>) -> Unit)? = null

        @Volatile var liveStateChanged: (() -> Unit)? = null

        private var instance: CoreForegroundService? = null

        private fun onMain(block: () -> Unit) {
            if (Looper.myLooper() == Looper.getMainLooper()) block() else Handler(Looper.getMainLooper()).post(block)
        }
        internal var pendingStart: PendingStart? = null
        internal var pendingStop: PendingStop? = null
        internal var pendingConfigRead: PendingConfigRead? = null
        internal var pendingConfigWrite: PendingConfigWrite? = null
        internal var pendingGpsStart = false
        @Volatile internal var pendingGroupRideUrl: String? = null
        @Volatile internal var lookAroundRequested = false

        /**
         * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `appVisible`
         */
        internal var appVisible = false
        internal val appDataScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val alertRulesGeneration = AtomicLong(0)
        private val alertRulesReloadMutex = Mutex()

        internal val warningWriteDispatcher =
            Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "vesc-warning-writes") }
                .asCoroutineDispatcher()

        private val pendingLock = Any()

        internal fun claimPendingStart(): PendingStart? = synchronized(pendingLock) {
            pendingStart.also { pendingStart = null }
        }

        internal fun claimPendingStop(): PendingStop? = synchronized(pendingLock) {
            pendingStop.also { pendingStop = null }
        }

        internal fun claimPendingGpsStart(): Boolean = synchronized(pendingLock) {
            pendingGpsStart.also { pendingGpsStart = false }
        }

        internal fun claimPendingGroupRideUrl(): String? = synchronized(pendingLock) {
            pendingGroupRideUrl.also { pendingGroupRideUrl = null }
        }

        internal fun startBoardSession(
            context: Context,
            boardConfig: SessionConfig,
            onSuccess: () -> Unit,
            onError: (String, String) -> Unit,
        ) {
            val result = CoreForegroundServiceLauncher.startBoardSession(context) {
                pendingStart = PendingStart(boardConfig, onSuccess, onError)
            }
            if (!result.started) {
                pendingStart = null
                onError(result.errorCode(), result.errorMessage("Board session service start skipped"))
                return
            }
            onMain { instance?.controller?.consumePendingStart() }
        }

        fun stopBoardSession(context: Context, onSuccess: () -> Unit = {}) {
            val service = instance
            if (service == null) {
                pendingStop = null
                onSuccess()
                return
            }
            pendingStop = PendingStop(onSuccess)
            val intent = Intent(context, CoreForegroundService::class.java).apply {
                action = ACTION_STOP_SESSION
            }
            context.startService(intent)
            onMain { instance?.controller?.consumePendingStop() }
        }

        fun exitApp(context: Context) {
            instance?.controller?.exitFromNotification()
                ?: NotificationController.closeAppTask(context.applicationContext)
        }

        fun onCompanionDeviceAppeared(context: Context, address: String) {
            CoreForegroundServiceLauncher.onCompanionDeviceAppeared(context, address).logIfSkipped(
                "Companion service start skipped",
            )
        }

        fun autoConnectSelectedBoard(context: Context) {
            if (BoardProbeAutoStartGate.isActive()) {
                android.util.Log.i(VESC_SESSION_TAG, "Auto-connect skipped: Board Probe active")
                return
            }
            appDataScope.launch {
                val settings = AppDataRepository.get(context.applicationContext).getTypedSettings()
                if (ManualDisconnectAutoStartGate.isSuppressed(context.applicationContext, settings.selectedBoardId)) {
                    android.util.Log.i(VESC_SESSION_TAG, "Auto-connect service start skipped: manual disconnect")
                    return@launch
                }
                val result = CoreForegroundServiceLauncher.autoConnectSelectedBoard(
                    context = context,
                    autoConnectEnabled = settings.autoConnect,
                    selectedBoardId = settings.selectedBoardId,
                )
                if (!result.started) {
                    result.logIfSkipped("Auto-connect service start skipped")
                    return@launch
                }
                instance?.controller?.autoConnectSelectedBoard()
            }
        }

        /**
         * @parity /modules/vescape-core/ios/connection/VescapeLaunchSubscriber.swift
         */
        fun autoConnectAccessories(context: Context) {
            val app = context.applicationContext
            appDataScope.launch {
                val enrolled = try {
                    AccessoryPersistence(VescapeDatabase.get(app).vescapeDao()).getAccessories()
                } catch (e: Exception) {
                    android.util.Log.w(VESC_SESSION_TAG, "Accessory auto-connect read failed: ${e.message}")
                    return@launch
                }
                if (enrolled.isEmpty()) return@launch
                CoreForegroundServiceLauncher.autoConnectAccessories(app)
                    .logIfSkipped("Accessory session service start skipped")
            }
        }

        fun refreshBoardConfigValues(
            onSuccess: (Map<String, Any?>) -> Unit,
            onError: (String, String) -> Unit,
        ) {
            val service = instance
            if (service == null) {
                onError(
                    RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name,
                    "Board must be connected before reading Refloat config",
                )
                return
            }
            pendingConfigRead = PendingConfigRead(onSuccess, onError)
            service.controller.consumePendingConfigRead()
        }

        fun getBoardConfigValues(): Map<String, Any?>? = instance?.controller?.boardConfigValuesMap()

        fun getMotorConfigValues(): Map<String, Any?>? = instance?.controller?.motorConfigValuesMap()

        fun readVescFaultLog(
            boardId: String,
            onSuccess: (String) -> Unit,
            onError: (String, String) -> Unit,
        ) {
            val service = instance
            if (service == null) {
                onError("VESC_FAULT_LOG_BOARD_NOT_CONNECTED", "Matching Board must be connected")
                return
            }
            service.controller.readVescFaultLog(boardId, onSuccess, onError)
        }

        internal fun replayPlayback(): SimulatedBoard? = instance?.controller?.replayPlayback

        fun setRemoteTilt(value: Int): Boolean = instance?.controller?.setRemoteTilt(value) ?: false

        fun lockRemoteTilt(value: Int): Boolean = instance?.controller?.lockRemoteTilt(value) ?: false

        fun releaseRemoteTilt(value: Int, durationMs: Long): Boolean =
            instance?.controller?.releaseRemoteTilt(value, durationMs) ?: false

        fun stopRemoteTilt(): Boolean = instance?.controller?.stopRemoteTilt() ?: false

        fun setBoardLights(enabled: Boolean, headlightsEnabled: Boolean): Boolean =
            instance?.controller?.setBoardLights(enabled, headlightsEnabled) ?: false

        fun lightsEventBody(): Map<String, Any?> =
            instance?.controller?.lightsEventBody() ?: mapOf("enabled" to null, "headlightsEnabled" to null)

        fun startBoardMove(input: Int): Boolean = instance?.controller?.startBoardMove(input) ?: false

        fun stopBoardMove(): Boolean = instance?.controller?.stopBoardMove() ?: false

        fun watchMove(direction: Int) {
            instance?.controller?.watchMove(direction)
        }

        internal fun watchLights(switch: WatchLightsSwitch, on: Boolean) {
            instance?.controller?.watchLights(switch, on)
        }

        fun watchTiltLock(value: Int) {
            instance?.controller?.watchTiltLock(value)
        }

        fun watchTiltCancel() {
            instance?.controller?.watchTiltCancel()
        }

        internal fun watchMirrorWakeLevel(level: WatchMirrorWakeLevel) {
            instance?.controller?.watchMirrorWakeLevel(level)
        }

        internal fun applyBoardConfigChangeset(
            boardId: String,
            changes: Map<String, Any?>,
            onSuccess: (Map<String, Any?>) -> Unit,
            onError: (String, String) -> Unit,
            source: BoardConfigRevisionSource = BoardConfigRevisionSource.APP,
        ) {
            val service = instance
            if (service == null) {
                onError(
                    RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name,
                    "Board must be connected before pushing config",
                )
                return
            }
            pendingConfigWrite = PendingConfigWrite.Changeset(boardId, changes, onSuccess, onError, source)
            service.controller.consumePendingConfigWrite()
        }

        fun pushProfileToBoard(
            profileId: String,
            onSuccess: (Map<String, Any?>) -> Unit,
            onError: (String, String) -> Unit,
        ) {
            val service = instance
            if (service == null) {
                onError(
                    RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name,
                    "Board must be connected before pushing config",
                )
                return
            }
            pendingConfigWrite = PendingConfigWrite.Profile(profileId, onSuccess, onError)
            service.controller.consumePendingConfigWrite()
        }

        fun setAppVisible(@Suppress("UNUSED_PARAMETER") context: Context, visible: Boolean) {
            appVisible = visible
            instance?.controller?.appVisible = visible
        }

        fun startGpsMonitoring(context: Context) {
            val result = CoreForegroundServiceLauncher.startGpsMonitoring(context) {
                pendingGpsStart = true
            }
            if (!result.started) {
                pendingGpsStart = false
                result.logIfSkipped("GPS service start skipped")
                return
            }
            instance?.controller?.consumePendingGpsStart()
        }

        fun stopGpsMonitoring(context: Context) {
            pendingGpsStart = false
            val service = instance ?: return
            val intent = Intent(context, CoreForegroundService::class.java).apply {
                action = ACTION_STOP_GPS_MONITORING
            }
            context.startService(intent)
            service.controller.stopGpsMonitoring()
        }

        fun startGroupRideObserve(context: Context, url: String) {
            val result = CoreForegroundServiceLauncher.startGroupRideObserve(context) {
                pendingGroupRideUrl = url
            }
            if (!result.started) {
                pendingGroupRideUrl = null
                result.logIfSkipped("Group Ride observe service start skipped")
                return
            }
            onMain { instance?.controller?.consumePendingGroupRideObserve() }
        }

        fun stopGroupRideObserve() {
            pendingGroupRideUrl = null
            onMain { instance?.controller?.stopGroupRideObserve() }
        }

        fun resyncGroupRide() {
            instance?.controller?.resyncGroupRide()
        }

        fun replayGroupRideEvent(name: String) {
            instance?.controller?.replayGroupRideEvent(name)
        }

        fun sendGroupRideSignal(kind: String) {
            instance?.controller?.sendGroupRideSignal(kind)
        }

        fun clearGroupRideSignal() {
            instance?.controller?.clearGroupRideSignal()
        }

        fun sendGroupRideHazard(kind: String) {
            instance?.controller?.sendGroupRideHazard(kind)
        }

        fun clearGroupRideHazard() {
            instance?.controller?.clearGroupRideHazard()
        }

        fun setPublicRide(on: Boolean, until: Long?) {
            instance?.controller?.setPublicRide(on, until)
        }

        fun setManualPublicRideSharing(enabled: Boolean) {
            instance?.controller?.setManualPublicRideSharing(enabled)
        }

        fun watchPublicRiders() {
            lookAroundRequested = true
            instance?.controller?.watchPublicRiders()
        }

        fun stopWatchingPublicRiders() {
            lookAroundRequested = false
            instance?.controller?.stopWatchingPublicRiders()
        }

        fun setTelemetryRecordingEnabled(context: Context, enabled: Boolean) {
            RecordingCoordinator.requestTelemetryRecording(enabled)
            instance?.controller?.setTelemetryRecordingEnabled(enabled)
            if (!enabled && RecordingStorageFailure.value() == null) {
                TelemetryRepository.get(context.applicationContext).flushBlocking()
            }
        }

        fun setBmsSeriesFocused(focused: Boolean) {
            instance?.controller?.setBmsSeriesFocused(focused)
        }

        fun setFocusedSeriesMetrics(metrics: List<String>) {
            instance?.controller?.setFocusedSeriesMetrics(metrics)
        }

        fun setLiveSeriesMetrics(metrics: List<String>) {
            instance?.controller?.setLiveSeriesMetrics(metrics)
        }

        fun recentTelemetry(): List<Map<String, Any?>> = instance?.controller?.recentTelemetry().orEmpty()

        fun setLiveHistoryLimit(limit: Number?) {
            val minutes = (limit?.toInt() ?: DEFAULT_LIVE_HISTORY_LIMIT_MINUTES)
                .coerceIn(MIN_LIVE_HISTORY_LIMIT_MINUTES, MAX_LIVE_HISTORY_LIMIT_MINUTES)
            instance?.controller?.applyLiveHistoryLimitMinutes(minutes)
        }

        fun reloadTelemetrySettings(context: Context) {
            appDataScope.launch {
                val controller = instance?.controller
                if (controller != null) {
                    controller.loadTelemetrySettings(context.applicationContext)
                } else {
                    val settings = AppDataRepository.get(context.applicationContext).getTypedSettings()
                    WatchSettingsPusher.get(context.applicationContext, appDataScope).push(settings.toWatchSettings())
                }
            }
        }

        fun reloadAlertRules(context: Context) {
            val generation = alertRulesGeneration.incrementAndGet()
            appDataScope.launch {
                alertRulesReloadMutex.withLock {
                    instance?.controller?.loadAlertRules(context.applicationContext, generation)
                }
            }
        }

        internal fun isLatestAlertRulesGeneration(generation: Long): Boolean =
            alertRulesGeneration.get() == generation

        internal fun legalModeEnableError(boardId: String): Pair<String, String>? =
            instance?.controller?.legalModeEnableError(boardId)
                ?: ("LEGAL_MODE_BOARD_NOT_CONNECTED" to "Matching active Board Session required")

        fun reloadPrivacyZones(context: Context) {
            appDataScope.launch {
                instance?.controller?.loadPrivacyZones(context.applicationContext)
            }
        }

        fun reloadGroupRideTarget(context: Context) {
            appDataScope.launch {
                instance?.controller?.loadGroupRideTarget(context.applicationContext)
            }
        }

        fun reloadBoardData() {
            appDataScope.launch {
                instance?.controller?.reloadBoardDataForActiveBoard()
            }
        }

        fun previewAlertSound(context: Context, spec: String) {
            instance?.controller?.previewAlertSound(spec) ?: AlertFeedback.preview(context, spec, kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().audioSource })
        }

        internal fun previewWeatherAlert(context: Context, line: WeatherAlertLine) {
            instance?.controller?.previewWeatherAlert(line) ?: AlertFeedback.previewVoice(context, line.voiceAnnouncement(), kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().audioSource })
        }

        fun playPackSound(context: Context, pack: String, slot: String) {
            AlertFeedback.previewPackSound(context, pack, slot, kotlinx.coroutines.runBlocking { AppDataRepository.get(context).getTypedSettings().audioSource })
        }

        fun alertSoundPresets(): List<Map<String, Any>> = alertSoundMaps()

        fun currentLiveState(context: Context, includeRecent: Boolean = true): Map<String, Any?> {
            RecordingStorageFailure.initialize(context.applicationContext)
            return instance?.controller?.liveStateMap(includeRecent)
                ?: idleState(AppDataRepository.get(context.applicationContext))
        }

        fun storageUnavailableLiveState(): Map<String, Any?> =
            liveStateWithStorageFailure(
                instance?.controller?.liveStateMapWithoutStorage() ?: idleState(null),
                RecordingStorageFailure.value() ?: RecordingStorageFailureKind.StorageUnavailable,
            )

        fun currentRemoteTiltState(): Map<String, Any?>? = instance?.controller?.remoteTiltState()

        fun currentGroundClearanceTilt(): Map<String, Any?> =
            instance?.controller?.groundClearanceTiltState()
                ?: mapOf("bound" to false, "driving" to false, "release" to null)

        fun currentRiderPosition(): LocationSnapshot? = instance?.controller?.riderPosition()

        private fun idleState(repository: AppDataRepository?): Map<String, Any?> {
            val settings = repository?.let { kotlinx.coroutines.runBlocking { it.getTypedSettings() } }
            return mapOf(
                "board" to mapOf(
                    "phase" to "idle",
                    "selectedBoardId" to settings?.selectedBoardId,
                    "connectedBoardId" to null,
                    "bleId" to null,
                    "name" to null,
                    "connectionSeq" to 0L,
                    "lastTelemetryAt" to null,
                    "recentTelemetry" to emptyList<Map<String, Any?>>(),
                    "error" to null,
                    "autoConnect" to (settings?.autoConnect ?: false),
                    "linkIntegrity" to LinkIntegrity.Unknown.wireValue,
                    "remoteTilt" to null,
                ),
                "gps" to mapOf(
                    // @platform-diff Android defers GPS arming to the foreground service; iOS has
                    // no serviceless window, its monitor reports `starting` itself.
                    "phase" to if (pendingGpsStart) "starting" else "idle",
                    "mode" to GpsPowerMode.Off.slug,
                    "latestFix" to null,
                    "latestApproximateFix" to null,
                    "latestPreciseFix" to null,
                    "recentLocations" to emptyList<Map<String, Any?>>(),
                    "error" to null,
                ),
                "scan" to mapOf(
                    "phase" to "idle",
                    "devices" to emptyList<Map<String, Any?>>(),
                    "error" to null,
                ),
                "recording" to mapOf(
                    "enabled" to false,
                    "paused" to false,
                    "activeBoardId" to null,
                    "startedAt" to null,
                    "failure" to RecordingStorageFailure.value()?.let(::recordingFailureState),
                ),
            )
        }
    }

    internal lateinit var controller: BoardSessionController
        private set

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        RecordingStorageFailure.initialize(applicationContext)
        controller = BoardSessionController(this)
        instance = this
        controller.onCreate()
        controller.appVisible = appVisible
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_SESSION -> controller.consumePendingStart()
            ACTION_STOP_SESSION -> controller.consumePendingStop()
            ACTION_EXIT_FROM_NOTIFICATION -> controller.exitFromNotification()
            ACTION_CONNECT_FROM_NOTIFICATION -> controller.connectSelectedBoardFromNotification()
            ACTION_DISCONNECT_FROM_NOTIFICATION -> controller.disconnectFromNotification()
            ACTION_START_GPS_MONITORING -> controller.consumePendingGpsStart()
            ACTION_STOP_GPS_MONITORING -> controller.stopGpsMonitoring()
            ACTION_START_GROUP_RIDE_OBSERVE -> controller.consumePendingGroupRideObserve()
            ACTION_AUTO_CONNECT_SELECTED_BOARD -> {
                controller.promoteConnectedDeviceForeground()
                controller.autoConnectSelectedBoard()
            }
            ACTION_AUTO_CONNECT_ACCESSORIES -> {
                controller.promoteConnectedDeviceForeground()
                AccessorySessionManager.start(applicationContext)
            }
            ACTION_COMPANION_DEVICE_APPEARED -> {
                controller.promoteConnectedDeviceForeground()
                intent.getStringExtra(EXTRA_COMPANION_ADDRESS)?.let(controller::connectCompanionDevice)
                    ?: controller.stopIfIdle()
            }
            else -> controller.stopIfIdle()
        }
        return if (controller.isStopping) START_NOT_STICKY else START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        controller.exitFromNotification()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        AccessorySessionManager.stopAll()
        controller.onServiceDestroy()
        instance = null
        super.onDestroy()
    }
}
