package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.toCapture

import expo.modules.vescapecore.service.foregroundServiceType
import expo.modules.vescapecore.service.ACTION_CONNECT_FROM_NOTIFICATION
import expo.modules.vescapecore.service.ACTION_DISCONNECT_FROM_NOTIFICATION
import expo.modules.vescapecore.service.ACTION_EXIT_FROM_NOTIFICATION
import expo.modules.vescapecore.alerts.AlertCoordinator
import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.alerts.withLegalModeOverlay
import expo.modules.vescapecore.location.LegalPolicyCatalog
import expo.modules.vescapecore.telemetry.BmsSeriesFrame
import expo.modules.vescapecore.telemetry.BmsSeriesRing
import expo.modules.vescapecore.protocol.BmsTelemetry
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.service.BoardProbeAutoStartGate
import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_FW_VERSION
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.service.CompanionRestartGate
import expo.modules.vescapecore.config.ConfigConnectionSnapshot
import expo.modules.vescapecore.config.ConfigRWController
import expo.modules.vescapecore.config.ConfigRWControllerPort
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.location.GpsMonitor
import expo.modules.vescapecore.location.isPreciseGpsFix
import expo.modules.vescapecore.GroupRideObserver
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.telemetry.LiveSeriesEmitter
import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.location.LocationTracker
import expo.modules.vescapecore.service.ManualDisconnectAutoStartGate
import expo.modules.vescapecore.notification.NotificationController
import expo.modules.vescapecore.config.PendingConfigRead
import expo.modules.vescapecore.service.PendingStart
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.reconnect.ReconnectBleScanner
import expo.modules.vescapecore.config.RefloatConfigProtocol
import expo.modules.vescapecore.config.RefloatConfigProtocolResult
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.BoardMoveController
import expo.modules.vescapecore.RemoteTiltController
import expo.modules.vescapecore.RiderPresence
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.service.TELEMETRY_STALE_MS
import expo.modules.vescapecore.TargetPoint
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import expo.modules.vescapecore.protocol.SessionTransport
import expo.modules.vescapecore.protocol.VescGattClient
import expo.modules.vescapecore.protocol.VescGattListener
import expo.modules.vescapecore.replay.ReplayLocation
import expo.modules.vescapecore.replay.ReplayHeading
import expo.modules.vescapecore.replay.ReplayClock
import expo.modules.vescapecore.replay.ReplayTransport
import expo.modules.vescapecore.VescLiveStateSnapshot
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.watch.GeoPoint
import expo.modules.vescapecore.watch.WatchMirrorLauncher
import expo.modules.vescapecore.watch.WATCH_MIRROR_AWAKE_TIMEOUT_MS
import expo.modules.vescapecore.watch.WatchMirrorPresence
import expo.modules.vescapecore.watch.WatchMirrorWakeLevel
import expo.modules.vescapecore.watch.WatchMoveRelay
import expo.modules.vescapecore.watch.WatchRouteMirror
import expo.modules.vescapecore.watch.WatchSettingsPusher
import expo.modules.vescapecore.watch.WatchSnapshot
import expo.modules.vescapecore.watch.WatchTelemetryPusher
import expo.modules.vescapecore.watch.WatchTick
import expo.modules.vescapecore.watch.WatchWeatherPusher
import expo.modules.vescapecore.watch.toWatchWeather
import expo.modules.vescapecore.weather.Weather
import expo.modules.vescapecore.weather.WeatherCoordinator
import expo.modules.vescapecore.watch.offsetMeters
import expo.modules.vescapecore.watch.toWatchSettings
import expo.modules.vescapecore.buildLiveState
import expo.modules.vescapecore.telemetry.encodeBmsSeriesColumns
import expo.modules.vescapecore.service.foregroundServiceTypeForConnectedDevicePromotion
import expo.modules.vescapecore.protocol.parseBmsValues
import expo.modules.vescapecore.protocol.parseFwVersion
import expo.modules.vescapecore.protocol.parseRefloatGetAllData
import expo.modules.vescapecore.remoteTiltWire
import expo.modules.vescapecore.warnings.BatteryConfigMismatchDetector
import expo.modules.vescapecore.warnings.BoardWarningKind
import expo.modules.vescapecore.warnings.BoardWarningRegistry
import expo.modules.vescapecore.warnings.BoardWarningSeverity
import expo.modules.vescapecore.warnings.BoardWarningStore
import expo.modules.vescapecore.warnings.CellSpreadDetector
import expo.modules.vescapecore.config.BoardConfigFreshness
import expo.modules.vescapecore.config.BoardConfigValues
import expo.modules.vescapecore.warnings.ConfigSafetyDetector
import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import java.io.File
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.launch
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.vescapecore.config.ConfigRWEvent
import expo.modules.vescapecore.diagnostics.DiagnosticContext
import expo.modules.vescapecore.diagnostics.DiagnosticsRecorder
import expo.modules.vescapecore.notification.NotificationPresenter
import expo.modules.vescapecore.notification.NotificationUpdateGate
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.reconnect.ReconnectListener
import expo.modules.vescapecore.reconnect.ReconnectPolicy
import expo.modules.vescapecore.reconnect.ReconnectScanMatch
import expo.modules.vescapecore.reconnect.ReconnectScheduler
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.HandlerScheduler
import expo.modules.vescapecore.runtime.LinkIdentity
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.runtime.SessionClock
import expo.modules.vescapecore.runtime.SystemSessionClock
import expo.modules.vescapecore.runtime.postDelayedForSession
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.telemetry.BatterySocEstimator
import expo.modules.vescapecore.telemetry.DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH
import expo.modules.vescapecore.telemetry.IDLE_PAUSE_POLL_INTERVAL_MS
import expo.modules.vescapecore.telemetry.IdlePauseDetector
import expo.modules.vescapecore.telemetry.IdlePauseTransition
import expo.modules.vescapecore.telemetry.METRIC_MAX_DUTY
import expo.modules.vescapecore.telemetry.PrivacyZoneEntity
import expo.modules.vescapecore.telemetry.SocMedianWindow
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryPipeline
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.telemetry.isInsideAnyPrivacyZone
import expo.modules.vescapecore.telemetry.toMetricSanitizerConfig

private const val CHANNEL_ID = "vesc_monitoring_v5"
private const val NOTIFICATION_ID = 1001
private const val HISTORY_FLUSH_INTERVAL_MS = 300L
private const val LIVE_SERIES_INTERVAL_MS = 1_000L
private const val LIVE_SERIES_BUCKETS = 64
private const val WATCH_FRAME_INTERVAL_MS = 250L

/** Push cadence while the Mirror sits in ambient/AOD, where the wrist itself redraws about once a minute. */
private const val WATCH_FRAME_AMBIENT_INTERVAL_MS = 5_000L
private const val NOTIFICATION_TELEMETRY_INTERVAL_MS = 10_000L
private const val GATT_CONNECT_TIMEOUT_MS = 6_000L
private const val GATT_READY_TIMEOUT_MS = 6_000L

/** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `legalModeEnableError` */
internal fun legalModeEnableError(
    phase: BoardPhase,
    activeBoardId: String?,
    linkIntegrity: LinkIntegrity,
    requestedBoardId: String,
): Pair<String, String>? {
    if (phase != BoardPhase.Connected || activeBoardId != requestedBoardId) {
        return "LEGAL_MODE_BOARD_NOT_CONNECTED" to "Matching active Board Session required"
    }
    if (linkIntegrity != LinkIntegrity.Trusted) {
        return "LINK_NOT_TRUSTED" to "Trusted Board Link required to enable Legal Mode"
    }
    return null
}

/**
 * Owns the durable board-session state and orchestration. [CoreForegroundService] is a thin Android
 * shell delegating lifecycle + the static JS bridge here. Holds a [service] reference solely for the
 * Android primitives the orchestration needs (Context, foreground notification, stopSelf, filesDir).
 */
