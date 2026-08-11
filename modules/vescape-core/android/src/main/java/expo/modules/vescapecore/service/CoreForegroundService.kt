package expo.modules.vescapecore.service

import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.connection.BoardSessionController
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.notification.NotificationController
import expo.modules.vescapecore.config.PendingConfigRead
import expo.modules.vescapecore.config.PendingConfigWrite
import expo.modules.vescapecore.config.RefloatConfigErrorCode
import expo.modules.vescapecore.alerts.alertSoundPresetMaps

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.DEFAULT_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.telemetry.MAX_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.telemetry.MIN_LIVE_HISTORY_LIMIT_MINUTES
import expo.modules.vescapecore.telemetry.TelemetryRepository
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
private const val ACTION_STOP_GROUP_RIDE_OBSERVE = "expo.modules.vescapecore.ACTION_STOP_GROUP_RIDE_OBSERVE"
internal const val ACTION_AUTO_CONNECT_SELECTED_BOARD = "expo.modules.vescapecore.ACTION_AUTO_CONNECT_SELECTED_BOARD"
internal const val ACTION_COMPANION_DEVICE_APPEARED = "expo.modules.vescapecore.ACTION_COMPANION_DEVICE_APPEARED"
internal const val EXTRA_COMPANION_ADDRESS = "expo.modules.vescapecore.EXTRA_COMPANION_ADDRESS"
internal const val TELEMETRY_STALE_MS = 4_000L

data class SessionConfig(
    val appBoardId: String?,
    val deviceId: String?,
    val deviceName: String,
    val transport: BoardTransport?,
    val linkVersion: Int? = null,
    /** Probe-confirmed smart-BMS presence. `null` = unknown (legacy link) → still polled. */
    val hasBms: Boolean? = null,
    val vescFirmwareVersion: String? = null,
    val refloatVersion: String? = null,
    val refloatBaseVersion: String? = null,
    val pollIntervalMs: Long,
    val recordingEnabled: Boolean,
    val telemetryRecordingEnabled: Boolean,
    val autoReconnect: Boolean = false,
    /**
     * Debug Recording name driving this session through a ReplayTransport instead of the real GATT
     * client (ADR 0024). Replay sessions run under a synthetic `replay:` board id with
     * `recordingEnabled = false` and `autoReconnect = false`.
     */
    val replayRecordingName: String? = null,
    /**
     * How much of the recording plays faster than real time before playback settles to 1×, and how
     * much faster. `0` — the default and what the dev Replay UI uses — is a plain 1× replay.
     *
     * @see expo.modules.vescapecore.replay.ReplayClock
     */
    val replayWarmupMs: Long = 0L,
    val replayWarmupSpeed: Double = 1.0,
)

internal data class PendingStart(
    val boardConfig: SessionConfig,
    val onSuccess: () -> Unit,
    val onError: (String, String) -> Unit,
)

internal data class PendingStop(val onSuccess: () -> Unit)

/**
 * Thin Android [Service] shell. Owns lifecycle (foreground notification, START/STOP intents) and the
 * static JS bridge, delegating all durable session state and orchestration to [BoardSessionController].
 */