@SuppressLint("MissingPermission")
internal class BoardSessionController(private val service: CoreForegroundService) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scheduler: Scheduler = HandlerScheduler(mainHandler)
    private val packetReassembler = VescPacketReassembler()
    private val pollingLoop = PollingLoop(
        scheduler = scheduler,
        isCurrentSession = ::isCurrentBoardSession,
        sendPayloadWithRetry = { payload, session -> sendPayloadWithRetry(payload, session) },
    )
    // Idle Pause (ADR-0021): while recording a stationary board, throttle polling to ~1 Hz and stop
    // persisting samples. configuredPollIntervalMs / movingThresholdCentiKmh are cached from settings
    // so the hot path can flip pacing without re-reading settings.
    private val idlePauseDetector = IdlePauseDetector()
    private var configuredPollIntervalMs: Long = 0L
    private var movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH
    private val connectionCoordinator = ConnectionCoordinator(
        scheduler = scheduler,
        isCurrentSession = ::isCurrentBoardSession,
    )
    private val remoteTiltController = RemoteTiltController(
        scheduler = scheduler,
        transport = {
            if (boardStatus == BoardPhase.Connected && boardConfig != null) currentBoardTransport() else null
        },
        send = { payload, urgent -> transport.sendRemoteInput(payload, urgent) },
    )
    private val boardMoveController = BoardMoveController(
        scheduler = scheduler,
        transport = {
            if (boardStatus == BoardPhase.Connected && boardConfig != null) currentBoardTransport() else null
        },
        canMove = ::firmwareCommandsTrusted,
        generation = { BoardMoveGeneration.forBaseVersion(boardConfig?.refloatBaseVersion) },
        send = { payload, urgent -> transport.sendRemoteInput(payload, urgent) },
    )
    private val notificationController by lazy {
        NotificationController(
            service = service,
            serviceClass = CoreForegroundService::class.java,
            channelId = CHANNEL_ID,
            notificationId = NOTIFICATION_ID,
            stopAction = ACTION_EXIT_FROM_NOTIFICATION,
            connectAction = ACTION_CONNECT_FROM_NOTIFICATION,
            disconnectAction = ACTION_DISCONNECT_FROM_NOTIFICATION,
        )
    }
    private val presenter by lazy {
        NotificationPresenter(
            controller = notificationController,
            deviceName = { boardConfig?.deviceName ?: selectedBoardName },
            sessionActive = { boardConfig != null },
            canConnect = { boardConfig == null && selectedBoardName != null },
        )
    }
    private val notificationGate = NotificationUpdateGate(NOTIFICATION_TELEMETRY_INTERVAL_MS)
    private val alertFeedback by lazy { AlertFeedback(service, mainHandler) }
    private val alertCoordinator by lazy { AlertCoordinator(feedback = { alertFeedback }) }
    private val legalPolicyCatalog by lazy { LegalPolicyCatalog(service.applicationContext) }
    private val diagnosticsRecorder: DiagnosticsRecorder by lazy {
        DiagnosticsRecorder(
            local = { name, props ->
                TelemetryRepository.get(service.applicationContext).recordDiagnosticEvent(name, props)
            },
            context = {
                DiagnosticContext(
                    phaseWire = boardStatus.wireValue,
                    connectionSeq = currentSessionId,
                    connectAttempt = connectionCoordinator.connectAttempt,
                    autoReconnectAttempt = reconnectScheduler.currentAttempt,
                    canId = currentCanId,
                    directConnection = currentBoardTransport() == BoardTransport.Direct,
                    lastSentCommand = lastSentCommand,
                    lastReceivedCommandByte = lastReceivedCommandByte,
                    lastTelemetryAt = telemetryPipeline.lastTelemetryAt,
                )
            },
        )
    }
    private val telemetryPipeline: TelemetryPipeline = TelemetryPipeline(
        scheduler = scheduler,
        onTelemetryStale = ::onTelemetryStaleFired,
        captureBuilder = { parsed, cfg, id -> parsed.toCapture(cfg, id) },
        nowMs = ::nowMs,
        staleTimeoutMs = TELEMETRY_STALE_MS,
    )
    /**
     * The clock this session stamps and compares its data against. Wall time for every real
     * session; a replay swaps in its own for the session's lifetime so a warmed-up playback writes
     * a timeline that agrees with itself. Set in [beginSession], never read directly — go through
     * [nowMs].
     */
    @Volatile
    private var sessionClock: SessionClock = SystemSessionClock

    /** @see SessionClock */
    private fun nowMs(): Long = sessionClock.nowMs()
    private val recordingCoordinator by lazy {
        RecordingCoordinator(
            context = service.applicationContext,
            applyLiveSettings = ::applyTelemetryPipelineSettings,
        )
    }
    private val liveSeriesEmitter by lazy {
        LiveSeriesEmitter(
            scheduler = scheduler,
            emitEvent = ::emitEvent,
            telemetryPipeline = telemetryPipeline,
            session = { boardSession },
            isCurrentSession = ::isCurrentBoardSession,
            generation = { currentSessionId },
            historyFlushIntervalMs = HISTORY_FLUSH_INTERVAL_MS,
            liveSeriesIntervalMs = LIVE_SERIES_INTERVAL_MS,
            liveSeriesBuckets = LIVE_SERIES_BUCKETS,
            speed = { sessionClock.speed },
        )
    }
    private val watchPusher by lazy {
        WatchTelemetryPusher(service.applicationContext, CoreForegroundService.appDataScope, ::recordWatchDiagnostic)
    }
    private val watchSettingsPusher by lazy {
        WatchSettingsPusher(service.applicationContext, CoreForegroundService.appDataScope, ::recordWatchDiagnostic)
    }
    private val watchWeatherPusher by lazy {
        WatchWeatherPusher(service.applicationContext, CoreForegroundService.appDataScope, ::recordWatchDiagnostic)
    }
    private val weatherCoordinator = WeatherCoordinator.get()

    /** Removes this controller's weather subscription; a restarted service must not stack them. */
    private var weatherUnsubscribe: (() -> Unit)? = null
    private val watchMirrorPresence by lazy {
        WatchMirrorPresence(service.applicationContext, CoreForegroundService.appDataScope, ::recordWatchDiagnostic)
    }
    private val watchMoveRelay by lazy {
        WatchMoveRelay(
            scheduler = scheduler,
            strengthPercent = { boardMoveStrengthPercent },
            startMove = ::startBoardMove,
            stopMove = ::stopBoardMove,
            record = ::recordWatchDiagnostic,
        )
    }
    private val watchMirrorLauncher by lazy {
        WatchMirrorLauncher(service.applicationContext, CoreForegroundService.appDataScope, ::recordWatchDiagnostic)
    }
    private val watchTick by lazy {
        WatchTick(
            scheduler = scheduler,
            snapshot = ::watchSnapshot,
            isStale = { telemetry != null && isTelemetryStale() },
            canPush = ::canPushWatchFrame,
            push = watchPusher::pushFrame,
            intervalMs = WATCH_FRAME_INTERVAL_MS,
        )
    }
    private val locationTracker by lazy {
        LocationTracker(
            service.applicationContext,
            CoreForegroundService.appDataScope,
            ::emitEvent,
            recordingCoordinator,
            telemetryPipeline,
        )
    }
    private val configController by lazy {
        ConfigRWController(
            scheduler,
            CoreForegroundService.appDataScope,
            { AppDataRepository.get(service.applicationContext) },
            object : ConfigRWControllerPort {
                override fun connection() =
                    ConfigConnectionSnapshot(
                        boardConfig,
                        boardStatus,
                        currentBoardTransport(),
                        fwVersionString,
                        boardSession?.linkIntegrity ?: LinkIntegrity.Unknown,
                    )
                override fun isPollingActive() = pollingLoop.isActive
                override fun stopPolling() = this@BoardSessionController.stopPolling()
                override fun startPolling() = this@BoardSessionController.startPolling()
                override fun sendPayload(payload: ByteArray) = this@BoardSessionController.sendPayload(payload)
                override fun captureDiagnostic(name: String, properties: Map<String, Any?>) =
                    this@BoardSessionController.captureDiagnostic(name, properties)
                override fun diagnosticProperties(config: SessionConfig?, category: String) =
                    this@BoardSessionController.diagnosticProperties(config, category)
                override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) =
                    this@BoardSessionController.dumpRefloatConfigDebug(xmlBytes, configBytes)
                override fun onBoardConfigValues(values: BoardConfigValues) =
                    this@BoardSessionController.onBoardConfigValues(values)
            },
        )
    }
    private val gpsMonitor by lazy {
        GpsMonitor(
            context = service,
            looper = Looper.getMainLooper(),
            onLocation = ::onLocationUpdated,
        )
    }
    private val groupRideObserver by lazy {
        GroupRideObserver(
            handler = mainHandler,
            emit = ::emitEvent,
            online = AppStatusCoordinator.get(service.applicationContext),
        )
    }

    /**
     * Enabled Privacy Zones cached for the Group Ride presence egress gate (issue #144). Refreshed
     * when observing starts and on zone CRUD; reuses the same geometry as Ride Recording
     * suppression (ADR-0009 / ADR-0020). Touched off the main thread, so kept @Volatile.
     */
    @Volatile
    private var groupRidePrivacyZones: List<PrivacyZoneEntity> = emptyList()

    /**
     * The Rider's shared map target (their direction Map Point), cached for presence egress.
     * Refreshed when observing starts and on direction-point CRUD; touched off the main
     * thread, so kept @Volatile.
     */
    @Volatile
    private var groupRideTarget: TargetPoint? = null
    private val gattClient by lazy {
        VescGattClient(
            context = service,
            handler = mainHandler,
            recorder = { recordingCoordinator.currentRecorder() },
            dispatchListener = ::dispatchGattEvent,
            listener = gattListener,
        )
    }
    /**
     * Transport seam (ADR 0024): a replay session swaps in a [ReplayTransport] for its lifetime;
     * everything else drives the real GATT client. Set in [beginSession], cleared in
     * [stopCurrentBoardSession]. All controller↔link traffic goes through [transport].
     */
    private var replayTransport: ReplayTransport? = null
    private val transport: SessionTransport get() = replayTransport ?: gattClient

    /**
     * True while a replay has parked a GPS monitor that was already running when it started, so the
     * live monitor can be re-armed when the replay ends. iOS needs no such flag: it stops the GPS
     * monitor on every session end, replay or not.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `beginSession`
     * @platform-diff Android keeps GPS monitoring alive across sessions; iOS does not.
     */
    private var gpsSuppressedByReplay = false

    private val reconnectBlePort = ReconnectBleScanner(
        scanner = { bluetoothAdapter.bluetoothLeScanner },
        scheduler = scheduler,
    )

    private val reconnectListener = object : ReconnectListener {
        override fun isReconnectActive(session: BoardSession): Boolean {
            if (!session.isActive || session !== boardSession || isStoppingService) return false
            val cfg = boardConfig ?: return false
            if (!cfg.autoReconnect) return false
            return boardStatus == BoardPhase.Reconnecting || boardStatus == BoardPhase.Rescanning
        }

        override fun onAttempt(
            session: BoardSession,
            reason: String,
            gattStatus: Int?,
            nextAttempt: Int,
        ) {
            val cfg = boardConfig ?: return
            flushTelemetryDiagnostics("reconnect")
            recordingCoordinator.recordConnectionLost(
                cfg,
                telemetryPipeline.lastTelemetryAt,
                reason,
            )
            recordLocalDiagnostic(
                "reconnect_scheduled",
                cfg,
                "connect",
                mapOf(
                    "message" to reason,
                    "reason" to reason,
                    "gatt_status" to gattStatus,
                    "auto_reconnect_next_attempt" to nextAttempt,
                ),
            )
            if (reason.contains("telemetry", ignoreCase = true)) {
                captureDiagnostic(
                    if (reason.contains("stale", ignoreCase = true)) "telemetry_stale" else "telemetry_unavailable",
                    diagnosticProperties(cfg, "telemetry") + mapOf(
                        "message" to reason,
                        "reason" to reason,
                        "gatt_status" to gattStatus,
                        "auto_reconnect_enabled" to cfg.autoReconnect,
                        "last_telemetry_timestamp" to telemetryPipeline.lastTelemetryAt.takeIf { it > 0L },
                        "telemetry_parse_failed_count" to diagnosticsRecorder.telemetryParseFailedCount(),
                    ),
                )
            }
            connectionCoordinator.clearPending()
            cancelBoardReadyTimeout()
            stopPolling()
            transport.clear(markIntentional = false)
            bmsSeriesRing.clear()
            telemetryPipeline.clearLiveTelemetry()
            boardError = reason
            transitionBoardPhase(
                next = BoardPhase.Reconnecting,
                recordName = "reconnecting",
                recordProperties = mapOf("attempt" to nextAttempt, "status" to gattStatus),
            )
        }

        override fun onScanStart(session: BoardSession) {
            transitionBoardPhase(BoardPhase.Rescanning)
            recordLocalDiagnostic(
                "reconnect_scan_started",
                boardConfig,
                "connect",
                mapOf("message" to "Reconnect scan started"),
            )
        }

        override fun onScanFound(session: BoardSession, match: ReconnectScanMatch) {
            recordLocalDiagnostic(
                "reconnect_scan_found",
                boardConfig,
                "connect",
                mapOf(
                    "message" to "Reconnect target found",
                    "scan_result_address" to match.address,
                    "rssi" to match.rssi,
                ),
            )
        }

        override fun onScanTimeout(session: BoardSession) {
            recordLocalDiagnostic(
                "reconnect_scan_timeout",
                boardConfig,
                "connect",
                mapOf(
                    "message" to "Reconnect scan timed out",
                    "timeout_ms" to ReconnectPolicy.scanTimeoutMs(),
                ),
            )
        }

        override fun onScanFailed(session: BoardSession, errorCode: Int) {
            Log.w(VESC_SESSION_TAG, "Reconnect scan failed errorCode=$errorCode")
            recordLocalDiagnostic(
                "reconnect_scan_failed",
                boardConfig,
                "connect",
                mapOf(
                    "message" to "Reconnect scan failed",
                    "error_code" to errorCode,
                ),
            )
        }

        override fun onScanStartFailed(session: BoardSession, error: String?) {
            Log.w(VESC_SESSION_TAG, "Reconnect scan start failed: $error")
            recordLocalDiagnostic(
                "reconnect_scan_start_failed",
                boardConfig,
                "connect",
                mapOf(
                    "message" to "Reconnect scan start failed",
                    "error_message" to error,
                ),
            )
        }

        override fun onMissingTarget(session: BoardSession) {
            // Re-schedule logs the next attempt; nothing to do here.
        }

        override fun onScannerUnavailable(session: BoardSession) {
            // Re-schedule logs the next attempt; nothing to do here.
        }

        override fun startDirectReconnect(session: BoardSession, reason: String) {
            val cfg = boardConfig ?: return
            recordLocalDiagnostic(
                "reconnect_direct_connect_started",
                cfg,
                "connect",
                mapOf(
                    "message" to "Reconnect direct connect started",
                    "reason" to reason,
                ),
            )
            connectionCoordinator.resetAttempts()
            boardError = null
            setStatus(BoardPhase.Connecting)
            startBleSession(PendingStart(cfg, onSuccess = {}, onError = { _, _ -> }))
        }
    }

    private val reconnectScheduler = ReconnectScheduler(
        scheduler = scheduler,
        port = reconnectBlePort,
        listener = reconnectListener,
    )

    private var boardConfig: SessionConfig? = null
    /** Held while a teardown runs inside [beginSession] so the idle repaint never flashes over the new session. */
    private var notificationRepaintSuppressed = false
    /** Name of the currently selected board, shown in the idle notification + gating its Connect action. */
    @Volatile
    private var selectedBoardName: String? = null
    @Volatile
    private var batteryConfigCache: Map<String, Any?>? = null
    /** Median window producing the Battery SoC Estimate for display + alerts (ADR-0016). */
    private val socWindow = SocMedianWindow()
    /** Live BMS Series retention (window shared with [telemetryPipeline]); push gated by [bmsSeriesFocused]. */
    private val bmsSeriesRing = BmsSeriesRing()
    /** Telemetry-scoped cell-spread Board Warning detector; fed each BMS frame, reset per session. */
    private val cellSpreadDetector = CellSpreadDetector()
    /** Telemetry-scoped BMS-vs-config cell-count mismatch detector; fed each BMS frame, reset per session. */
    private val batteryConfigMismatchDetector = BatteryConfigMismatchDetector()
    /**
     * Board Warning evaluation / registry-write sites that already captured a crash this Board Session.
     * Board Warnings are secondary: a detector bug or a failed registry DB write must never crash the
     * foreground service, and must not spam diagnostics per frame — so each site reports at most once
     * per session. Touched from the BMS hot path (main scheduler) and the app-data IO scope, so kept
     * thread-safe. Reset in [beginSession].
     * @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift `BoardWarningFailureReporter`
     */
    private val warningFailuresReported = java.util.Collections.synchronizedSet(HashSet<String>())
    /**
     * Isolates Board Warning registry writes launched on [CoreForegroundService.appDataScope]. A
     * Room/SQLite failure there is otherwise an uncaught coroutine exception routed to the default
     * handler → process crash (the scope's `SupervisorJob` isolates sibling jobs but does not swallow).
     * Captures the first failure per session and drops the rest.
     */
    private val warningWriteExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        reportWarningFailure("registry_write", throwable)
    }
    /** True while the battery-detail view is focused (JS intent); gates the `onBmsSeries` push only. */
    @Volatile
    private var bmsSeriesFocused = false
    private var lastBatteryPersistedAt = 0L
    private var boardStatus: BoardPhase = BoardPhase.Idle
    private var boardError: String? = null
    private var telemetry: RefloatTelemetry? = null
    // Latest cold-path values the watch tick reads alongside [telemetry]; reset when telemetry clears.
    private var latestBatterySoc: Double? = null
    private var latestDutyExcluded = false
    private var fwVersionString: String? = null
    private var boardReadyTimeoutHandle: Cancellable? = null
    private var gpsError: String? = null
    private var gpsSessionStartedAt: Long? = null
    private var gpsFixCount = 0
    private var gpsPreciseFixCount = 0
    private var gpsFirstFixAt: Long? = null
    private var gpsFirstPreciseFixAt: Long? = null
    private var gpsLastFixAt: Long? = null
    private var isStoppingService = false
    private var connectionSoundsEnabled = true
private var wearAutoLaunchOnConnect = true
    private var watchLaunchFiredSessionId = 0L
    /**
     * Board Move strength the wrist inherits: the wrist sends a direction, the phone owns the scale.
     * Written from the settings load (`appDataScope`), read on the session scheduler by the relay.
     */
    @Volatile
    private var boardMoveStrengthPercent = AppSettings().boardMoveStrengthPercent
    /**
     * Board Warnings master switch (kill switch, #219). Off ⇒ no detector evaluation, no registry
     * writes, no session-end clean pass. Cached from settings by [applyTelemetrySettings] so the
     * BMS hot path never re-reads settings; @Volatile because evals run on BLE callbacks while
     * updates land from appDataScope.
     */
    @Volatile
    private var boardWarningsEnabled = true
    private var autoCloseEnabled = false
    private var autoCloseDelayMinutes = 15
    private var autoCloseHandle: Cancellable? = null
    private var lastSentCommand: Int? = null
    private var lastReceivedCommandByte: Int? = null
    private var boardSession: BoardSession? = null
    private var sessionSequence: Long = 0L
    private val currentSessionId: Long get() = boardSession?.id ?: sessionSequence
    private val bluetoothAdapter: BluetoothAdapter
        get() = (service.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    // --- Android Service lifecycle hooks (driven by CoreForegroundService) ---

    fun onCreate() {
        BatterySocEstimator.init(service)
        DiagnosticReporter.initialize(service)
        notificationController.createChannel()
        refreshSelectedBoardName()
        // The wrist mirrors the phone, not the board session. Keep presence + frames alive while
        // this service owns GPS/navigation even when no board is selected or connected.
        watchMirrorPresence.start()
        watchTick.start()
        weatherUnsubscribe = weatherCoordinator.addChangeListener(::onWeatherChanged)
        // The forecast survives a service restart, so replay what is already known rather than
        // leaving the wrist blank until the rider moves a kilometre.
        weatherCoordinator.current?.let(::onWeatherChanged)
        // Arm Auto close even when the service starts without a session (companion/GPS-only):
        // applyTelemetrySettings caches the auto-close config and (re)schedules the countdown.
        CoreForegroundService.appDataScope.launch { loadTelemetrySettings(service.applicationContext) }
        // startForegroundService() is satisfied by the first real action below. Calling
        // startForeground() here would not know the intent yet and can assert a FGS type whose
        // runtime permission has not been granted.
    }

    /** Caches the selected board name so the idle notification can title it + offer Connect. */
    private fun refreshSelectedBoardName() {
        CoreForegroundService.appDataScope.launch {
            val repo = AppDataRepository.get(service.applicationContext)
            val id = repo.getTypedSettings().selectedBoardId
            selectedBoardName = id?.let { repo.getBoard(it)?.get("name") as? String }
            if (boardConfig == null && !isStoppingService) {
                // Title/Connect gating changed without a phase change — force past the phase gate.
                scheduler.post { if (boardConfig == null) refreshNotification(force = true) }
            }
        }
    }

    /** Connect to the selected board from the notification Connect action (native-initiated). */
    fun connectSelectedBoardFromNotification() {
        connectSelectedBoard(recordingEnabled = false)
    }

    /**
     * Satisfy Android's startForegroundService() deadline for native BLE starts that must do async
     * settings/DB work before a Board Session exists. The launcher already preflights
     * BLUETOOTH_CONNECT for these starts, so CONNECTED_DEVICE is the narrow valid type here.
     */
    fun promoteConnectedDeviceForeground() {
        isStoppingService = false
        startForeground(
            foregroundServiceTypeForConnectedDevicePromotion(
                boardActive = boardConfig != null,
                gpsActive = gpsMonitor.active,
            ),
        )
    }

    /** @parity /modules/vescape-core/ios/VescapeCoreModule.swift `autoConnectSelectedBoard` */
    fun autoConnectSelectedBoard() {
        if (BoardProbeAutoStartGate.isActive()) {
            Log.i(VESC_SESSION_TAG, "Auto-connect skipped: Board Probe active")
            scheduler.post { stopIfIdle() }
            return
        }
        CoreForegroundService.appDataScope.launch {
            val settings = AppDataRepository.get(service.applicationContext).getTypedSettings()
            if (!settings.autoConnect || settings.selectedBoardId == null) {
                scheduler.post { stopIfIdle() }
                return@launch
            }
            if (ManualDisconnectAutoStartGate.isSuppressed(service.applicationContext, settings.selectedBoardId)) {
                Log.i(VESC_SESSION_TAG, "Auto-connect suppressed after manual disconnect")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            scheduler.post { connectSelectedBoard(recordingEnabled = false) }
        }
    }

    fun connectCompanionDevice(address: String) {
        if (boardConfig != null) return
        isStoppingService = false
        CoreForegroundService.appDataScope.launch {
            val appCtx = service.applicationContext
            if (BoardProbeAutoStartGate.isActive()) {
                Log.i(VESC_SESSION_TAG, "Companion auto start skipped: Board Probe active")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            if (CompanionRestartGate.isSuppressed(appCtx)) {
                Log.i(VESC_SESSION_TAG, "Companion auto start suppressed after manual exit")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            val boardId = companionBoardId(AppDataRepository.get(appCtx), address)
            if (boardId == null) {
                scheduler.post { stopIfIdle() }
                return@launch
            }
            if (ManualDisconnectAutoStartGate.isSuppressed(appCtx, boardId)) {
                Log.i(VESC_SESSION_TAG, "Companion auto start suppressed after manual disconnect")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            // Presence can belong to any configured Board, not necessarily the last one the Rider
            // used. Make the triggering Board selected before building/emitting the new session.
            AppDataRepository.get(appCtx).setSelectedBoardId(boardId)
            val config = try {
                buildSessionConfig(appCtx, boardId, recordingEnabled = false)
            } catch (e: Exception) {
                Log.w(VESC_SESSION_TAG, "Companion connect config failed: ${e.message}")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            scheduler.post {
                if (boardConfig == null) {
                    beginSession(
                        PendingStart(
                            config,
                            onSuccess = {},
                            onError = { _, message -> Log.w(VESC_SESSION_TAG, "Companion connect failed: $message") },
                        ),
                    )
                }
            }
        }
    }

    private suspend fun companionBoardId(repo: AppDataRepository, address: String): String? {
        val settings = repo.getTypedSettings()
        if (!settings.companionPresenceEnabled) return null
        return companionBoardIdForAddress(repo.getBoards(), address)
    }

    private fun connectSelectedBoard(recordingEnabled: Boolean) {
        if (boardConfig != null) return
        CoreForegroundService.appDataScope.launch {
            val appCtx = service.applicationContext
            val boardId = AppDataRepository.get(appCtx).getTypedSettings().selectedBoardId ?: return@launch
            ManualDisconnectAutoStartGate.clear(appCtx)
            val config = try {
                buildSessionConfig(appCtx, boardId, recordingEnabled = recordingEnabled)
            } catch (e: Exception) {
                Log.w(VESC_SESSION_TAG, "Notification connect failed: ${e.message}")
                scheduler.post { stopIfIdle() }
                return@launch
            }
            scheduler.post {
                if (boardConfig == null) beginSession(PendingStart(config, onSuccess = {}, onError = { _, _ -> }))
            }
        }
    }

    /** Disconnect the active session from the notification Disconnect action (native-initiated). */
    fun disconnectFromNotification() {
        if (boardConfig == null) return
        setStatus(BoardPhase.Disconnecting)
        ManualDisconnectAutoStartGate.suppress(service.applicationContext, boardConfig?.appBoardId)
        // Always refresh: the notification stays visible after disconnect (idle + Connect), so it must
        // reflect the idle phase even while GPS keeps the service foregrounded.
        stopCurrentBoardSession(emitDisconnected = true)
    }

    fun onServiceDestroy() {
        weatherUnsubscribe?.invoke()
        weatherUnsubscribe = null
        watchTick.stop()
        watchMirrorPresence.stop()
        watchMoveRelay.cancel()
        autoCloseHandle?.cancel()
        autoCloseHandle = null
        if (!isStoppingService) {
            stopCurrentBoardSession(emitDisconnected = false)
        }
        alertFeedback.release()
        stopLocationUpdates()
        groupRideObserver.stop()
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
    }

    val isStopping: Boolean get() = isStoppingService

    fun stopIfIdle() {
        if (boardConfig == null && !gpsMonitor.active && !groupRideObserver.active) {
            isStoppingService = true
            notificationController.cancel()
            service.stopSelf()
        }
    }

    fun consumePendingStart() {
        val start = CoreForegroundService.claimPendingStart() ?: return
        beginSession(start)
    }

    fun consumePendingStop() {
        val stop = CoreForegroundService.claimPendingStop() ?: return
        if (boardConfig != null) {
            setStatus(BoardPhase.Disconnecting)
            ManualDisconnectAutoStartGate.suppress(service.applicationContext, boardConfig?.appBoardId)
            // Always refresh, exactly like the notification Disconnect action: the notification
            // outlives the Board Session (idle + Connect), so a JS disconnect must repaint it too.
            stopCurrentBoardSession(emitDisconnected = true)
            stop.onSuccess()
            return
        }
        stop.onSuccess()
        if (!gpsMonitor.active && !groupRideObserver.active) {
            isStoppingService = true
            service.stopSelf()
        }
    }

    fun consumePendingConfigRead() {
        val pending = CoreForegroundService.pendingConfigRead ?: return
        CoreForegroundService.pendingConfigRead = null
        configController.consumeRead(pending)
    }

    fun consumePendingConfigWrite() {
        val pending = CoreForegroundService.pendingConfigWrite ?: return
        CoreForegroundService.pendingConfigWrite = null
        configController.consumeWrite(pending)
    }

    fun consumePendingGpsStart() {
        if (!CoreForegroundService.claimPendingGpsStart()) return
        startGpsMonitoring()
    }

    fun consumePendingGroupRideObserve() {
        val url = CoreForegroundService.claimPendingGroupRideUrl() ?: return
        isStoppingService = false
        CoreForegroundService.appDataScope.launch {
            loadPrivacyZones(service.applicationContext)
            loadGroupRideTarget(service.applicationContext)
        }
        groupRideObserver.start(url)
        reassertForeground()
    }

    fun stopGroupRideObserve() {
        CoreForegroundService.pendingGroupRideUrl = null
        groupRideObserver.stop()
        if (boardConfig == null && !gpsMonitor.active) {
            isStoppingService = true
            service.stopSelf()
        }
    }

    fun createGroupRide(riderId: String, riderName: String, riderColor: String?, name: String?, lat: Double, lng: Double) {
        groupRideObserver.create(riderId, riderName, riderColor, name, lat, lng)
    }

    fun joinGroupRide(riderId: String, riderName: String, riderColor: String?, rideId: String) {
        startGpsMonitoring()
        groupRideObserver.join(riderId, riderName, riderColor, rideId, latestRiderPresence())
    }

    fun leaveGroupRide() {
        groupRideObserver.leave()
    }

    fun updateGroupRideIdentity(riderId: String, riderName: String, riderColor: String?) {
        groupRideObserver.updateIdentity(riderId, riderName, riderColor)
    }

    fun exitFromNotification() {
        armCompanionRestartGate()
        isStoppingService = true
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
        notificationController.cancel()
        stopCurrentBoardSession(emitDisconnected = true)
        stopLocationUpdates()
        closeAppTask()
        service.stopSelf()
    }

    // Manual exit means the user is done riding: pause companion auto start for the configured
    // cooldown so the board reappearing doesn't immediately relaunch the app.
    private fun armCompanionRestartGate() {
        val appCtx = service.applicationContext
        CoreForegroundService.appDataScope.launch {
            val settings = AppDataRepository.get(appCtx).getTypedSettings()
            if (settings.companionPresenceEnabled) {
                CompanionRestartGate.suppressFor(appCtx, settings.companionPresenceCooldownMinutes)
            }
        }
    }

    private fun startGpsMonitoring() {
        isStoppingService = false
        gpsError = null
        startLocationUpdates()
        emitState()
        reassertForeground()
    }

    fun stopGpsMonitoring() {
        CoreForegroundService.pendingGpsStart = false
        stopLocationUpdates()
        gpsError = null
        emitState()
        if (boardConfig == null && !groupRideObserver.active) {
            isStoppingService = true
            service.stopSelf()
        } else {
            reassertForeground()
        }
    }

    private fun beginSession(start: PendingStart) {
        isStoppingService = false
        withNotificationRepaintSuppressed { stopCurrentBoardSession(emitDisconnected = false) }
        refreshLiveHistoryLimit()
        boardConfig = start.boardConfig
        // Load rules only after boardConfig is assigned — the engine scopes to the connected Board's
        // rules (#254), so reading before assignment would install the wrong Board's (or no) rules.
        CoreForegroundService.reloadAlertRules(service.applicationContext)
        replayTransport = start.boardConfig.replayRecordingName?.let {
            ReplayTransport(
                context = service,
                handler = mainHandler,
                recordingName = it,
                listener = gattListener,
                dispatchListener = ::dispatchGattEvent,
                onLocation = ::onReplayLocation,
                onHeading = ::onReplayHeading,
                clock = ReplayClock(
                    warmupMs = start.boardConfig.replayWarmupMs,
                    warmupSpeed = start.boardConfig.replayWarmupSpeed,
                ),
            )
        }
        // A replay owns the session's notion of time for its lifetime.
        sessionClock = replayTransport?.clock ?: SystemSessionClock
        // Guarding [startLocationUpdates] is not enough: the map, the recording toggle or a prior
        // live session may already have the GPS monitor running, and those live fixes would fight
        // the recorded ones. A replay owns position, so park the live monitor for its lifetime.
        if (replayTransport != null && gpsMonitor.active) {
            gpsSuppressedByReplay = true
            stopLocationUpdates()
        }
        selectedBoardName = start.boardConfig.deviceName
        sessionSequence += 1
        val session = BoardSession(id = sessionSequence)
        boardSession = session
        boardError = null
        telemetry = null
        latestBatterySoc = null
        latestDutyExcluded = false
        loadBatteryConfig(start.boardConfig)
        socWindow.reset()
        bmsSeriesRing.clear()
        cellSpreadDetector.reset()
        batteryConfigMismatchDetector.reset()
        warningFailuresReported.clear()
        boardConfigReadScheduled = false
        boardConfigValues = null
        restoreBoardConfigValues(start.boardConfig)
        telemetryPipeline.beginSession(session, start.boardConfig)
        // Tag telemetry frames with the CAN id resolved from the stored transport.
        telemetryPipeline.updateCanId(currentCanId)
        packetReassembler.reset()
        diagnosticsRecorder.resetTelemetryParseFailedCounters()
        connectionCoordinator.reset()
        reconnectScheduler.cancelAndReset()
        recordingCoordinator.beginBoardSession(start.boardConfig)
        beginGpsSessionDiagnostics()
        // Reset per-session Board Warning breadcrumb bookkeeping (one Diagnostic Event per kind per
        // Board Session). Detectors that fire warnings this session land in later slices.
        start.boardConfig.appBoardId?.let {
            val registry = BoardWarningRegistry.get(service.applicationContext)
            registry.beginSession(it)
            registry.onManualClear = ::onWarningManuallyCleared
        }
        lastEmittedLinkIntegrity = session.startLinkIntegrityCheck(start.boardConfig.linkIdentity())
        startLocationUpdates()
        setStatus(BoardPhase.Connecting)
        emitState()
        updateLinkIntegrity(session.markOutdatedIfIncomplete(start.boardConfig.linkIdentity()))
        reassertForeground()

        startBleSession(start)
    }

    /**
     * Foreground-service type for the *current* live state. Android 14+ checks the runtime
     * prerequisites for every asserted type, so idle service creation must not default to
     * CONNECTED_DEVICE before Bluetooth permissions exist. LOCATION still rides alongside
     * CONNECTED_DEVICE whenever GPS is active so background ride recording keeps location access.
     */
    private fun foregroundServiceType(): Int {
        return foregroundServiceType(
            boardActive = boardConfig != null,
            gpsActive = gpsMonitor.active,
        )
    }

    private fun reassertForeground() {
        val type = foregroundServiceType()
        if (type == 0) {
            service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
            stopIfIdle()
            return
        }
        startForeground(type)
    }

    private fun startForeground(type: Int) {
        val notification = presenter.build(reportedBoardPhase())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            service.startForeground(NOTIFICATION_ID, notification, type)
        } else {
            service.startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startBleSession(start: PendingStart) {
        val deviceId = start.boardConfig.deviceId
        if (deviceId.isNullOrBlank()) {
            failStart(start, "INVALID_DEVICE", "Board session requires deviceId")
            return
        }
        // Refuse before GATT rather than connecting into a link we can never poll: without a
        // detected transport the session would reach WaitingForTelemetry and only ever time out.
        if (start.boardConfig.transport == null) {
            captureDiagnostic(
                "ble_connect_failed",
                diagnosticProperties(start.boardConfig, "connect") + mapOf(
                    "message" to "Board Link has no detected transport",
                    "error_code" to "NEEDS_LINK",
                ),
            )
            failStartTerminal(start, "NEEDS_LINK", "Board Link has no detected transport — re-link this board")
            return
        }
        val attempt = connectionCoordinator.markConnectStarting(start)
        reconnectScheduler.stopScan()
        transport.connect(deviceId)
        armConnectPhaseTimeout(start, "gatt_connect", GATT_CONNECT_TIMEOUT_MS)
        Log.d(
            VESC_SESSION_TAG,
            "connect start device=$deviceId attempt=$attempt autoReconnect=${start.boardConfig.autoReconnect}",
        )
        recordLocalDiagnostic(
            "ble_connect_started",
            start.boardConfig,
            "connect",
            mapOf("message" to "BLE connect started"),
        )
    }

    private val gattListener = object : VescGattListener {
        override fun onGattConnected() {
            Log.d(VESC_SESSION_TAG, "connect phase: gatt connected")
            recordLocalDiagnostic(
                "gatt_connected",
                connectionCoordinator.pendingConnect?.boardConfig ?: boardConfig,
                "connect",
                mapOf("message" to "GATT connected"),
            )
            setStatus(BoardPhase.Discovering)
            connectionCoordinator.pendingConnect?.let {
                armConnectPhaseTimeout(it, "gatt_ready", GATT_READY_TIMEOUT_MS)
            }
        }

        override fun onGattSubscribing() {
            Log.d(VESC_SESSION_TAG, "connect phase: subscribing")
            recordLocalDiagnostic(
                "gatt_subscribing",
                connectionCoordinator.pendingConnect?.boardConfig ?: boardConfig,
                "connect",
                mapOf("message" to "GATT subscribing"),
            )
            setStatus(BoardPhase.Subscribing)
        }

        override fun onGattDisconnected(status: Int, intentional: Boolean) {
            val wasConnecting = connectionCoordinator.pendingConnect
            Log.w(
                VESC_SESSION_TAG,
                "gatt disconnected status=$status intentional=$intentional wasConnecting=${wasConnecting != null} boardStatus=$boardStatus",
            )
            connectionCoordinator.cancelConnectTimeout()
            stopPolling()
            if (!intentional) configController.onSessionTerminated("Board disconnected during Refloat config op")
            if (intentional) {
                return
            } else if (replayTransport != null) {
                // A replay link cannot come back: the recording ran out. Reaching the end of a
                // recording is not a failure — tear the session down cleanly to idle (same as a
                // user Stop) so no "Board disconnected" error shows and the REPLAY badge/name
                // clear, instead of stranding the UI in the error phase with a stale session
                // (iOS parity: BoardSessionController.onGattDisconnected).
                stopCurrentBoardSession(emitDisconnected = false)
            } else if (wasConnecting != null) {
                if (
                    connectionCoordinator.retryStatus133Once(
                        status = status,
                        wasConnecting = wasConnecting,
                        session = boardSession,
                        retryDelayMs = 250L,
                        restart = ::startBleSession,
                    )
                ) {
                    Log.w(VESC_SESSION_TAG, "status=133 during connect, retrying once")
                } else if (wasConnecting.boardConfig.autoReconnect) {
                    captureDiagnostic(
                        "ble_connect_failed",
                        diagnosticProperties(wasConnecting.boardConfig, "connect") + mapOf(
                            "message" to "Device disconnected during connect",
                            "error_code" to status,
                            "gatt_status" to status,
                        ),
                    )
                    scheduleAutoReconnect(wasConnecting.boardConfig, status, "connect failed")
                } else {
                    failStart(wasConnecting, "DISCONNECTED", "Device disconnected during connect (status=$status)")
                }
            } else if (boardConfig?.autoReconnect == true) {
                captureDiagnostic(
                    "ble_disconnected_unexpectedly",
                    diagnosticProperties(boardConfig, "connect") + mapOf(
                        "message" to "Board disconnected unexpectedly",
                        "error_code" to status,
                        "gatt_status" to status,
                    ),
                )
                scheduleAutoReconnect(boardConfig!!, status, "board disconnected")
            } else {
                captureDiagnostic(
                    "ble_disconnected_unexpectedly",
                    diagnosticProperties(boardConfig, "connect") + mapOf(
                        "message" to "Board disconnected unexpectedly",
                        "error_code" to status,
                        "gatt_status" to status,
                    ),
                )
                setError("Board disconnected")
                recordingCoordinator.finishDebugRecording("error")
            }
        }

        override fun onGattReady() {
            Log.d(VESC_SESSION_TAG, "connect phase: gatt ready")
            recordLocalDiagnostic(
                "gatt_ready",
                connectionCoordinator.pendingConnect?.boardConfig ?: boardConfig,
                "connect",
                mapOf("message" to "GATT ready"),
            )
            resolveBleConnect()
        }

        override fun onGattFailure(code: String, message: String) {
            Log.w(VESC_SESSION_TAG, "gatt failure code=$code message=$message boardStatus=$boardStatus")
            failPendingConnect(code, message)
        }

        override fun onGattFrameChunk(chunk: ByteArray) {
            handleFrameChunk(chunk)
        }
    }

    /** GATT callbacks can arrive on Binder threads; only this scheduler mutates Board Session state. */
    private fun dispatchGattEvent(event: () -> Unit) {
        val session = boardSession ?: return
        scheduler.post {
            if (isCurrentBoardSession(session)) event()
        }
    }

    private fun resolveBleConnect() {
        val start = connectionCoordinator.resolvePending() ?: return
        Log.d(VESC_SESSION_TAG, "connect resolved attempt=${connectionCoordinator.connectAttempt} transport=${currentBoardTransport()}")
        boardError = null
        recordLocalDiagnostic(
            "waiting_for_telemetry_started",
            start.boardConfig,
            "connect",
            mapOf("message" to "Waiting for board telemetry"),
        )
        transitionBoardPhase(BoardPhase.WaitingForTelemetry)
        start.onSuccess()
        startPolling()
    }

    private fun handleFrameChunk(chunk: ByteArray) {
        recordingCoordinator.recordChunk("rx", chunk)
        for (payload in packetReassembler.feed(chunk)) {
            handlePayload(payload)
        }
    }

    private fun handlePayload(payload: ByteArray) {
        if (payload.isEmpty()) return
        lastReceivedCommandByte = payload[0].toInt() and 0xff
        when (payload[0].toInt() and 0xff) {
            COMM_FW_VERSION -> handleFwVersionPayload(payload)
            COMM_BMS_GET_VALUES -> handleBmsPayload(payload)
            COMM_GET_CUSTOM_CONFIG_XML -> configController.onPayload(ConfigRWEvent.XmlPayloadReceived(payload))
            COMM_GET_CUSTOM_CONFIG -> configController.onPayload(
                ConfigRWEvent.ConfigBytesPayloadReceived(payload, nowMs()),
            )
            COMM_SET_CUSTOM_CONFIG -> configController.onPayload(ConfigRWEvent.SetConfigResponseReceived(payload))
            COMM_FORWARD_CAN -> {
                if (payload.size >= 3) {
                    when (payload[2].toInt() and 0xff) {
                        COMM_BMS_GET_VALUES -> handleBmsPayload(payload.copyOfRange(2, payload.size))
                        COMM_FW_VERSION -> handleFwVersionPayload(payload.copyOfRange(2, payload.size))
                        COMM_CUSTOM_APP_DATA -> handleCustomAppPayload(payload)
                        COMM_GET_CUSTOM_CONFIG_XML -> configController.onPayload(ConfigRWEvent.XmlPayloadReceived(payload))
                        COMM_GET_CUSTOM_CONFIG -> configController.onPayload(
                            ConfigRWEvent.ConfigBytesPayloadReceived(payload, nowMs()),
                        )
                        COMM_SET_CUSTOM_CONFIG -> configController.onPayload(ConfigRWEvent.SetConfigResponseReceived(payload))
                    }
                }
            }
            COMM_CUSTOM_APP_DATA -> handleCustomAppPayload(payload)
        }
    }

    private fun handleCustomAppPayload(payload: ByteArray) {
        if (payload.size >= 3 &&
            (payload[1].toInt() and 0xff) == REFLOAT_MAGIC &&
            (payload[2].toInt() and 0xff) == REFLOAT_GET_INFO
        ) {
            handleLinkIntegrityRefloat(payload)
            configController.onPayload(ConfigRWEvent.InfoPayloadReceived(payload))
            return
        }
        if (payload.size >= 5 &&
            (payload[0].toInt() and 0xff) == COMM_FORWARD_CAN &&
            (payload[2].toInt() and 0xff) == COMM_CUSTOM_APP_DATA &&
            (payload[3].toInt() and 0xff) == REFLOAT_MAGIC &&
            (payload[4].toInt() and 0xff) == REFLOAT_GET_INFO
        ) {
            handleLinkIntegrityRefloat(payload)
            configController.onPayload(ConfigRWEvent.InfoPayloadReceived(payload))
            return
        }
        if ((payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA) {
            val now = nowMs()
            val parsed = parseRefloatGetAllData(
                payload = payload,
                avgLatency = updateLatency(now),
                packetAt = now,
                location = locationTracker.latestLocation,
                pullRateHz = pollingLoop.measuredRateHz(),
            ) ?: run {
                captureTelemetryParseFailed(payload)
                return
            }
            val sessionToken = boardSession ?: return
            pollingLoop.onResponse()
            val processed = telemetryPipeline.process(parsed, sessionToken) ?: return
            markBoardReady()
            startLinkIntegrityProbe(sessionToken)
            telemetry = parsed
            val batteryPct = BatterySocEstimator.estimateBatteryPercent(
                parsed.batteryVoltage,
                batteryConfigCache,
                parsed.batteryCurrent,
            )
            // Smooth the IR-compensated % into the Battery SoC Estimate; display + alerts share it.
            val batteryEstimate = batteryPct?.let { socWindow.median(it, now) }
            val firedAlerts = evaluateAlerts(parsed, batteryEstimate)
            val eventMap = processed.eventMap
            // Latest cold-path values for the dedicated watch tick (ADR-0019); the tick pushes them
            // on its own cadence, so the wrist sees the same SoC Estimate + duty nulling as the phone.
            latestBatterySoc = batteryEstimate
            persistLastBattery(batteryEstimate, parsed.batteryVoltage, now)
            latestDutyExcluded = (eventMap["metricExclusions"] as? Map<*, *>)?.get(METRIC_MAX_DUTY) == true
            if (firedAlerts.isNotEmpty()) eventMap["firedAlerts"] = firedAlerts
            eventMap["generation"] = currentSessionId
            eventMap["batteryPercent"] = batteryEstimate
            val historySample = if (processed.metricExclusionUpdates.isNotEmpty()) {
                eventMap + mapOf("metricExclusionUpdates" to processed.metricExclusionUpdates)
            } else eventMap
                refreshNotification(telemetry = parsed, batteryPercent = batteryEstimate)
                // Hot path: tiny scalar tick every frame drives the live gauges (SharedValues, no React render).
                emitEvent("onLiveTick", buildLiveTick(parsed, batteryEstimate, currentSessionId, firedAlerts))
                // Cold path: full samples buffered and flushed in batches for history/charts.
                liveSeriesEmitter.enqueueHistorySample(historySample)
                // First sample of the session also drives the first sparkline frame immediately.
                liveSeriesEmitter.primeLiveSeriesIfNeeded()
                updateIdlePause(processed.capture)
                // Skip persistence while paused; live display, watch, and presence keep running off the
                // paths above. When recording is off, recordTelemetry is already a no-op.
                if (!idlePauseDetector.isPaused) {
                    recordingCoordinator.recordTelemetry(processed.capture)
                }
            }
        }

    // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (handleBms)
    private fun handleBmsPayload(payload: ByteArray) {
        val bms = parseBmsValues(payload, nowMs()) ?: return
        val session = boardSession
        val config = boardConfig
        if (session != null && config != null) {
            updateLinkIntegrity(session.observeBms(config.linkIdentity()))
        }
        emitEvent("onBms", bms.toMap())
        evaluateCellSpread(bms)
        evaluateBatteryConfigMismatch(bms)
        // Retention is unconditional (the frame already arrived); only the push below is gated.
        val frame = bmsSeriesRing.append(
            capturedAtMs = bms.capturedAt,
            cellVoltages = bms.cellVoltages,
            balancing = bms.balancing,
            windowMs = telemetryPipeline.recentWindowMs(),
        )
        if (frame != null && bmsSeriesFocused) emitBmsSeries("append", listOf(frame))
    }

    /**
     * Run one Board Warning evaluation site, swallowing any failure so a detector bug never crashes the
     * BMS hot path / foreground service. The synchronous detector call runs inline here; registry writes
     * are handed to [launchWarningWrite]. First crash per (site, session) is captured; the rest stay
     * silent to avoid per-frame diagnostic spam. Detectors stay pure — the guard lives at this boundary.
     */
    private inline fun guardWarningEval(site: String, block: () -> Unit) {
        try {
            block()
        } catch (throwable: Throwable) {
            reportWarningFailure(site, throwable)
        }
    }

    /**
     * Launch a Board Warning registry write crash-isolated by [warningWriteExceptionHandler] and
     * serialized on [CoreForegroundService.warningWriteDispatcher] so concurrent findings commit in
     * submission order (preserving the monotonic-severity contract).
     */
    private fun launchWarningWrite(block: suspend () -> Unit) {
        CoreForegroundService.appDataScope.launch(
            warningWriteExceptionHandler + CoreForegroundService.warningWriteDispatcher,
        ) { block() }
    }

    /**
     * Manual clear from JS: reset the matching telemetry detector's dedupe so a still-true condition
     * re-fires within this Board Session (`kind == null` means all kinds). Detectors are not
     * thread-safe, so hop to the main scheduler like [beginSession].
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onWarningManuallyCleared`
     */
    private fun onWarningManuallyCleared(boardId: String, kind: String?) {
        scheduler.post {
            if (boardConfig?.appBoardId != boardId) return@post
            if (kind == null || kind == BoardWarningKind.CELL_SPREAD.wire) cellSpreadDetector.reset()
            if (kind == null || kind == BoardWarningKind.BATTERY_CONFIG_MISMATCH.wire) {
                batteryConfigMismatchDetector.reset()
            }
        }
    }

    /** Capture the first Board Warning-path failure per (site, session); later ones are dropped. */
    private fun reportWarningFailure(site: String, throwable: Throwable) {
        if (!warningFailuresReported.add(site)) return
        Log.e(VESC_SESSION_TAG, "Board Warning $site failed", throwable)
        captureDiagnostic(
            "board_warning_failure",
            diagnosticProperties(boardConfig, "board_warning") + mapOf(
                "site" to site,
                "message" to (throwable.message ?: throwable.javaClass.simpleName),
                "error_type" to throwable.javaClass.name,
            ),
        )
    }

    /**
     * Feed one smart-BMS frame to the cell-spread detector and report any finding through the Board
     * Warning registry (telemetry-scoped detector; continuous evaluation during the Board Session).
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `evaluateCellSpread`
     */
    private fun evaluateCellSpread(bms: BmsTelemetry) = guardWarningEval("cell_spread") {
        if (!boardWarningsEnabled) return@guardWarningEval
        val boardId = boardConfig?.appBoardId ?: return@guardWarningEval
        val finding = cellSpreadDetector.onFrame(
            cellVoltages = bms.cellVoltages,
            balancing = bms.balancing,
            vCharge = bms.vCharge,
            atMs = bms.capturedAt,
        ) ?: return@guardWarningEval
        val registry = BoardWarningRegistry.get(service.applicationContext)
        launchWarningWrite {
            registry.reportFinding(boardId, BoardWarningKind.CELL_SPREAD, finding.severity, finding.payloadJson)
        }
    }

    /**
     * Feed one smart-BMS frame's cell count to the battery-config-mismatch detector and report any
     * finding through the Board Warning registry. Compares against the same configured series count
     * the SoC estimator and per-cell pushback bounds read; absent config is not evaluated.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `evaluateBatteryConfigMismatch`
     */
    private fun evaluateBatteryConfigMismatch(bms: BmsTelemetry) = guardWarningEval("battery_config_mismatch") {
        if (!boardWarningsEnabled) return@guardWarningEval
        val boardId = boardConfig?.appBoardId ?: return@guardWarningEval
        val seriesCount = (batteryConfigCache?.get("seriesCount") as? Number)?.toInt()
        val payloadJson = batteryConfigMismatchDetector.onFrame(bms.cellVoltages.size, seriesCount)
            ?: return@guardWarningEval
        val registry = BoardWarningRegistry.get(service.applicationContext)
        launchWarningWrite {
            registry.reportFinding(
                boardId,
                BoardWarningKind.BATTERY_CONFIG_MISMATCH,
                BoardWarningSeverity.WARN,
                payloadJson,
            )
        }
    }

    /**
     * Take ownership of the Board Config Values a read or write just produced: they become this
     * session's config truth, get cached for the next connect, and feed warning evaluation.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onBoardConfigValues`
     */
    private fun onBoardConfigValues(values: BoardConfigValues) {
        // The link can go `Mismatched` (or the Board change) while a read is on the wire; those bytes
        // describe a board this session no longer owns, so they must not repopulate what was cleared.
        if (values.boardId != boardConfig?.appBoardId) return
        if (lastEmittedLinkIntegrity != LinkIntegrity.Trusted) return
        boardConfigValues = values
        val repo = AppDataRepository.get(service.applicationContext)
        CoreForegroundService.appDataScope.launch { repo.saveBoardConfigValues(values) }
        evaluateConfigSafety(values)
    }

    /**
     * Restore the cached values for the connecting Board as `provisional`, so consumers have
     * something before this session's fresh read lands. Never a write base (#396).
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `restoredBoardConfigValues`
     */
    private fun restoreBoardConfigValues(config: SessionConfig) {
        val boardId = config.appBoardId ?: return
        val refloatBaseVersion = config.refloatBaseVersion ?: return
        val repo = AppDataRepository.get(service.applicationContext)
        val session = boardSession
        CoreForegroundService.appDataScope.launch {
            val restored = repo.getBoardConfigValues(boardId, refloatBaseVersion) ?: return@launch
            scheduler.post {
                // The load is async, so re-check everything that could have moved since: the session
                // must still be the one that asked, on the same Board and Refloat base version, with a
                // link that has not gone `Mismatched` (which clears the cache). And the session's own
                // read wins — never downgrade fresh values to a cached provisional.
                if (session == null || !isCurrentBoardSession(session)) return@post
                if (boardConfig?.appBoardId != boardId) return@post
                if (boardConfig?.refloatBaseVersion != refloatBaseVersion) return@post
                if (lastEmittedLinkIntegrity == LinkIntegrity.Mismatched) return@post
                if (boardConfigValues != null) return@post
                boardConfigValues = restored
            }
        }
    }

    /**
     * Drop held and persisted Board Config Values for the connected Board (`mismatched` link).
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `clearBoardConfigValues`
     */
    private fun clearBoardConfigValues() {
        boardConfigValues = null
        val boardId = boardConfig?.appBoardId ?: return
        val repo = AppDataRepository.get(service.applicationContext)
        CoreForegroundService.appDataScope.launch { repo.clearBoardConfigValues(boardId) }
    }

    /**
     * Evaluate the config-safety rules against a freshly decoded config (background read after link
     * trust, or the in-hand bytes from a tune write) and report findings / clean evaluations through
     * the Board Warning registry. Per-cell rules use the configured battery series count and are
     * skipped when it is absent; skipped kinds report nothing so stored warnings stay untouched.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `evaluateConfigSafety`
     */
    private fun evaluateConfigSafety(values: BoardConfigValues) = guardWarningEval("config_safety") {
        if (!boardWarningsEnabled) return@guardWarningEval
        val boardId = boardConfig?.appBoardId ?: return@guardWarningEval
        val seriesCount = (batteryConfigCache?.get("seriesCount") as? Number)?.toInt()
        val perCell = ConfigSafetyDetector.usesPerCellVoltage(fwVersionString)
        val report = ConfigSafetyDetector.evaluate(values, seriesCount, perCell)
        val registry = BoardWarningRegistry.get(service.applicationContext)
        launchWarningWrite {
            for (finding in report.findings) {
                registry.reportFinding(boardId, finding.kind, finding.severity, finding.payloadJson)
            }
            for (kind in report.cleanKinds) {
                registry.reportCleanEvaluation(boardId, kind)
            }
        }
    }

    /**
     * Once per Board Session, after the link is trusted, kick off one background Refloat config read so
     * the config-safety detectors can evaluate the decoded config. Read-only; reuses the normal config
     * read path (pauses/resumes polling) and is skipped if a config op is already in flight.
     */
    private fun triggerBoardConfigRead(session: BoardSession) {
        if (!isCurrentBoardSession(session)) return
        configController.consumeRead(PendingConfigRead(onSuccess = {}, onError = { _, _ -> }))
    }

    /**
     * Battery-detail focus/blur intent from JS. Focus flips the gate open and immediately pushes
     * the whole windowed Live BMS Series as one columnar buffer; while focused each new BMS frame
     * follows as a single-row `append`. Blur just closes the gate — retention keeps running.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (setBmsSeriesFocused)
     */
    fun setBmsSeriesFocused(focused: Boolean) {
        bmsSeriesFocused = focused
        if (!focused) return
        emitBmsSeries(
            "snapshot",
            bmsSeriesRing.snapshot(telemetryPipeline.recentWindowMs(), nowMs()),
        )
    }

    /**
     * Detail-chart focus intent from JS: the set of metrics whose high-res `onFocusedSeries` stream
     * should run (empty to stop). Emits an immediate snapshot on change; the live-series timer keeps
     * it fresh thereafter.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (setFocusedSeriesMetrics)
     */
    fun setFocusedSeriesMetrics(metrics: List<String>) {
        liveSeriesEmitter.setFocusedMetrics(metrics.toSet())
    }

    private fun emitBmsSeries(mode: String, frames: List<BmsSeriesFrame>) {
        val cellCount = bmsSeriesRing.cellCount()
        emitEvent(
            "onBmsSeries",
            mapOf(
                "mode" to mode,
                "generation" to currentSessionId,
                "windowMs" to telemetryPipeline.recentWindowMs(),
                "cellCount" to cellCount,
                "count" to frames.size,
                "columns" to NativeArrayBuffer.wrap(encodeBmsSeriesColumns(frames, cellCount)),
            ),
        )
    }

    private fun handleFwVersionPayload(payload: ByteArray) {
        val hex = payload.joinToString(" ") { "%02x".format(it) }
        Log.d(VESC_SESSION_TAG, "FW version raw (${payload.size} bytes): $hex")
        fwVersionString = parseFwVersion(payload) ?: return
        val session = boardSession
        val config = boardConfig
        val firmware = fwVersionString
        if (session != null && config != null && firmware != null) {
            updateLinkIntegrity(session.observeFirmware(config.linkIdentity(), firmware))
        }
        Log.d(VESC_SESSION_TAG, "FW version: $fwVersionString")
    }

    private fun handleLinkIntegrityRefloat(payload: ByteArray) {
        val session = boardSession ?: return
        val config = boardConfig ?: return
        val version = when (val result = RefloatConfigProtocol.parseGetInfoResponse(payload)) {
            is RefloatConfigProtocolResult.Success -> result.value.version
            is RefloatConfigProtocolResult.Failure -> return
        }
        updateLinkIntegrity(session.observeRefloat(config.linkIdentity(), version))
    }

    private fun startLinkIntegrityProbe(session: BoardSession) {
        if (!isCurrentBoardSession(session) || session.linkIntegrity != LinkIntegrity.Checking) return
        val config = boardConfig ?: return
        val transport = currentBoardTransport() ?: return
        if (!session.claimLinkIntegrityProbe()) return
        sendPayloadWithRetry(transport.frame(byteArrayOf(COMM_FW_VERSION.toByte())), session)
        sendPayloadWithRetry(RefloatConfigProtocol.buildGetInfo(transport), session)
        if (config.hasBms == true) {
            scheduler.postDelayedForSession(session, LINK_INTEGRITY_BMS_TIMEOUT_MS, ::isCurrentBoardSession) {
                updateLinkIntegrity(session.markBmsMissing(config.linkIdentity()))
            }
        }
    }

    private var lastEmittedLinkIntegrity = LinkIntegrity.Unknown
    private var boardConfigReadScheduled = false

    /**
     * This Board Session's Board Config Values: `FRESH` once the post-trust read lands, `PROVISIONAL`
     * while it is the cache restored on connect. Native-owned truth; JS mirrors it through
     * `getBoardConfigValues` + `onBoardConfigValues`.
     *
     * Every assignment emits — arrival, refresh after a write, and the clears (session end, board
     * switch, `Mismatched`) — so the bridge event needs no separate call sites to stay honest.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `boardConfigValues`
     */
    private var boardConfigValues: BoardConfigValues? = null
        set(value) {
            field = value
            emitEvent("onBoardConfigValues", mapOf("values" to value?.toBridgeMap()))
        }

    /**
     * The held Board Config Values in bridge shape, or null when none are held.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `boardConfigValuesMap`
     */
    internal fun boardConfigValuesMap(): Map<String, Any?>? = boardConfigValues?.toBridgeMap()

    private fun updateLinkIntegrity(next: LinkIntegrity) {
        if (next == lastEmittedLinkIntegrity) return
        lastEmittedLinkIntegrity = next
        emitState()
        // Link just became trusted — schedule the one background config read for this session.
        if (next == LinkIntegrity.Trusted) scheduleBoardConfigRead()
        // Mismatched firmware makes every cached offset meaningless: drop the held object and the
        // persisted rows for this Board. `outdated` keeps them.
        if (next == LinkIntegrity.Mismatched) clearBoardConfigValues()
    }

    private fun scheduleBoardConfigRead() {
        if (boardConfigReadScheduled) return
        boardConfigReadScheduled = true
        val session = boardSession ?: return
        scheduler.postDelayedForSession(session, CONFIG_SAFETY_READ_DELAY_MS, ::isCurrentBoardSession) {
            triggerBoardConfigRead(session)
        }
    }

    private fun dumpRefloatConfigDebug(xmlBytes: ByteArray, configBytes: ByteArray) {
        try {
            val dir = File(service.filesDir, "refloat-debug").apply { mkdirs() }
            File(dir, "custom-config-xml.bin").writeBytes(xmlBytes)
            File(dir, "custom-config-xml.txt").writeText(xmlBytes.toString(Charsets.UTF_8))
            val normalizedXmlBytes = RefloatConfigSchemaParser.normalizeXmlBytes(xmlBytes)
            File(dir, "custom-config-xml-normalized.bin").writeBytes(normalizedXmlBytes)
            File(dir, "custom-config-xml-normalized.txt").writeText(normalizedXmlBytes.toString(Charsets.UTF_8))
            File(dir, "custom-config.bin").writeBytes(configBytes)
            File(dir, "custom-config.hex").writeText(configBytes.joinToString(" ") { "%02x".format(it) })
            Log.w(
                VESC_SESSION_TAG,
                "Refloat debug dump dir=${dir.absolutePath} xmlBytes=${xmlBytes.size} normalizedXmlBytes=${normalizedXmlBytes.size} configBytes=${configBytes.size} xmlPrefix=${xmlBytes.take(128).joinToString(" ") { "%02x".format(it) }} normalizedXmlPrefix=${normalizedXmlBytes.take(128).joinToString(" ") { "%02x".format(it) }}",
            )
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to dump Refloat config debug files", e)
        }
    }

    private fun startPolling() {
        val session = boardConfig ?: return
        val sessionToken = boardSession ?: return
        // Arm the board-ready timeout only once telemetry polling actually begins.
        // A stale stored transport still reaches this path and times out into reconnect.
        if (boardStatus == BoardPhase.WaitingForTelemetry) {
            armBoardReadyTimeout(session)
        }
        // An undetected transport cannot be polled, but it must never park the session in
        // WaitingForTelemetry unwatched: the board-ready timeout above is already armed, so this
        // self-heals into reconnect instead of waiting forever on telemetry nothing will send.
        val transport = currentBoardTransport() ?: run {
            recordLocalDiagnostic(
                "telemetry_polling_unavailable",
                session,
                "telemetry",
                mapOf("message" to "Telemetry polling unavailable: Board Link has no detected transport"),
            )
            return
        }
        telemetryPipeline.armStaleWatchdog()
        recordLocalDiagnostic(
            "telemetry_polling_started",
            session,
            "telemetry",
            mapOf(
                "message" to "Telemetry polling started",
                "polling_mode" to if (currentCanId != null) "can" else "direct",
                "poll_interval_ms" to session.pollIntervalMs,
            ),
        )
        idlePauseDetector.reset()
        pollingLoop.start(session, sessionToken, transport)
        liveSeriesEmitter.start()
    }

    /**
     * How the live Board Session addresses its Board. Derived from the Board Link the session was
     * started with — never mutated mid-session. Detection belongs to the Board Probe alone (#106);
     * a session that re-derived it at runtime could disagree with the link it was started from.
     * `null` means the Board Link carries no detected transport, so this Board cannot be polled.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startPolling`
     */
    private fun currentBoardTransport(): BoardTransport? = boardConfig?.transport

    /** CAN id of the current transport, or `null` on a direct/undetected link. */
    private val currentCanId: Int? get() = (currentBoardTransport() as? BoardTransport.Can)?.canId

    private fun stopPolling() {
        pollingLoop.stop()
        idlePauseDetector.reset()
        telemetryPipeline.cancelStaleWatchdog()
        liveSeriesEmitter.stop()
    }

    /** Latest cold-path snapshot: board lanes are empty without telemetry; navigation stays live. */
    private fun watchSnapshot(): WatchSnapshot {
        val current = telemetry
        // Nav lanes are all-or-nothing: without Route Progress there is nothing to navigate by, and
        // sending a rider position or a course alone would only place a dot on a route the wrist is
        // not drawing. All five null is what hides the wrist overlay.
        val progress = NavigationController.get(service.applicationContext).currentProgress
        val origin = WatchRouteMirror.origin
        val rider = locationTracker.riderPosition
        // Measured from the origin of the route the watch actually holds, not from the current
        // Navigation's first point: a recompute landing between the push and this tick would
        // otherwise place the rider against an origin the wrist has never seen.
        val offset = if (progress != null && origin != null && rider != null) {
            offsetMeters(origin, GeoPoint(rider.latitude, rider.longitude))
        } else {
            null
        }
        return WatchSnapshot(
            speed = current?.speed,
            dutyCycle = current?.dutyCycle,
            dutyExcluded = current == null || latestDutyExcluded,
            batterySoc = if (current != null) latestBatterySoc else null,
            motorTemp = current?.tempMotor,
            ctrlTemp = current?.tempMosfet,
            navBearing = if (offset != null) progress?.bearingDeg else null,
            navDistanceM = if (offset != null) progress?.remainingMeters else null,
            riderEastM = offset?.first,
            riderNorthM = offset?.second,
            // Absolute course, the rotation the wrist applies to its north-up world. Null while the
            // fix carries no usable heading, which leaves the wrist drawing the route north-up.
            courseDeg = if (offset != null) rider?.courseDeg else null,
            routeSpanM = WatchRouteMirror.viewportSpanM,
        )
    }

    private fun isTelemetryStale(now: Long = nowMs()): Boolean =
        now - telemetryPipeline.lastTelemetryAt >= TELEMETRY_STALE_MS

    private fun buildLiveTick(
        parsed: RefloatTelemetry,
        batteryPercent: Double?,
        generation: Long,
        firedAlerts: List<Map<String, Any?>>,
    ): Map<String, Any?> {
        val tick = parsed.toMap().toMutableMap()
        tick.remove("location")
        tick["batteryPercent"] = batteryPercent
        tick["generation"] = generation
        tick["remoteTilt"] = remoteTiltState()
        if (firedAlerts.isNotEmpty()) tick["firedAlerts"] = firedAlerts
        return tick
    }

    private fun boardReadyTimeoutMs(): Long =
        ReconnectPolicy.boardReadyTimeoutMs(reconnectScheduler.currentAttempt)

    private fun armBoardReadyTimeout(session: SessionConfig) {
        if (!session.autoReconnect) return
        cancelBoardReadyTimeout()
        val sessionToken = boardSession ?: return
        val timeoutMs = boardReadyTimeoutMs()
        boardReadyTimeoutHandle = scheduler.postDelayedForSession(sessionToken, timeoutMs, ::isCurrentBoardSession) {
            boardReadyTimeoutHandle = null
            if (
                (boardStatus == BoardPhase.Connecting || boardStatus == BoardPhase.WaitingForTelemetry) &&
                boardConfig?.autoReconnect == true &&
                telemetry == null
            ) {
                recordLocalDiagnostic(
                    "board_ready_timeout",
                    session,
                    "connect",
                    mapOf(
                        "message" to "Board telemetry unavailable before ready timeout",
                        "timeout_ms" to timeoutMs,
                    ),
                )
                scheduleAutoReconnect(session, null, "board telemetry unavailable")
            }
        }
    }

    private fun cancelBoardReadyTimeout() {
        boardReadyTimeoutHandle?.cancel()
        boardReadyTimeoutHandle = null
    }

    private fun markBoardReady() {
        // A telemetry frame can land in flight after the rider tore the session down
        // (stop, or a stale GATT delivering one last packet). Promoting to Connected here
        // would resurrect a dead session with a null board config — the notification then
        // shows 0 km/h / 0% and disconnect can never settle. Only promote from a live phase.
        if (isStoppingService ||
            boardStatus == BoardPhase.Disconnecting ||
            boardStatus == BoardPhase.Idle ||
            boardConfig == null
        ) {
            return
        }
        cancelBoardReadyTimeout()
        if (shouldStartPollingOnReady(currentBoardTransport(), pollingLoop.takeIf { it.isActive })) {
            startPolling()
        }
        if (boardStatus == BoardPhase.Connected) return
        reconnectScheduler.resetAttempts()
        boardError = null
        recordLocalDiagnostic(
            "board_ready",
            boardConfig,
            "connect",
            mapOf("message" to "Board telemetry received"),
        )
        boardConfig?.let { recordingCoordinator.markBoardReady(it) }
        if (connectionSoundsEnabled) alertFeedback.playConnect()
        maybeLaunchWatchMirror()
        transitionBoardPhase(BoardPhase.Connected)
    }

    /**
     * Fresh connects only: at most once per BoardSession, so mid-ride auto-reconnects and
     * Stale -> Connected recoveries (same session id) never re-wake the watch.
     */
    private fun maybeLaunchWatchMirror() {
        if (!wearAutoLaunchOnConnect || !watchMirrorPresence.present) return
        val sessionId = currentSessionId
        if (sessionId == watchLaunchFiredSessionId) return
        watchLaunchFiredSessionId = sessionId
        watchMirrorLauncher.launch()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onTelemetryStaleFired` */
    private fun onTelemetryStaleFired() {
        val now = nowMs()
        if (
            boardStatus != BoardPhase.Connected ||
            now - telemetryPipeline.lastTelemetryAt < TELEMETRY_STALE_MS
        ) return

        transitionBoardPhase(BoardPhase.Stale)
        boardConfig?.takeIf { it.autoReconnect }?.let {
            scheduleAutoReconnect(it, null, "telemetry stale")
        }
    }

    private fun sendPayload(payload: ByteArray): Boolean {
        lastSentCommand = payload.getOrNull(0)?.toInt()?.and(0xff)
        return transport.sendPayload(payload)
    }

    private fun firmwareCommandsTrusted(): Boolean =
        boardStatus == BoardPhase.Connected && boardSession?.linkIntegrity == LinkIntegrity.Trusted

    fun legalModeEnableError(boardId: String): Pair<String, String>? {
        return legalModeEnableError(
            boardStatus,
            boardConfig?.appBoardId,
            boardSession?.linkIntegrity ?: LinkIntegrity.Unknown,
            boardId,
        )
    }

    fun setRemoteTilt(value: Int): Boolean =
        firmwareCommandsTrusted() && remoteTiltController.hold(value)

    fun lockRemoteTilt(value: Int): Boolean =
        firmwareCommandsTrusted() && remoteTiltController.lock(value)

    fun releaseRemoteTilt(value: Int, durationMs: Long): Boolean =
        firmwareCommandsTrusted() && remoteTiltController.release(value, durationMs)

    fun stopRemoteTilt(): Boolean =
        firmwareCommandsTrusted() && remoteTiltController.stop()

    fun startBoardMove(input: Int): Boolean = boardMoveController.hold(input)

    /**
     * A wrist Board Move tick (ADR-0033). Direction only — the phone applies the rider's strength
     * setting — and a missing tick stops the board, see [WatchMoveRelay].
     */
    fun watchMove(direction: Int) = watchMoveRelay.accept(direction)

    /**
     * Latest wrist wake level and when it landed. The Mirror re-sends on a heartbeat, so a level
     * older than [WATCH_MIRROR_AWAKE_TIMEOUT_MS] means the wrist app is gone (killed, out of range,
     * or its `onStop` message was lost) and is read as ASLEEP.
     */
    @Volatile
    private var watchWakeLevel: WatchMirrorWakeLevel = WatchMirrorWakeLevel.ASLEEP

    @Volatile
    private var watchWakeLevelAtMs: Long = 0L

    /** The rider's `wearPushRateHz` as an interval, held so ambient can hand the cadence back to it. */
    @Volatile
    private var configuredWatchIntervalMs: Long = WATCH_FRAME_INTERVAL_MS

    /**
     * A wrist build older than the wake protocol never reports a level, so gating it on one would
     * blank its Mirror for good (phone and watch update on separate Play tracks). Such a wrist is
     * pushed to unconditionally, exactly as before — the gate only applies where it can be answered.
     */
    private fun canPushWatchFrame(): Boolean {
        if (!watchMirrorPresence.present) return false
        if (!watchMirrorPresence.reportsWakeLevel) return true
        return watchMirrorWakeLevel() != WatchMirrorWakeLevel.ASLEEP
    }

    private fun watchMirrorWakeLevel(): WatchMirrorWakeLevel =
        if (SystemClock.elapsedRealtime() - watchWakeLevelAtMs > WATCH_MIRROR_AWAKE_TIMEOUT_MS) {
            WatchMirrorWakeLevel.ASLEEP
        } else {
            watchWakeLevel
        }

    /** Wrist wake-level tick (see [WatchMirrorWakeLevel]): gates the push and picks its cadence. */
    internal fun watchMirrorWakeLevel(level: WatchMirrorWakeLevel) {
        val changed = level != watchWakeLevel
        watchWakeLevel = level
        watchWakeLevelAtMs = SystemClock.elapsedRealtime()
        if (!changed) return
        recordWatchDiagnostic("watch_mirror_wake_level", mapOf("level" to level.name))
        applyWatchInterval()
    }

    /**
     * Single owner of the push cadence. Two inputs set it — the rider's `wearPushRateHz` and
     * the wrist's wake level — so both must resolve here: applying either one directly lets a
     * settings reload silently drop the ambient rate back to the live one, where the level-change
     * early-return then leaves it for the rest of the ambient stretch.
     */
    private fun applyWatchInterval() {
        watchTick.setIntervalMs(
            if (watchMirrorWakeLevel() == WatchMirrorWakeLevel.AMBIENT) {
                WATCH_FRAME_AMBIENT_INTERVAL_MS
            } else {
                configuredWatchIntervalMs
            },
        )
    }

    // Deliberately ungated: a stop must reach the board even if the link lost trust mid-hold,
    // otherwise the rider's release does nothing and the board coasts to the firmware timeout.
    fun stopBoardMove(): Boolean = boardMoveController.stop()

    /**
     * The live position Navigation starts a path from. See `LocationTracker.riderPosition`.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `riderPosition`
     */
    fun riderPosition(): LocationSnapshot? = locationTracker.riderPosition

    fun remoteTiltState(): Map<String, Any?>? =
        remoteTiltWire(
            remoteTiltController.currentValue,
            remoteTiltController.phase,
            remoteTiltController.decayProgress,
        )

    private fun sendPayloadWithRetry(payload: ByteArray, session: BoardSession? = boardSession): Boolean {
        if (session != null && !isCurrentBoardSession(session)) return false
        val sent = sendPayload(payload)
        if (!sent) {
            if (session != null) {
                scheduler.postDelayedForSession(session, 120L, ::isCurrentBoardSession) {
                    sendPayload(payload)
                }
            }
        }
        return sent
    }

    private fun isCurrentBoardSession(session: BoardSession): Boolean =
        session.isActive && session === boardSession && !isStoppingService

    private fun updateLatency(now: Long): Int? {
        return pollingLoop.updateLatency(now)
    }

    private fun stopCurrentBoardSession(emitDisconnected: Boolean) {
        // Final write so the persisted last battery is fresh, not up to 30s stale.
        persistLastBattery(latestBatterySoc, telemetry?.batteryVoltage, nowMs(), force = true)
        remoteTiltController.stop()
        boardMoveController.stop()
        flushTelemetryDiagnostics("stop")
        configController.onSessionTerminated("Board session stopped during Refloat config op")
        val stoppedConfig = boardConfig
        reconnectScheduler.cancelAndReset()
        cancelBoardReadyTimeout()
        stopPolling()
        transport.clear(markIntentional = true)
        replayTransport = null
        // The shifted clock belongs to the replay that installed it; anything running between here
        // and the next session must not still be reading time from the past.
        sessionClock = SystemSessionClock
        alertCoordinator.stopAllGeiger()
        recordGpsSessionSummary(stoppedConfig)
        recordingCoordinator.finishBoardSession(
            status = if (emitDisconnected) "disconnected" else "stopped",
            markerType = if (emitDisconnected) "disconnected" else "app_stop",
            config = stoppedConfig,
        )
        connectionCoordinator.clearPending()
        fwVersionString = null
        telemetry = null
        // Board Config Values are per Board Session; the cache row survives, the held object does not.
        boardConfigValues = null
        boardSession?.invalidate()
        boardSession = null
        // A whole session with BMS data and no sustained spread auto-clears any stored cell-spread
        // warning; a session with no BMS data reports nothing and leaves it untouched. Skipped
        // entirely when the Board Warnings kill switch is off (no evaluation, no registry writes).
        if (boardWarningsEnabled) stoppedConfig?.appBoardId?.let { boardId ->
            val cellSpreadClean = cellSpreadDetector.sessionEndClean()
            val mismatchClean = batteryConfigMismatchDetector.sessionEndClean()
            if (cellSpreadClean || mismatchClean) {
                val registry = BoardWarningRegistry.get(service.applicationContext)
                launchWarningWrite {
                    if (cellSpreadClean) registry.reportCleanEvaluation(boardId, BoardWarningKind.CELL_SPREAD)
                    if (mismatchClean) registry.reportCleanEvaluation(boardId, BoardWarningKind.BATTERY_CONFIG_MISMATCH)
                }
            }
        }
        bmsSeriesRing.clear()
        telemetryPipeline.endSession()
        sessionSequence += 1
        boardConfig = null
        boardError = null
        // The replay released position; hand it back to the live monitor it displaced.
        if (gpsSuppressedByReplay) {
            gpsSuppressedByReplay = false
            startLocationUpdates()
        }
        // Idle repaint (title + Connect action) rides on the phase transition, like every other
        // phase change — see [refreshNotification].
        transitionBoardPhase(BoardPhase.Idle)
    }

    /** Persist the last Battery SoC Estimate per board so it survives full app kill (#152).
     *  Throttled like the GPS persist in [LocationTracker]; `force` skips the gate on session end. */
    private fun persistLastBattery(percent: Double?, voltage: Double?, now: Long, force: Boolean = false) {
        if (percent == null) return
        val boardId = boardConfig?.appBoardId ?: return
        if (!force && now - lastBatteryPersistedAt < 30_000L) return
        lastBatteryPersistedAt = now
        CoreForegroundService.appDataScope.launch {
            AppDataRepository.get(service.applicationContext).updateLastBattery(boardId, percent, voltage, now)
        }
    }

    private fun failPendingConnect(code: String, message: String) {
        connectionCoordinator.pendingConnect?.let { failStart(it, code, message) }
    }

    private fun failStart(start: PendingStart, code: String, message: String) {
        captureDiagnostic(
            "ble_connect_failed",
            diagnosticProperties(start.boardConfig, "connect") + mapOf(
                "message" to message,
                "error_code" to code,
            ),
        )
        if (start.boardConfig.autoReconnect) {
            scheduleAutoReconnect(start.boardConfig, null, message)
            start.onError(code, message)
            return
        }
        failStartTerminal(start, code, message)
    }

    /**
     * Fail a connect that retrying cannot fix, ignoring auto-reconnect. A Board Link defect follows
     * the board across every attempt, so scheduling a reconnect would only spin until the rider
     * intervenes — surface the error instead and let them re-link.
     */
    private fun failStartTerminal(start: PendingStart, code: String, message: String) {
        connectionCoordinator.clearPending()
        cancelBoardReadyTimeout()
        stopPolling()
        transport.clear(markIntentional = true)
        setError(message)
        recordingCoordinator.failSession()
        start.onError(code, message)
    }

    /** Sole raw Board phase writer; all rider-facing phase derives from this raw state. */
    private fun transitionBoardPhase(
        next: BoardPhase,
        recordName: String? = null,
        recordProperties: Map<String, Any?> = emptyMap(),
    ) {
        boardStatus = next
        recordName?.let { recordingCoordinator.recordState(it, recordProperties) }
        rescheduleAutoClose()
        // The notification mirrors the phase, not just telemetry frames: without this a phase change
        // with no telemetry behind it (connect, reconnect scan, disconnect) leaves the last render up.
        refreshNotification()
        emitState()
    }

    /**
     * Auto close (Connection settings): exit the whole app after the configured delay without a
     * board link. The countdown arms when the phase leaves Connected/Stale and only cancels once a
     * link is back, so reconnect-loop phase churn never resets it. Deliberately does NOT arm the
     * companion restart gate: the board reappearing should be able to auto start the app again.
     */
    private fun rescheduleAutoClose() {
        if (!autoCloseEnabled || isBoardLinked() || isStoppingService) {
            autoCloseHandle?.cancel()
            autoCloseHandle = null
            return
        }
        if (autoCloseHandle != null) return
        autoCloseHandle = scheduler.postDelayed(autoCloseDelayMinutes * 60_000L) {
            autoCloseHandle = null
            onAutoCloseFired()
        }
    }

    private fun isBoardLinked(): Boolean =
        boardStatus == BoardPhase.Connected || boardStatus == BoardPhase.Stale

    /** True when our process hosts a visible activity (user is looking at the app). */
    private fun isAppVisible(): Boolean {
        val state = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(state)
        return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    private fun onAutoCloseFired() {
        if (!autoCloseEnabled || isBoardLinked() || isStoppingService) return
        // Auto close targets forgotten background sessions; never yank the app out from under an
        // active user. Visible (or otherwise foreground-important) app pushes the countdown.
        if (isAppVisible()) {
            rescheduleAutoClose()
            return
        }
        // Riding in a Group Ride is deliberate board-less use: push the countdown instead of
        // closing. Lobby observing doesn't count — the app observes whenever it is open.
        if (groupRideObserver.participating) {
            Log.i(VESC_SESSION_TAG, "Auto close postponed: Group Ride participation active")
            rescheduleAutoClose()
            return
        }
        Log.i(VESC_SESSION_TAG, "Auto close: no board link for ${autoCloseDelayMinutes}min, exiting app")
        recordLocalDiagnostic("auto_close_app", boardConfig, "session", mapOf("delayMinutes" to autoCloseDelayMinutes))
        isStoppingService = true
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
        notificationController.cancel()
        stopCurrentBoardSession(emitDisconnected = true)
        stopLocationUpdates()
        closeAppTask()
        service.stopSelf()
    }

    private fun setStatus(next: BoardPhase) =
        transitionBoardPhase(next, recordName = next.recordName())

    private fun scheduleAutoReconnect(session: SessionConfig, gattStatus: Int?, reason: String) {
        if (!session.autoReconnect || isStoppingService) return
        val reconnectSession = boardSession ?: return
        // Lost a live link (telemetry was flowing) — signal the rider we're now without telemetry.
        // Fires once at loss: subsequent reconnect attempts enter here as Reconnecting/Rescanning.
        if (connectionSoundsEnabled && (boardStatus == BoardPhase.Connected || boardStatus == BoardPhase.Stale)) {
            alertFeedback.playDisconnect()
        }
        reconnectScheduler.schedule(
            session = reconnectSession,
            targetDeviceId = session.deviceId,
            reason = reason,
            gattStatus = gattStatus,
        )
    }

    private fun setError(message: String) {
        boardError = message
        recordingCoordinator.recordError(boardConfig, message)
        emitEvent("onError", mapOf("message" to message))
        transitionBoardPhase(BoardPhase.Error)
    }

    private fun reportedBoardPhase(atMs: Long = nowMs()): BoardPhase =
        deriveReportedBoardPhase(
            ReportedBoardPhaseInput(
                rawPhase = boardStatus,
                hasBoardConfig = boardConfig != null,
                hasActiveBoardSession = boardSession?.let(::isCurrentBoardSession) == true,
                isStoppingService = isStoppingService,
                lastTelemetryAt = telemetryPipeline.lastTelemetryAt,
                nowMs = atMs,
            ),
        )

    /**
     * Sole repainter of the foreground notification (the [startForeground] build is the same
     * presenter, one-shot for the Android FGS deadline). Every phase change goes through
     * [transitionBoardPhase] and lands here, so no caller can leave a stale render up; telemetry
     * frames and title/action changes call it directly. Keep it private — a new repaint entry point
     * is how the notification drifts out of sync with the phase.
     */
    private fun refreshNotification(
        telemetry: RefloatTelemetry? = this.telemetry,
        batteryPercent: Double? = telemetry?.let {
            BatterySocEstimator.estimateBatteryPercent(it.batteryVoltage, batteryConfigCache, it.batteryCurrent)
        },
        errorMessage: String? = boardError,
        force: Boolean = false,
    ) {
        if (isStoppingService || notificationRepaintSuppressed) return
        val phase = reportedBoardPhase()
        if (!notificationGate.shouldPost(phase, nowMs(), force)) return
        presenter.show(
            phase = phase,
            telemetry = telemetry,
            batteryPercent = batteryPercent,
            errorMessage = errorMessage,
        )
    }

    /** Swallows the repaints of an intermediate teardown whose end state is never rider-visible. */
    private inline fun withNotificationRepaintSuppressed(block: () -> Unit) {
        notificationRepaintSuppressed = true
        try {
            block()
        } finally {
            notificationRepaintSuppressed = false
        }
    }

    private fun emitState() {
        emitEvent("onLiveState", liveStateMap())
    }

    private fun emitEvent(name: String, body: Map<String, Any?>) {
        CoreForegroundService.emitEvent?.invoke(name, body)
    }

    /**
     * The one place the phone's GPS is armed. A replay owns position for its whole session, so the
     * guard lives here rather than at the call sites: the map, the settings toggle and the session
     * start all ask for location updates independently, and a single live fix slipping through is
     * enough to make the marker jump off the recorded track.
     */
    private fun startLocationUpdates() {
        if (boardConfig?.replayRecordingName != null) return
        gpsError = gpsMonitor.start()
        if (gpsError != null) emitState()
    }

    private fun stopLocationUpdates() {
        gpsMonitor.stop()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `recordPhoneHeading` */
    fun recordPhoneHeading(headingDeg: Double) {
        recordingCoordinator.currentRecorder()?.recordPhoneHeading(headingDeg)
    }

    fun setTelemetryRecordingEnabled(enabled: Boolean) {
        val session = boardConfig
        if (enabled) {
            if (
                session == null ||
                boardStatus == BoardPhase.Idle ||
                boardStatus == BoardPhase.Connecting ||
                boardStatus == BoardPhase.Discovering ||
                boardStatus == BoardPhase.Subscribing ||
                boardStatus == BoardPhase.Disconnecting ||
                boardStatus == BoardPhase.Error
            ) {
                RecordingCoordinator.requestTelemetryRecording(false)
                emitEvent("onError", mapOf("message" to "Recording requires a connected board"))
                emitState()
                return
            }
            recordingCoordinator.enableTelemetryRecording(session)
            emitState()
            return
        }

        resetIdlePause()
        recordingCoordinator.disableTelemetryRecording(session)
        emitState()
    }

    /**
     * Feed a recorded fix into the same path a live one takes, so everything downstream — map,
     * trail, ride stats, Group Ride presence — sees the ride exactly as it happened.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onReplayLocation`
     */
    private fun onReplayLocation(fix: ReplayLocation) {
        // GPS_PROVIDER, not a "replay" marker: the recorded fixes *were* GPS fixes, and
        // `isPreciseGpsFix` keys off the provider — anything else downgrades the whole replayed
        // track to approximate, which drops it from the trail and leaves the map on the phone's
        // own position.
        val location = Location(LocationManager.GPS_PROVIDER).apply {
            latitude = fix.latitude
            longitude = fix.longitude
            time = nowMs()
            // Shifted alongside `time` rather than read raw: a replay's session clock can sit
            // minutes behind wall time, and a `Location` carrying one field from each timeline is a
            // trap for whoever first computes a fix age from the monotonic one.
            elapsedRealtimeNanos =
                SystemClock.elapsedRealtimeNanos() -
                    (System.currentTimeMillis() - nowMs()) * 1_000_000
            fix.speedMps?.let { speed = it }
            fix.bearingDeg?.let { bearing = it }
            fix.accuracyM?.let { accuracy = it }
            fix.altitudeM?.let { altitude = it }
        }
        onLocationUpdated(location)
    }

    /**
     * Hand a recorded compass reading back to JS, which owns the magnetometer and therefore has to
     * be the one to feed it into the map. Emitted rather than applied natively for the same reason
     * it was recorded from JS: the sensor lives there.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onReplayHeading`
     */
    private fun onReplayHeading(heading: ReplayHeading) {
        emitEvent("onReplayPhoneHeading", mapOf("headingDeg" to heading.headingDeg))
    }

    private fun onLocationUpdated(location: Location) {
        recordGpsFix(location)
        locationTracker.onLocationUpdated(location)
        latestRiderPresence()?.let(groupRideObserver::pushPresence)
        // Offered on every Fix; the coordinator owns the freshness and distance gates.
        weatherCoordinator.onPosition(location.latitude, location.longitude)
    }

    /**
     * One low-volume Local Diagnostic Event per Board Session. No coordinates leave the GPS path.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `recordGpsSessionSummary`
     */
    private fun beginGpsSessionDiagnostics() {
        gpsSessionStartedAt = nowMs()
        gpsFixCount = 0
        gpsPreciseFixCount = 0
        gpsFirstFixAt = null
        gpsFirstPreciseFixAt = null
        gpsLastFixAt = null
    }

    private fun recordGpsFix(location: Location) {
        if (gpsSessionStartedAt == null) return
        val at = nowMs()
        gpsFixCount += 1
        if (gpsFirstFixAt == null) gpsFirstFixAt = at
        gpsLastFixAt = at
        val accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        if (isPreciseGpsFix(location.provider, accuracyM)) {
            gpsPreciseFixCount += 1
            if (gpsFirstPreciseFixAt == null) gpsFirstPreciseFixAt = at
        }
    }

    private fun recordGpsSessionSummary(config: SessionConfig?) {
        val startedAt = gpsSessionStartedAt ?: return
        val endedAt = nowMs()
        val locationManager = service.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        val fineGranted = ContextCompat.checkSelfPermission(service, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val backgroundGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(service, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        recordLocalDiagnostic(
            "gps_session_summary",
            config,
            "gps",
            mapOf(
                "message" to "GPS Board Session summary",
                "recording_enabled" to recordingCoordinator.telemetryRecordingEnabled,
                "updates_started" to gpsMonitor.active,
                "fix_count" to gpsFixCount,
                "precise_fix_count" to gpsPreciseFixCount,
                "first_fix_delay_ms" to gpsFirstFixAt?.minus(startedAt),
                "first_precise_fix_delay_ms" to gpsFirstPreciseFixAt?.minus(startedAt),
                "last_fix_age_ms" to gpsLastFixAt?.let { endedAt - it },
                "duration_ms" to endedAt - startedAt,
                "foreground_permission" to fineGranted,
                "background_permission" to backgroundGranted,
                "gps_provider_enabled" to (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) ?: false),
                "network_provider_enabled" to (locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ?: false),
                "last_error" to gpsError,
            ),
        )
        gpsSessionStartedAt = null
    }

    /**
     * A new forecast: mirror it to JS and to the wrist. Runs on the main thread.
     *
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendWeather`
     * @platform-diff The wrist push is Android-only — Wear OS has no iOS peer (ADR-0019).
     */
    private fun onWeatherChanged(weather: Weather?) {
        if (weather == null) return
        emitEvent("onWeather", mapOf("weather" to weather.toMap()))
        watchWeatherPusher.push(weather.toWatchWeather())
    }

    private fun latestRiderPresence(): RiderPresence? {
        val location = locationTracker.latestPreciseLocation ?: locationTracker.latestLocation ?: return null
        // Privacy Zone egress gate (issue #144): freeze the group dot while inside a zone. Local GPS
        // keeps ticking; only the broadcast is suppressed, resuming automatically on exit.
        if (isInsidePrivacyZone(location)) return null
        val currentTelemetry = telemetry
        val telemetryFresh = currentTelemetry != null && !isTelemetryStale()
        return RiderPresence(
            lat = location.latitude,
            lng = location.longitude,
            heading = location.bearingDeg,
            speed = if (telemetryFresh) currentTelemetry?.speed?.let { kotlin.math.abs(it) / 3.6 } else null,
            soc = if (telemetryFresh) latestBatterySoc?.let { (it / 100.0).coerceIn(0.0, 1.0) } else null,
            motorTemp = if (telemetryFresh) currentTelemetry?.tempMotor else null,
            ctrlTemp = if (telemetryFresh) currentTelemetry?.tempMosfet else null,
            phoneBattery = readPhoneBattery(),
            boardName = if (boardConfig != null) (boardConfig?.deviceName ?: selectedBoardName) else null,
            target = groupRideTarget,
        )
    }

    /** Device battery as a 0–1 fraction, or null when the platform can't report it. */
    private fun readPhoneBattery(): Double? {
        val manager = service.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return if (level in 0..100) level / 100.0 else null
    }

    private fun isInsidePrivacyZone(location: LocationSnapshot): Boolean {
        val zones = groupRidePrivacyZones
        if (zones.isEmpty()) return false
        val latitudeE7 = (location.latitude * 10_000_000.0).roundToInt()
        val longitudeE7 = (location.longitude * 10_000_000.0).roundToInt()
        return isInsideAnyPrivacyZone(latitudeE7, longitudeE7, zones)
    }

    /** Refresh the Group Ride presence zone gate from native storage (observe start + zone CRUD). */
    suspend fun loadPrivacyZones(context: Context) {
        groupRidePrivacyZones = try {
            AppDataRepository.get(context).getEnabledPrivacyZoneEntities()
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load privacy zones for presence gate: ${e.message}")
            emptyList()
        }
    }

    /**
     * Refresh the shared Group Ride target from native storage (observe start + direction-point
     * CRUD), then push presence immediately so peers see the change without waiting for the
     * next GPS tick.
     */
    suspend fun loadGroupRideTarget(context: Context) {
        groupRideTarget = try {
            AppDataRepository.get(context).getDirectionPoint()?.let { (latitude, longitude) ->
                TargetPoint(lat = latitude, lng = longitude)
            }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load direction target for presence: ${e.message}")
            null
        }
        mainHandler.post { latestRiderPresence()?.let(groupRideObserver::pushPresence) }
    }

    fun liveStateMap(includeRecent: Boolean = false): Map<String, Any?> {
        val settings = kotlinx.coroutines.runBlocking {
            AppDataRepository.get(service.applicationContext).getTypedSettings()
        }
        applyTelemetrySettings(settings)
        val recentTelemetryValue = if (includeRecent) telemetryPipeline.recentSnapshot() else emptyList()
        val recentLocationsValue = if (includeRecent) locationTracker.recentLocations() else emptyList()

        return buildLiveState(
            VescLiveStateSnapshot(
                boardPhase = reportedBoardPhase(),
                boardConfig = boardConfig,
                boardError = boardError,
                connectionSeq = currentSessionId,
                lastTelemetryAt = telemetry?.lastPacketAt,
                recentTelemetry = recentTelemetryValue,
                gpsActive = gpsMonitor.active,
                latestLocation = locationTracker.latestLocation,
                latestPreciseLocation = locationTracker.latestPreciseLocation,
                recentLocations = recentLocationsValue,
                gpsError = gpsError,
                recordingEnabled = recordingCoordinator.telemetryRecordingEnabled,
                recordingPaused = idlePauseDetector.isPaused,
                remoteTiltValue = remoteTiltController.currentValue,
                remoteTiltPhase = remoteTiltController.phase,
                remoteTiltDecay = remoteTiltController.decayProgress,
                linkIntegrity = boardSession?.linkIntegrity ?: LinkIntegrity.Unknown,
                settings = settings,
            )
        )
    }

    suspend fun loadAlertRules(context: Context, generation: Long) {
        // The alert engine evaluates only the connected Board's rules. No connected Board ⇒ no rules.
        val boardId = boardConfig?.appBoardId
        if (boardId == null) {
            if (CoreForegroundService.isLatestAlertRulesGeneration(generation)) {
                alertCoordinator.replaceRules(emptyList())
            }
            return
        }
        try {
            val repo = AppDataRepository.get(context)
            val board = repo.getBoard(boardId)
            val enabled = ((board?.get("legalMode") as? Map<*, *>)?.get("enabled") as? Boolean) == true
            val jurisdictionCode = repo.getTypedSettings().legalPolicy?.get("jurisdictionCode")
            val speeds = jurisdictionCode?.let(legalPolicyCatalog::speeds)
            val rules = withLegalModeOverlay(
                repo.getEnabledAlertRuleEntities(boardId),
                boardId,
                enabled,
                speeds?.warningSpeedKmh,
                speeds?.limitSpeedKmh,
            )
            if (!CoreForegroundService.isLatestAlertRulesGeneration(generation)) return
            alertCoordinator.replaceRules(rules)
            Log.d(VESC_SESSION_TAG, "Loaded ${rules.size} alert rule(s)")
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load alert rules: ${e.message}")
            if (CoreForegroundService.isLatestAlertRulesGeneration(generation)) {
                alertCoordinator.replaceRules(emptyList())
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `reloadBoardDataForActiveBoard`
     * @platform-diff Android also refreshes the selected-board idle notification title.
     */
    suspend fun reloadBoardDataForActiveBoard() {
        val current = boardConfig
        val repo = AppDataRepository.get(service.applicationContext)
        val selectedBoardId = repo.getTypedSettings().selectedBoardId
        val activeBoardId = current?.appBoardId
        val boardId = activeBoardId ?: selectedBoardId ?: return
        val board = try {
            repo.getBoard(boardId)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load board data: ${e.message}")
            null
        } ?: return
        val name = (board["name"] as? String)?.takeIf { it.isNotEmpty() }
            ?: current?.deviceName
            ?: selectedBoardName
            ?: DEFAULT_BOARD_NAME
        if (selectedBoardId == boardId) selectedBoardName = name
        if (current != null && activeBoardId == boardId) {
            selectedBoardName = name
            boardConfig = current.copy(deviceName = name)
            batteryConfigCache = board["batteryConfig"] as? Map<String, Any?>
        }
        scheduler.post {
            refreshNotification(force = true)
            emitState()
        }
    }

    /**
     * Resolve the pack config the SoC estimator reads for this session.
     *
     * iOS resolves the same fallback when it builds the replay `BoardConnectConfig`.
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startReplay`
     */
    private fun loadBatteryConfig(config: SessionConfig?) {
        val appBoardId = config?.appBoardId
        if (appBoardId == null) {
            batteryConfigCache = null
            return
        }
        batteryConfigCache = try {
            val board = kotlinx.coroutines.runBlocking {
                val repo = AppDataRepository.get(service.applicationContext)
                repo.getBoard(appBoardId)
                    // A replay session runs under a synthetic `replay:` board id, which has no board
                    // row and therefore no pack config — the SoC estimate would stay null for the
                    // whole playback and the battery bar would read nothing. The recording is a ride
                    // of a real board, so borrow the selected board's pack to size it.
                    ?: config.replayRecordingName?.let {
                        repo.getTypedSettings().selectedBoardId?.let { id -> repo.getBoard(id) }
                    }
            }
            board?.get("batteryConfig") as? Map<String, Any?>
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load battery config: ${e.message}")
            null
        }
    }

    private fun evaluateAlerts(t: RefloatTelemetry, batteryPercent: Double?): List<Map<String, Any?>> =
        alertCoordinator.evaluate(t, batteryPercent) { name, properties ->
            val batteryProperties = if (name == "battery_alert_fired") properties + mapOf("battery_config_loaded" to (batteryConfigCache != null)) else properties
            recordLocalDiagnostic(name, boardConfig, "alert", batteryProperties)
        }

    fun applyLiveHistoryLimitMinutes(minutes: Int) {
        telemetryPipeline.setLiveHistoryLimitMinutes(minutes)
        locationTracker.pruneRecentLocations(nowMs())
    }

    private fun refreshLiveHistoryLimit() {
        val settings = kotlinx.coroutines.runBlocking {
            AppDataRepository.get(service.applicationContext).getTypedSettings()
        }
        applyTelemetrySettings(settings)
    }

    suspend fun loadTelemetrySettings(context: Context) {
        applyTelemetrySettings(AppDataRepository.get(context).getTypedSettings())
    }

    private fun applyTelemetrySettings(settings: AppSettings) {
        applyTelemetryPipelineSettings(settings)
        recordingCoordinator.applySettings(settings)
        socWindow.windowMs = settings.socEstimateWindowSeconds * 1000L
        connectionSoundsEnabled = settings.connectionSoundsEnabled
        val warningsWereEnabled = boardWarningsEnabled
        boardWarningsEnabled = settings.boardWarningsEnabled
        // Disabled→enabled with an already-trusted link: link integrity won't transition again, so
        // re-arm here (main-scheduler, like the rest of the one-shot state) — evaluate the config this
        // session already read, or retry the read if it never landed.
        if (!warningsWereEnabled && boardWarningsEnabled) {
            scheduler.post {
                if (lastEmittedLinkIntegrity != LinkIntegrity.Trusted) return@post
                val values = boardConfigValues
                if (values != null && values.freshness == BoardConfigFreshness.FRESH) {
                    evaluateConfigSafety(values)
                } else {
                    boardConfigReadScheduled = false
                    scheduleBoardConfigRead()
                }
            }
        }
        configuredPollIntervalMs = pollIntervalMsForHz(settings.telemetryPollRateHz)
        movingThresholdCentiKmh = settings.toMetricSanitizerConfig().movingSpeedThresholdCentiKmh
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
        configuredWatchIntervalMs = pollIntervalMsForHz(settings.wearPushRateHz)
        applyWatchInterval()
        watchSettingsPusher.push(settings.toWatchSettings())
        wearAutoLaunchOnConnect = settings.wearAutoLaunchOnConnect
        boardMoveStrengthPercent = settings.boardMoveStrengthPercent
        autoCloseEnabled = settings.autoCloseEnabled
        autoCloseDelayMinutes = settings.autoCloseDelayMinutes
        // May run off-main (appDataScope); the countdown state lives on the main-handler scheduler.
        scheduler.post { rescheduleAutoClose() }
    }

    /** Poll spacing honoring an active Idle Pause: never faster than the configured rate. */
    private fun effectivePollIntervalMs(): Long =
        if (idlePauseDetector.isPaused) maxOf(IDLE_PAUSE_POLL_INTERVAL_MS, configuredPollIntervalMs)
        else configuredPollIntervalMs

    private fun updateIdlePause(capture: TelemetryCapture) {
        if (!recordingCoordinator.telemetryRecordingEnabled) {
            // Recording turned off mid-pause: drop the pause and restore the configured poll rate.
            if (idlePauseDetector.isPaused) {
                resetIdlePause()
                emitState()
            }
            return
        }
        val transition = idlePauseDetector.onSample(
            speedCentiKmh = (capture.speed * 100.0).roundToInt(),
            movingThresholdCentiKmh = movingThresholdCentiKmh,
            atMs = capture.capturedAtMs,
        ) ?: return
        if (transition == IdlePauseTransition.Paused) {
            recordingCoordinator.recordIdlePauseMarker(boardConfig)
        }
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
        emitState()
    }

    private fun resetIdlePause() {
        idlePauseDetector.reset()
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
    }

    private fun applyTelemetryPipelineSettings(settings: AppSettings) {
        applyLiveHistoryLimitMinutes(settings.liveHistoryLimit)
        telemetryPipeline.metricSanitizerConfig = settings.toMetricSanitizerConfig()
    }

    fun previewAlertSound(soundType: String) {
        alertFeedback.preview(soundType)
    }

    private fun closeAppTask() {
        notificationController.closeAppTask()
    }

    private fun armConnectPhaseTimeout(start: PendingStart, phase: String, timeoutMs: Long) {
        connectionCoordinator.armConnectPhaseTimeout(
            start = start,
            phase = phase,
            timeoutMs = timeoutMs,
            status = { boardStatus },
            canId = { currentCanId },
            onTimeout = ::onConnectPhaseTimeout,
        )
    }

    private fun onConnectPhaseTimeout(timeout: ConnectPhaseTimeout) {
        Log.w(
            VESC_SESSION_TAG,
            "connect phase timeout phase=${timeout.phase} device=${timeout.start.boardConfig.deviceId} attempt=${timeout.attempt} elapsedMs=${timeout.elapsedMs} status=${timeout.boardStatus} canId=${timeout.canId}",
        )
        recordLocalDiagnostic(
            "connect_phase_timeout",
            timeout.start.boardConfig,
            "connect",
            mapOf(
                "message" to "BLE connect phase timed out",
                "connect_phase" to timeout.phase,
                "elapsed_ms" to timeout.elapsedMs,
                "timeout_ms" to timeout.timeoutMs,
            ),
        )
        failStart(timeout.start, "CONNECT_TIMEOUT", "Timed out connecting to board")
    }

    private fun captureTelemetryParseFailed(payload: ByteArray): Unit =
        diagnosticsRecorder.captureTelemetryParseFailed(payload, boardConfig)

    private fun flushTelemetryDiagnostics(reason: String): Unit =
        diagnosticsRecorder.flushTelemetryDiagnostics(reason, boardConfig)

    private fun captureDiagnostic(eventName: String, properties: Map<String, Any?>): Unit =
        diagnosticsRecorder.captureDiagnostic(eventName, properties)

    private fun recordLocalDiagnostic(
        eventName: String,
        session: SessionConfig?,
        operation: String,
        properties: Map<String, Any?> = emptyMap(),
    ): Unit = diagnosticsRecorder.recordLocalDiagnostic(eventName, session, operation, properties)

    private fun recordWatchDiagnostic(eventName: String, properties: Map<String, Any?>): Unit =
        recordLocalDiagnostic(eventName, boardConfig, "watch", properties)

    private fun diagnosticProperties(session: SessionConfig?, operation: String): Map<String, Any?> =
        diagnosticsRecorder.diagnosticProperties(session, operation)
}

internal fun companionBoardIdForAddress(
    boards: List<Map<String, Any?>>,
    address: String,
): String? = boards.firstNotNullOfOrNull { board ->
    val link = board["link"] as? Map<*, *> ?: return@firstNotNullOfOrNull null
    val bleId = link["bleId"] as? String ?: return@firstNotNullOfOrNull null
    (board["id"] as? String)?.takeIf { bleId.equals(address, ignoreCase = true) }
}

private const val LINK_INTEGRITY_BMS_TIMEOUT_MS = 12_000L

/** Idle delay after link trust before the one background config-safety read fires (lets telemetry settle). */
private const val CONFIG_SAFETY_READ_DELAY_MS = 2_500L

private fun SessionConfig.linkIdentity(): LinkIdentity =
    LinkIdentity(
        linkVersion = linkVersion,
        hasBms = hasBms,
        firmware = vescFirmwareVersion,
        refloatVersion = refloatVersion,
        refloatBaseVersion = refloatBaseVersion,
    )