@SuppressLint("MissingPermission")
class CoreForegroundService : Service() {
    companion object {
        var emitEvent: ((String, Map<String, Any?>) -> Unit)? = null

        private var instance: CoreForegroundService? = null
        internal var pendingStart: PendingStart? = null
        internal var pendingStop: PendingStop? = null
        internal var pendingConfigRead: PendingConfigRead? = null
        internal var pendingConfigWrite: PendingConfigWrite? = null
        internal var pendingGpsStart = false
        internal var pendingGroupRideUrl: String? = null
        internal val appDataScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val alertRulesGeneration = AtomicLong(0)
        private val alertRulesReloadMutex = Mutex()

        // Board Warning registry writes run on a single thread so a burst of findings (e.g. a
        // cell-spread warn then critical) commits its get-then-upsert pairs in submission order.
        // On the multi-threaded IO pool they could reorder and let an older warn overwrite a newer
        // critical, violating the monotonic-severity contract.
        internal val warningWriteDispatcher =
            Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "vesc-warning-writes") }
                .asCoroutineDispatcher()

        // start/stop/gps requests are dispatched twice: synchronously by the caller thread and
        // again on the main thread via onStartCommand. Claim atomically so only one path wins,
        // otherwise the pending promise settles twice and crashes the service.
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

        fun startBoardSession(
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
            instance?.controller?.consumePendingStart()
        }

        fun stopBoardSession(context: Context, onSuccess: () -> Unit = {}) {
            val service = instance
            if (service == null) {
                // No service, no session: settle the promise instead of reviving it just to stop.
                pendingStop = null
                onSuccess()
                return
            }
            pendingStop = PendingStop(onSuccess)
            val intent = Intent(context, CoreForegroundService::class.java).apply {
                action = ACTION_STOP_SESSION
            }
            context.startService(intent)
            service.controller.consumePendingStop()
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

        fun getRefloatConfigSnapshot(
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

        fun setRemoteTilt(value: Int): Boolean = instance?.controller?.setRemoteTilt(value) ?: false

        fun lockRemoteTilt(value: Int): Boolean = instance?.controller?.lockRemoteTilt(value) ?: false

        fun releaseRemoteTilt(value: Int, durationMs: Long): Boolean =
            instance?.controller?.releaseRemoteTilt(value, durationMs) ?: false

        fun stopRemoteTilt(): Boolean = instance?.controller?.stopRemoteTilt() ?: false

        fun startBoardMove(input: Int): Boolean = instance?.controller?.startBoardMove(input) ?: false

        fun stopBoardMove(): Boolean = instance?.controller?.stopBoardMove() ?: false

        /** Wrist Board Move tick (ADR-0033). Dropped when no session is running — nothing to move. */
        fun watchMove(direction: Int) {
            instance?.controller?.watchMove(direction)
        }

        fun pushProfileToBoard(
            context: Context,
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
            pendingConfigWrite = PendingConfigWrite(profileId, onSuccess, onError)
            service.controller.consumePendingConfigWrite()
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

        /**
         * Stopping something that is not running must not *create* the service. A start intent
         * revives a dead service, and a revived service whose only work is a stop goes straight
         * back to `stopSelf()` — if Android was still waiting on a `startForeground()` from an
         * overlapping foreground start, that teardown kills the process with
         * ForegroundServiceDidNotStartInTimeException. No instance ⇒ no GPS monitoring ⇒ nothing
         * to stop.
         */
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
            instance?.controller?.consumePendingGroupRideObserve()
        }

        fun stopGroupRideObserve(context: Context) {
            pendingGroupRideUrl = null
            val service = instance ?: return
            val intent = Intent(context, CoreForegroundService::class.java).apply {
                action = ACTION_STOP_GROUP_RIDE_OBSERVE
            }
            context.startService(intent)
            service.controller.stopGroupRideObserve()
        }

        /** Create a Group Ride over the live observe socket. No-op when the service is not running. */
        fun createGroupRide(
            @Suppress("UNUSED_PARAMETER") context: Context,
            riderId: String,
            riderName: String,
            riderColor: String?,
            name: String?,
            lat: Double,
            lng: Double,
        ) {
            instance?.controller?.createGroupRide(riderId, riderName, riderColor, name, lat, lng)
        }

        fun joinGroupRide(
            @Suppress("UNUSED_PARAMETER") context: Context,
            riderId: String,
            riderName: String,
            riderColor: String?,
            rideId: String,
        ) {
            instance?.controller?.joinGroupRide(riderId, riderName, riderColor, rideId)
        }

        fun leaveGroupRide(@Suppress("UNUSED_PARAMETER") context: Context) {
            instance?.controller?.leaveGroupRide()
        }

        fun updateGroupRideIdentity(
            @Suppress("UNUSED_PARAMETER") context: Context,
            riderId: String,
            riderName: String,
            riderColor: String?,
        ) {
            instance?.controller?.updateGroupRideIdentity(riderId, riderName, riderColor)
        }

        /**
         * Offer a compass reading to whatever Debug Recording is running. No service, no session or
         * no active recorder means it is simply dropped — JS pushes these unconditionally while the
         * map's heading layer is live, and native is the one that knows whether anything is
         * recording.
         */
        fun recordPhoneHeading(context: Context, headingDeg: Double) {
            instance?.controller?.recordPhoneHeading(headingDeg)
        }

        fun setTelemetryRecordingEnabled(context: Context, enabled: Boolean) {
            RecordingCoordinator.requestTelemetryRecording(enabled)
            instance?.controller?.setTelemetryRecordingEnabled(enabled)
            if (!enabled) TelemetryRepository.get(context.applicationContext).flushBlocking()
        }

        fun setBmsSeriesFocused(focused: Boolean) {
            instance?.controller?.setBmsSeriesFocused(focused)
        }

        fun setLiveHistoryLimit(limit: Number?) {
            val minutes = (limit?.toInt() ?: DEFAULT_LIVE_HISTORY_LIMIT_MINUTES)
                .coerceIn(MIN_LIVE_HISTORY_LIMIT_MINUTES, MAX_LIVE_HISTORY_LIMIT_MINUTES)
            instance?.controller?.applyLiveHistoryLimitMinutes(minutes)
        }

        fun reloadTelemetrySettings(context: Context) {
            appDataScope.launch {
                instance?.controller?.loadTelemetrySettings(context.applicationContext)
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

        /** Refresh the Group Ride presence Privacy Zone gate after a zone change (issue #144). */
        fun reloadPrivacyZones(context: Context) {
            appDataScope.launch {
                instance?.controller?.loadPrivacyZones(context.applicationContext)
            }
        }

        /** Refresh the shared Group Ride target after a direction Map Point change. */
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

        fun previewAlertSound(context: Context, soundType: String) {
            instance?.controller?.previewAlertSound(soundType) ?: AlertFeedback.preview(context, soundType)
        }

        fun alertSoundPresets(): List<Map<String, Any>> = alertSoundPresetMaps()

        fun currentLiveState(context: Context): Map<String, Any?> =
            instance?.controller?.liveStateMap(includeRecent = true)
                ?: idleState(AppDataRepository.get(context.applicationContext))

        fun currentRemoteTiltState(): Map<String, Any?>? = instance?.controller?.remoteTiltState()

        /** Live rider position for Navigation; null while the service is not up. */
        fun currentRiderPosition(): LocationSnapshot? = instance?.controller?.riderPosition()

        private fun idleState(repository: AppDataRepository): Map<String, Any?> {
            val settings = kotlinx.coroutines.runBlocking { repository.getTypedSettings() }
            return mapOf(
                "board" to mapOf(
                    "phase" to "idle",
                    "selectedBoardId" to settings.selectedBoardId,
                    "connectedBoardId" to null,
                    "bleId" to null,
                    "name" to null,
                    "connectionSeq" to 0L,
                    "lastTelemetryAt" to null,
                    "recentTelemetry" to emptyList<Map<String, Any?>>(),
                    "error" to null,
                    "autoConnect" to settings.autoConnect,
                    "remoteTilt" to null,
                ),
                "gps" to mapOf(
                    "phase" to "idle",
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
                    "activeBoardId" to null,
                    "startedAt" to null,
                ),
            )
        }
    }

    internal lateinit var controller: BoardSessionController
        private set

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        controller = BoardSessionController(this)
        instance = this
        controller.onCreate()
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
            ACTION_STOP_GROUP_RIDE_OBSERVE -> controller.stopGroupRideObserve()
            ACTION_AUTO_CONNECT_SELECTED_BOARD -> {
                controller.promoteConnectedDeviceForeground()
                controller.autoConnectSelectedBoard()
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
        controller.onServiceDestroy()
        instance = null
        super.onDestroy()
    }
}
