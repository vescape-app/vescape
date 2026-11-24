package expo.modules.vescapecore.connection

import expo.modules.vescapecore.accessory.AccessorySessionManager
import expo.modules.vescapecore.accessory.BoardGroundClearanceBinding
import expo.modules.vescapecore.service.foregroundServiceType
import expo.modules.vescapecore.service.ACTION_CONNECT_FROM_NOTIFICATION
import expo.modules.vescapecore.service.ACTION_DISCONNECT_FROM_NOTIFICATION
import expo.modules.vescapecore.service.ACTION_EXIT_FROM_NOTIFICATION
import expo.modules.vescapecore.alerts.AlertCoordinator
import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.alerts.withLegalModeOverlay
import expo.modules.vescapecore.location.LegalPolicyCatalog
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.telemetry.BmsSeriesFrame
import expo.modules.vescapecore.telemetry.BmsSeriesRing
import expo.modules.vescapecore.protocol.BmsTelemetry
import expo.modules.vescapecore.protocol.BoardLightsGeneration
import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.service.BoardProbeAutoStartGate
import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_FW_VERSION
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_GET_MCCONF
import expo.modules.vescapecore.protocol.COMM_PRINT
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.buildFaultsTerminalCommand
import expo.modules.vescapecore.protocol.buildLightsControlCommand
import expo.modules.vescapecore.protocol.lightsCommandChangesBoardConfig
import expo.modules.vescapecore.config.RefloatConfigEncodeException
import expo.modules.vescapecore.service.CompanionRestartGate
import expo.modules.vescapecore.config.ConfigConnectionSnapshot
import expo.modules.vescapecore.config.ConfigRWController
import expo.modules.vescapecore.config.BoardRideState
import expo.modules.vescapecore.config.ConfigRWControllerPort
import expo.modules.vescapecore.config.BoardConfigFlagField
import expo.modules.vescapecore.config.BoardConfigOperationOrigin
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.location.GpsDemand
import expo.modules.vescapecore.location.GpsMonitor
import expo.modules.vescapecore.location.GpsPhase
import expo.modules.vescapecore.location.GpsPowerMode
import expo.modules.vescapecore.location.RIDE_DROPOUT_GRACE_MS
import expo.modules.vescapecore.location.isPreciseGpsFix
import expo.modules.vescapecore.GroupRideObserver
import expo.modules.vescapecore.GroupRideOnlineGate
import expo.modules.vescapecore.PublicRideStore
import expo.modules.vescapecore.PublicRideSwitch
import expo.modules.vescapecore.auth.DeviceCredentialStore
import expo.modules.vescapecore.RiderSignalContext
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.appstatus.watchNetwork
import expo.modules.vescapecore.telemetry.LiveSeriesEmitter
import expo.modules.vescapecore.telemetry.ProcessedTelemetry
import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.protocol.toCapture
import expo.modules.vescapecore.location.LocationTracker
import expo.modules.vescapecore.service.ManualDisconnectAutoStartGate
import expo.modules.vescapecore.notification.NotificationController
import expo.modules.vescapecore.config.McconfDecodeResult
import expo.modules.vescapecore.config.MotorConfigValues
import expo.modules.vescapecore.config.McconfDecoder
import expo.modules.vescapecore.config.PendingConfigRead
import expo.modules.vescapecore.service.PendingStart
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.reconnect.ReconnectBlePort
import expo.modules.vescapecore.reconnect.ReconnectBleScanner
import expo.modules.vescapecore.config.RefloatConfigProtocol
import expo.modules.vescapecore.config.RefloatConfigProtocolResult
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.BoardMoveController
import expo.modules.vescapecore.RemoteInputArbiter
import expo.modules.vescapecore.RemoteInputOwner
import expo.modules.vescapecore.RemoteTiltController
import expo.modules.vescapecore.RiderPresence
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.service.TELEMETRY_STALE_MS
import expo.modules.vescapecore.TargetPoint
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import expo.modules.vescapecore.protocol.SessionTransport
import expo.modules.vescapecore.protocol.VescGattClient
import expo.modules.vescapecore.protocol.VescGattListener
import expo.modules.vescapecore.replay.ReplayEvent
import expo.modules.vescapecore.replay.ReplayLocation
import expo.modules.vescapecore.replay.SimulatedBoard
import expo.modules.vescapecore.VescLiveStateSnapshot
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.watch.GeoPoint
import expo.modules.vescapecore.watch.WatchBoard
import expo.modules.vescapecore.watch.WatchLastBatteryPusher
import expo.modules.vescapecore.watch.WatchRideNoticePusher
import expo.modules.vescapecore.notices.RideNotice
import expo.modules.vescapecore.notices.RideNotices
import expo.modules.vescapecore.watch.androidWatchMirror
import expo.modules.vescapecore.watch.WatchLightsRelay
import expo.modules.vescapecore.watch.WatchLightsSwitch
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameBuilder
import expo.modules.vescapecore.watch.WatchMirrorWakeLevel
import expo.modules.vescapecore.watch.WatchMoveRelay
import expo.modules.vescapecore.watch.WatchRouteMirror
import expo.modules.vescapecore.watch.WatchSnapshot
import expo.modules.vescapecore.watch.WatchTiltControl
import expo.modules.vescapecore.weather.Weather
import expo.modules.vescapecore.weather.WeatherAlertLine
import expo.modules.vescapecore.weather.WeatherAlertMonitor
import expo.modules.vescapecore.weather.WeatherAlertSettings
import expo.modules.vescapecore.weather.WeatherCoordinator
import expo.modules.vescapecore.watch.offsetMeters
import expo.modules.vescapecore.watch.toWatchSettings
import expo.modules.vescapecore.buildLiveState
import expo.modules.vescapecore.telemetry.encodeBmsSeriesColumns
import expo.modules.vescapecore.telemetry.weatherObservationRecorder
import expo.modules.vescapecore.service.foregroundServiceTypeForConnectedDevicePromotion
import expo.modules.vescapecore.protocol.parseBmsValues
import expo.modules.vescapecore.protocol.parseFwVersion
import expo.modules.vescapecore.protocol.parseLightsControlResponse
import expo.modules.vescapecore.protocol.parseRefloatGetAllData
import expo.modules.vescapecore.remoteTiltWire
import expo.modules.vescapecore.warnings.BatteryConfigMismatchDetector
import expo.modules.vescapecore.warnings.BoardWarningKind
import expo.modules.vescapecore.faults.VescFaultCaptureCoordinator
import expo.modules.vescapecore.faults.VescFaultCoordinator
import expo.modules.vescapecore.faults.VescFaultLogReader
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
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.launch
import expo.modules.kotlin.jni.NativeArrayBuffer
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
import expo.modules.vescapecore.runtime.postDelayedForSession
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.telemetry.BatterySocEstimator
import expo.modules.vescapecore.telemetry.IDLE_PAUSE_POLL_INTERVAL_MS
import expo.modules.vescapecore.telemetry.IdlePauseDetector
import expo.modules.vescapecore.telemetry.IdlePauseTransition
import expo.modules.vescapecore.telemetry.METRIC_MAX_DUTY
import expo.modules.vescapecore.telemetry.SocMedianWindow
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.isRefloatEngaged
import expo.modules.vescapecore.telemetry.TelemetryPipeline
import expo.modules.vescapecore.telemetry.TelemetryRepository
import expo.modules.vescapecore.telemetry.toMetricSanitizerConfig
import androidx.annotation.AnyThread

private const val CHANNEL_ID = "vesc_monitoring_v5"
private const val NOTIFICATION_ID = 1001
private const val LIVE_SERIES_INTERVAL_MS = 1_000L
private const val LIVE_SERIES_BUCKETS = 64
private const val NOTIFICATION_TELEMETRY_INTERVAL_MS = 10_000L
private const val FAULT_CODE_UNKNOWN = -1

private const val FAULT_OBSERVATION_INTERVAL_MS = 1_000L
private const val MANUAL_FAULT_LOG_MAX_SPEED_KMH = 1.0

private const val GATT_CONNECT_TIMEOUT_MS = 6_000L

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

internal data class GroupRideTargetReload(val target: TargetPoint?, val loaded: Boolean)

internal suspend fun reloadGroupRideTarget(
    current: TargetPoint?,
    read: suspend () -> TargetPoint?,
    report: (Throwable) -> Unit = {
        RecordingStorageFailure.reportRead("group_ride_target_read", it)
    },
): GroupRideTargetReload = try {
    GroupRideTargetReload(read(), loaded = true)
} catch (error: kotlinx.coroutines.CancellationException) {
    throw error
} catch (error: Throwable) {
    report(error)
    GroupRideTargetReload(current, loaded = false)
}

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
    private val idlePauseDetector = IdlePauseDetector()
    private var configuredPollIntervalMs: Long = 0L
    private val connectionCoordinator = ConnectionCoordinator(
        scheduler = scheduler,
        isCurrentSession = ::isCurrentBoardSession,
    )
    private val gattHandshakeDeadline = GattHandshakeDeadline()
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

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `remoteInput`
     */
    private val remoteInput = RemoteInputArbiter(
        tilt = remoteTiltController,
        move = boardMoveController,
        nowMs = { SystemClock.elapsedRealtime() },
        sensorBound = AccessorySessionManager::groundClearanceBound,
    )
    private val groundClearanceBinding = BoardGroundClearanceBinding(
        remoteInput,
        AccessorySessionManager::groundClearanceBound,
        AccessorySessionManager::groundClearanceTilt,
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
            // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `liveActivityNoticeContent`
            rideNotice = {
                notificationNotice?.content?.takeUnless { c -> c.expiresAt?.let { it <= System.currentTimeMillis() } == true }
            },
        )
    }
    private val notificationGate = NotificationUpdateGate(NOTIFICATION_TELEMETRY_INTERVAL_MS)
    private val alertAudioThread by lazy { android.os.HandlerThread("vescape-alert-audio", android.os.Process.THREAD_PRIORITY_URGENT_AUDIO).apply { start() } }
    private val alertFeedback by lazy {
        AlertFeedback(service, android.os.Handler(alertAudioThread.looper)) { name, props ->
            mainHandler.post { recordLocalDiagnostic(name, boardConfig, "alert_audio", props) }
        }
    }
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
        nowMs = System::currentTimeMillis,
        staleTimeoutMs = TELEMETRY_STALE_MS,
    )
    private val recordingCoordinator by lazy {
        RecordingCoordinator(
            context = service.applicationContext,
            applyLiveSettings = ::applyTelemetryPipelineSettings,
            onRecordingFailure = ::onRecordingPersistenceFailure,
        )
    }

    private fun onRecordingPersistenceFailure() {
        scheduler.post {
            recordingCoordinator.handleStorageFailure()
            emitState()
        }
    }
    private val liveSeriesEmitter by lazy {
        LiveSeriesEmitter(
            scheduler = scheduler,
            emitEvent = ::emitEvent,
            telemetryPipeline = telemetryPipeline,
            session = { boardSession },
            isCurrentSession = ::isCurrentBoardSession,
            generation = { currentSessionId },
            liveSeriesIntervalMs = LIVE_SERIES_INTERVAL_MS,
            liveSeriesBuckets = LIVE_SERIES_BUCKETS,
        )
    }
    private val watchMirror by lazy {
        androidWatchMirror(
            service.applicationContext, CoreForegroundService.appDataScope, scheduler,
            ::watchSnapshot, { telemetry != null && isTelemetryStale() }, ::groupRideFrame, ::recordWatchDiagnostic,
            ::refreshGpsDemand,
        )
    }
    private val weatherCoordinator = WeatherCoordinator.get()
    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `weatherAlerts`
     */
    private val weatherAlerts = WeatherAlertMonitor(
        isLive = { boardStatus == BoardPhase.Connected },
        speak = { line -> alertFeedback.speakAdvisory(line.voiceAnnouncement()) },
    )
    private var weatherUnsubscribe: (() -> Unit)? = null
    private var rideNoticeUnsubscribe: (() -> Unit)? = null
    private var notificationNotice: RideNotice? = null
    private var weatherObservationUnsubscribe: (() -> Unit)? = null
    private val watchMoveRelay by lazy {
        WatchMoveRelay(
            scheduler = scheduler,
            strengthPercent = { boardMoveStrengthPercent },
            startMove = ::startBoardMove,
            stopMove = ::stopBoardMove,
            record = ::recordWatchDiagnostic,
        )
    }
    private val watchLightsRelay by lazy {
        WatchLightsRelay(
            scheduler = scheduler,
            currentLights = { boardLights },
            setLights = ::setBoardLights,
            record = ::recordWatchDiagnostic,
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
            { AppDataRepository.get(service.applicationContext).getTuneProfile(it) },
            object : ConfigRWControllerPort {
                override fun connection() =
                    ConfigConnectionSnapshot(
                        boardConfig,
                        boardStatus,
                        currentBoardTransport(),
                        fwVersionString,
                        boardSession?.linkIntegrity ?: LinkIntegrity.Unknown,
                        boardConfigValues,
                        telemetry?.let { BoardRideState(it.state, it.switchState, it.lastPacketAt) },
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
                override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) =
                    this@BoardSessionController.onBoardConfigValues(values, origin)
                override fun demoteWriteBase() {
                    boardConfigValues = boardConfigValues?.demotedToProvisional()
                }
            },
        )
    }
    private val gpsMonitor by lazy {
        GpsMonitor(
            context = service,
            looper = Looper.getMainLooper(),
            onLocation = ::onLocationUpdated,
            record = ::captureDiagnostic,
        )
    }
    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `groupRideObserver` */
    private val groupRideObserver by lazy {
        GroupRideObserver(
            handler = mainHandler,
            emit = ::emitEvent,
            online = AppStatusCoordinator.get(service.applicationContext),
            onCue = alertFeedback::playAppCue,
            ownLocation = { locationTracker.latestLocation?.let { it.latitude to it.longitude } },
            signalContext = ::riderSignalContext,
            deviceCredential = { DeviceCredentialStore(service.applicationContext).read() },
            onPublicRideDemandChanged = {
                syncPublicRideLink()
                mainHandler.post { if (!isStoppingService) refreshGpsDemand() }
            },
            persistPublicRide = { PublicRideStore(service.applicationContext).write(it) },
            lastKnownLocation = {
                val latitude = lastAppliedSettings.lastGpsLatitude
                val longitude = lastAppliedSettings.lastGpsLongitude
                if (latitude != null && longitude != null) latitude to longitude else null
            },
            watchNetwork = { onNewNetwork -> watchNetwork(service.applicationContext, onNewNetwork) },
        )
    }

    private var jsObserving = false
    private var credentialUnsubscribe: (() -> Unit)? = null

    private val groupRidePrivacy = PrivacyZoneReadState()

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
    @Volatile
    private var simulatedBoard: SimulatedBoard? = null
    private val transport: SessionTransport get() = simulatedBoard ?: gattClient

    val replayPlayback: SimulatedBoard? get() = simulatedBoard

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `linkLostAtMs`
     */
    private var linkLostAtMs: Long? = null

    private var dropoutGraceHandle: Cancellable? = null

    private var beginningSession = false

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `appVisible`
     */
    var appVisible: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            refreshGpsDemand()
        }

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
            boardConfigValues = boardConfigValues?.demotedToProvisional()
            boardLights = null
            publishBoardLights()
            boardConfigReadScheduled = false
            motorConfigValues = motorConfigValues?.demotedToLastKnown()
            motorConfigRequested = false
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
        }

        override fun onScannerUnavailable(session: BoardSession) {
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

    private val sessionReconnectPort = object : ReconnectBlePort {
        private val port: ReconnectBlePort get() = simulatedBoard ?: reconnectBlePort

        override fun hasScanner(): Boolean = port.hasScanner()

        override fun startScan(
            targetId: String,
            onFound: (ReconnectScanMatch) -> Unit,
            onFailed: (errorCode: Int) -> Unit,
        ): Boolean = port.startScan(targetId, onFound, onFailed)

        override fun stopScan() = port.stopScan()
    }

    private val reconnectScheduler = ReconnectScheduler(
        scheduler = scheduler,
        port = sessionReconnectPort,
        listener = reconnectListener,
        appForeground = { appVisible },
    )

    private var boardConfig: SessionConfig? = null
    private var notificationRepaintSuppressed = false
    @Volatile
    private var selectedBoardName: String? = null
    @Volatile
    private var batteryConfigCache: Map<String, Any?>? = null
    private val socWindow = SocMedianWindow()
    private val bmsSeriesRing = BmsSeriesRing()
    private val cellSpreadDetector = CellSpreadDetector()
    private val batteryConfigMismatchDetector = BatteryConfigMismatchDetector()
    /**
     * @parity /modules/vescape-core/ios/warnings/BoardWarningFailureReporter.swift `BoardWarningFailureReporter`
     */
    private val warningFailuresReported = java.util.Collections.synchronizedSet(HashSet<String>())
    private val warningWriteExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        reportWarningFailure("registry_write", throwable)
    }
    private val faultWriteExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        RecordingStorageFailure.report("vesc_fault_write", "write_failed", throwable)
    }
    @Volatile
    private var bmsSeriesFocused = false
    private var lastBatteryPersistedAt = 0L
    private var boardStatus: BoardPhase = BoardPhase.Idle
    private var boardError: String? = null
    private var telemetry: RefloatTelemetry? = null
    private var latestBatterySoc: Double? = null
    private var latestDutyExcluded = false
    private var fwVersionString: String? = null
    private var boardReadyTimeoutHandle: Cancellable? = null
    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `gpsError`
     */
    private val gpsError: String?
        get() = gpsMonitor.error
    private var gpsSessionStartedAt: Long? = null
    private var gpsFixCount = 0
    private var gpsPreciseFixCount = 0
    private var gpsFirstFixAt: Long? = null
    private var gpsFirstPreciseFixAt: Long? = null
    private var gpsLastFixAt: Long? = null
    private var isStoppingService = false
    private var connectionSoundsEnabled = true
    @Volatile
    private var lastAppliedSettings = AppSettings()
    @Volatile
    private var boardMoveStrengthPercent = AppSettings().boardMoveStrengthPercent
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

    fun onCreate() {
        BatterySocEstimator.init(service)
        DiagnosticReporter.initialize(service)
        notificationController.createChannel()
        refreshSelectedBoardName()
        WatchLastBatteryPusher.push(service)
        watchMirror.start()
        WatchRideNoticePusher.start(service)
        weatherUnsubscribe = weatherCoordinator.addChangeListener(::onWeatherChanged)
        notificationNotice = RideNotices.current.firstOrNull()
        rideNoticeUnsubscribe = RideNotices.addListener(::onRideNoticesChanged)
        weatherObservationUnsubscribe = weatherCoordinator.addChangeListener(::storeWeatherObservation)
        weatherCoordinator.current?.let(::onWeatherChanged)
        loadPublicRide()
        CoreForegroundService.appDataScope.launch { loadTelemetrySettings(service.applicationContext) }
    }

    private fun refreshSelectedBoardName() {
        CoreForegroundService.appDataScope.launch {
            val repo = AppDataRepository.get(service.applicationContext)
            val id = repo.getTypedSettings().selectedBoardId
            selectedBoardName = id?.let { repo.getBoard(it)?.get("name") as? String }
            if (boardConfig == null && !isStoppingService) {
                scheduler.post { if (boardConfig == null) refreshNotification(force = true) }
            }
        }
    }

    fun connectSelectedBoardFromNotification() {
        connectSelectedBoard(recordingEnabled = false)
    }

    fun promoteConnectedDeviceForeground() {
        isStoppingService = false
        startForeground(
            foregroundServiceTypeForConnectedDevicePromotion(
                boardActive = boardConfig != null,
                gpsActive = gpsMonitor.active,
            ),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `autoConnectSelectedBoard`
     */
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
            AppDataRepository.get(appCtx).setSelectedBoardId(boardId)
            val config = try {
                buildSessionConfig(appCtx, boardId, recordingEnabled = false)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
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

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `beginSession`
     */
    private fun connectSelectedBoard(recordingEnabled: Boolean) {
        if (boardConfig != null) return
        CoreForegroundService.appDataScope.launch {
            val appCtx = service.applicationContext
            val boardId = AppDataRepository.get(appCtx).getTypedSettings().selectedBoardId ?: return@launch
            ManualDisconnectAutoStartGate.clear(appCtx)
            val config = try {
                buildSessionConfig(appCtx, boardId, recordingEnabled = recordingEnabled)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
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

    fun disconnectFromNotification() {
        if (boardConfig == null) return
        setStatus(BoardPhase.Disconnecting)
        ManualDisconnectAutoStartGate.suppress(service.applicationContext, boardConfig?.appBoardId)
        stopCurrentBoardSession(emitDisconnected = true)
    }

    fun onServiceDestroy() {
        weatherUnsubscribe?.invoke()
        weatherUnsubscribe = null
        rideNoticeUnsubscribe?.invoke()
        rideNoticeUnsubscribe = null
        weatherObservationUnsubscribe?.invoke()
        weatherObservationUnsubscribe = null
        watchMirror.stop()
        watchMoveRelay.cancel()
        autoCloseHandle?.cancel()
        autoCloseHandle = null
        if (!isStoppingService) {
            stopCurrentBoardSession(emitDisconnected = false)
        }
        alertFeedback.release()
        alertAudioThread.quitSafely()
        forceStopGps()
        credentialUnsubscribe?.invoke()
        credentialUnsubscribe = null
        groupRideObserver.stop()
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
    }

    val isStopping: Boolean get() = isStoppingService

    fun stopIfIdle() {
        if (boardConfig == null && !gpsMonitor.active && !groupRideObserver.active &&
            !AccessorySessionManager.hasSessions()
        ) {
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
            stopCurrentBoardSession(emitDisconnected = true)
            stop.onSuccess()
            return
        }
        stop.onSuccess()
        if (!gpsMonitor.active && !groupRideObserver.active && !AccessorySessionManager.hasSessions()) {
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

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startGroupRideObserve` */
    fun consumePendingGroupRideObserve() {
        val url = CoreForegroundService.claimPendingGroupRideUrl() ?: return
        isStoppingService = false
        CoreForegroundService.appDataScope.launch {
            loadPrivacyZones(service.applicationContext)
            loadGroupRideTarget(service.applicationContext)
        }
        jsObserving = true
        groupRideObserver.start(url)
        if (CoreForegroundService.lookAroundRequested) watchPublicRiders()
        reassertForeground()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `stopGroupRideObserve` */
    fun stopGroupRideObserve() {
        jsObserving = false
        if (groupRideObserver.publicRideNeedsLink) return
        groupRideObserver.stop()
        stopIfIdle()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `resyncGroupRide` */
    fun resyncGroupRide() {
        groupRideObserver.resync()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `replayGroupRideEvent` */
    fun replayGroupRideEvent(name: String) {
        groupRideObserver.replayEvent(name)
    }

    fun sendGroupRideSignal(kind: String) {
        groupRideObserver.sendSignal(kind)
    }

    fun clearGroupRideSignal() {
        groupRideObserver.clearSignal()
    }

    fun sendGroupRideHazard(kind: String) {
        groupRideObserver.sendHazard(kind)
    }

    fun clearGroupRideHazard() {
        groupRideObserver.clearHazard()
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `loadPublicRide`
     */
    private fun loadPublicRide() {
        val context = service.applicationContext
        CoreForegroundService.appDataScope.launch {
            val stored = PublicRideStore(context).read()
            val accountId = DeviceCredentialStore(context).read()?.accountId
            mainHandler.post {
                groupRideObserver.loadPublicRide(stored, accountId)
                credentialUnsubscribe?.invoke()
                credentialUnsubscribe = DeviceCredentialStore.addChangeListener {
                    CoreForegroundService.appDataScope.launch {
                        val account = DeviceCredentialStore(context).read()?.accountId
                        mainHandler.post { groupRideObserver.setAccount(account) }
                    }
                }
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `setPublicRide`
     */
    fun setPublicRide(on: Boolean, until: Long?) {
        groupRideObserver.setPublicRide(if (on) PublicRideSwitch(true, until) else PublicRideSwitch.OFF)
        syncPublicRideLink()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `setManualPublicRideSharing` */
    fun setManualPublicRideSharing(enabled: Boolean) {
        groupRideObserver.setManualPublicRideSharing(enabled)
    }

    fun watchPublicRiders() {
        groupRideObserver.watchPublicRiders()
        syncPublicRideLink()
    }

    fun stopWatchingPublicRiders() {
        groupRideObserver.stopWatchingPublicRiders()
        syncPublicRideLink()
    }

    private fun publicRideBoardPhase(phase: BoardPhase) {
        val connected = when (phase) {
            BoardPhase.Connected -> true
            BoardPhase.Idle, BoardPhase.Disconnecting, BoardPhase.Error -> false
            else -> return
        }
        groupRideObserver.setBoardConnected(connected)
        syncPublicRideLink()
    }

    private fun syncPublicRideLink() {
        mainHandler.post {
            if (isStoppingService) return@post
            val needed = groupRideObserver.publicRideNeedsLink
            if (needed && !groupRideObserver.active) {
                CoreForegroundService.appDataScope.launch {
                    loadPrivacyZones(service.applicationContext)
                    loadGroupRideTarget(service.applicationContext)
                }
                groupRideObserver.start(GroupRideOnlineGate.webSocketUrl(AppStatusCoordinator.serverBaseUrl(service.applicationContext)))
            } else if (!needed && !jsObserving && groupRideObserver.active) {
                groupRideObserver.stop()
                stopIfIdle()
            }
        }
    }

    fun exitFromNotification() {
        armCompanionRestartGate()
        isStoppingService = true
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
        notificationController.cancel()
        stopCurrentBoardSession(emitDisconnected = true)
        forceStopGps()
        closeAppTask()
        service.stopSelf()
    }

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
        refreshGpsDemand()
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `stopLocationUpdates`
     */
    fun stopGpsMonitoring() {
        CoreForegroundService.pendingGpsStart = false
        forceStopGps()
        emitState()
        if (boardConfig == null && !groupRideObserver.active && !AccessorySessionManager.hasSessions()) {
            isStoppingService = true
            service.stopSelf()
        } else {
            reassertForeground()
        }
    }

    private fun forceStopGps() {
        clearDropoutGrace()
        gpsMonitor.stop()
    }

    private fun beginSession(start: PendingStart) {
        isStoppingService = false
        beginningSession = true
        try {
            withNotificationRepaintSuppressed { stopCurrentBoardSession(emitDisconnected = false) }
        } finally {
            beginningSession = false
        }
        refreshLiveHistoryLimit()
        // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `connect`
        if (start.boardConfig.replay != null) locationTracker.resetTrail()
        boardConfig = start.boardConfig
        CoreForegroundService.reloadAlertRules(service.applicationContext)
        alertFeedback.wake()
        simulatedBoard = start.boardConfig.replay?.let { spec ->
            SimulatedBoard(
                handler = mainHandler,
                recording = spec.recording,
                warmupMs = spec.warmupMs,
                loop = spec.loop,
                listener = gattListener,
                dispatchListener = ::dispatchGattEvent,
                onLocation = { fix -> onLocationUpdated(replayedLocation(fix, System.currentTimeMillis())) },
                onEnded = ::onReplayEnded,
            )
        }
        clearDropoutGrace()
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
        motorConfigRequested = false
        motorConfigValues = null
        alertCoordinator.updateBoardConfigValues(emptyMap())
        restoreBoardConfigValues(start.boardConfig)
        restoreMotorConfigValues(start.boardConfig)
        telemetryPipeline.beginSession(session, start.boardConfig)
        simulatedBoard?.let { prefillReplayWarmup(it, start.boardConfig.replay?.warmupMs ?: 0L, session) }
        wireFaultCaptures()
        telemetryPipeline.updateCanId(currentCanId)
        packetReassembler.reset()
        diagnosticsRecorder.resetTelemetryParseFailedCounters()
        connectionCoordinator.reset()
        gattHandshakeDeadline.reset()
        reconnectScheduler.cancelAndReset()
        recordingCoordinator.beginBoardSession(start.boardConfig)
        liveFaultCode = FAULT_CODE_UNKNOWN
        lastFaultDispatchAtMs = 0L
        beginGpsSessionDiagnostics()
        start.boardConfig.appBoardId?.let {
            val registry = BoardWarningRegistry.get(service.applicationContext)
            registry.beginSession(it)
            registry.onManualClear = ::onWarningManuallyCleared
        }
        lastEmittedLinkIntegrity = session.startLinkIntegrityCheck(start.boardConfig.linkIdentity())
        refreshGpsDemand()
        setStatus(BoardPhase.Connecting)
        emitState()
        updateLinkIntegrity(session.markOutdatedIfIncomplete(start.boardConfig.linkIdentity()))
        reassertForeground()

        startBleSession(start)
    }

    private fun foregroundServiceType(): Int {
        return foregroundServiceType(
            boardActive = boardConfig != null,
            gpsActive = gpsMonitor.active,
            accessoryActive = AccessorySessionManager.hasSessions(),
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
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                service.startForeground(NOTIFICATION_ID, notification, type)
            } else {
                service.startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "startForeground refused (type=$type): ${e.message}")
            stopIfIdle()
        }
    }

    private fun startBleSession(start: PendingStart) {
        val deviceId = start.boardConfig.deviceId
        if (deviceId.isNullOrBlank()) {
            failStart(start, "INVALID_DEVICE", "Board session requires deviceId")
            return
        }
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
                armConnectPhaseTimeout(it, "gatt_ready", gattHandshakeDeadline.timeoutMs)
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
                resetIdlePause()
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

    @AnyThread
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
            COMM_GET_CUSTOM_CONFIG_XML,
            COMM_GET_CUSTOM_CONFIG,
            COMM_SET_CUSTOM_CONFIG,
            -> configController.onPayload(payload, System.currentTimeMillis())
            COMM_GET_MCCONF -> handleMcconfPayload(payload.copyOfRange(1, payload.size))
            COMM_PRINT -> handlePrintPayload(payload.copyOfRange(1, payload.size))
            COMM_FORWARD_CAN -> {
                if (payload.size >= 3) {
                    when (payload[2].toInt() and 0xff) {
                        COMM_BMS_GET_VALUES -> handleBmsPayload(payload.copyOfRange(2, payload.size))
                        COMM_FW_VERSION -> handleFwVersionPayload(payload.copyOfRange(2, payload.size))
                        COMM_CUSTOM_APP_DATA -> handleCustomAppPayload(payload)
                        COMM_GET_CUSTOM_CONFIG_XML,
                        COMM_GET_CUSTOM_CONFIG,
                        COMM_SET_CUSTOM_CONFIG,
                        -> configController.onPayload(payload, System.currentTimeMillis())
                        COMM_GET_MCCONF -> handleMcconfPayload(payload.copyOfRange(3, payload.size))
                        COMM_PRINT -> handlePrintPayload(payload.copyOfRange(3, payload.size))
                    }
                }
            }
            COMM_CUSTOM_APP_DATA -> handleCustomAppPayload(payload)
        }
    }

    private fun handleCustomAppPayload(payload: ByteArray) {
        if ((payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA &&
            payload.size >= 3 &&
            (payload[1].toInt() and 0xff) == REFLOAT_MAGIC &&
            (payload[2].toInt() and 0xff) == REFLOAT_GET_INFO
        ) {
            handleLinkIntegrityRefloat(payload)
            configController.onPayload(payload, System.currentTimeMillis())
            return
        }
        if (payload.size >= 5 &&
            (payload[0].toInt() and 0xff) == COMM_FORWARD_CAN &&
            (payload[2].toInt() and 0xff) == COMM_CUSTOM_APP_DATA &&
            (payload[3].toInt() and 0xff) == REFLOAT_MAGIC &&
            (payload[4].toInt() and 0xff) == REFLOAT_GET_INFO
        ) {
            handleLinkIntegrityRefloat(payload)
            configController.onPayload(payload, System.currentTimeMillis())
            return
        }
        parseLightsControlResponse(payload)?.let { lights ->
            onBoardLightsEcho(lights)
            return
        }
        if ((payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA) {
            val now = System.currentTimeMillis()
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
            if (parsed.hasFault) {
                telemetryPipeline.noteResponse(parsed, sessionToken)
                markBoardReady()
                startLinkIntegrityProbe(sessionToken)
                AccessorySessionManager.setRiding(false)
                AccessorySessionManager.clearLightTelemetry()
                onRefloatFaultFrame(parsed.faultCode)
                return
            }
            onRefloatNormalFrame()
            val processed = telemetryPipeline.process(parsed, sessionToken) ?: return
            markBoardReady()
            startLinkIntegrityProbe(sessionToken)
            telemetry = parsed
            val batteryPct = BatterySocEstimator.estimateBatteryPercent(
                parsed.batteryVoltage,
                batteryConfigCache,
                parsed.batteryCurrent,
            )
            val batteryEstimate = batteryPct?.let { socWindow.median(it, now) }
            val firedAlerts = evaluateAlerts(parsed, batteryEstimate)
            val eventMap = processed.eventMap
            latestBatterySoc = batteryEstimate
            persistLastBattery(batteryEstimate, parsed.batteryVoltage, now)
            latestDutyExcluded = (eventMap["metricExclusions"] as? Map<*, *>)?.get(METRIC_MAX_DUTY) == true
            if (firedAlerts.isNotEmpty()) eventMap["firedAlerts"] = firedAlerts
            eventMap["generation"] = currentSessionId
            eventMap["batteryPercent"] = batteryEstimate
                refreshNotification(telemetry = parsed, batteryPercent = batteryEstimate)
                emitEvent("onLiveTick", buildLiveTick(parsed, processed, batteryEstimate, currentSessionId, firedAlerts))
                liveSeriesEmitter.primeLiveSeriesIfNeeded()
                updateIdlePause(processed.capture)
                AccessorySessionManager.setRiding(isRefloatEngaged(processed.capture.state))
                AccessorySessionManager.setLightTelemetry(parsed.speed, isRefloatEngaged(processed.capture.state))
                if (!idlePauseDetector.isPaused) {
                    recordingCoordinator.recordTelemetry(processed.capture)
                }
            }
        }

    // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (handleBms)
    private fun handleBmsPayload(payload: ByteArray) {
        val bms = parseBmsValues(payload, System.currentTimeMillis()) ?: return
        val session = boardSession
        val config = boardConfig
        if (session != null && config != null) {
            updateLinkIntegrity(session.observeBms(config.linkIdentity()))
        }
        emitEvent("onBms", bms.toMap())
        evaluateCellSpread(bms)
        evaluateBatteryConfigMismatch(bms)
        val frame = bmsSeriesRing.append(
            capturedAtMs = bms.capturedAt,
            cellVoltages = bms.cellVoltages,
            balancing = bms.balancing,
            windowMs = telemetryPipeline.recentWindowMs(),
        )
        if (frame != null && bmsSeriesFocused) emitBmsSeries("append", listOf(frame))
    }

    private inline fun guardWarningEval(site: String, block: () -> Unit) {
        try {
            block()
        } catch (throwable: Throwable) {
            reportWarningFailure(site, throwable)
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onRefloatFaultFrame`
     */
    private fun onRefloatFaultFrame(code: Int) {
        val boardId = boardConfig?.appBoardId ?: return
        val now = System.currentTimeMillis()
        if (liveFaultCode == code && now - lastFaultDispatchAtMs < FAULT_OBSERVATION_INTERVAL_MS) return
        liveFaultCode = code
        lastFaultDispatchAtMs = now
        val coordinator = VescFaultCoordinator.get(service.applicationContext)
        launchFaultWrite { coordinator.onActiveFault(boardId, code) }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onRefloatNormalFrame`
     */
    private fun onRefloatNormalFrame() {
        val now = System.currentTimeMillis()
        if (liveFaultCode == null && now - lastFaultDispatchAtMs < FAULT_OBSERVATION_INTERVAL_MS) return
        liveFaultCode = null
        lastFaultDispatchAtMs = now
        val boardId = boardConfig?.appBoardId ?: return
        val coordinator = VescFaultCoordinator.get(service.applicationContext)
        launchFaultWrite { coordinator.onFaultCleared(boardId) }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `wireFaultCaptures`
     */
    private fun wireFaultCaptures() {
        val captures = VescFaultCaptureCoordinator.get(service.applicationContext)
        captures.recentWindow = { telemetryPipeline.recentSnapshot() }
        captures.setCollectionEnabled(
            VescFaultCoordinator.get(service.applicationContext).collectionEnabled,
        )
        VescFaultCoordinator.get(service.applicationContext).apply {
            onOccurrenceOpened = { occurrence ->
                captures.capturePast(occurrence.id, occurrence.boardId, occurrence.occurredAtMs)
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `faultLogReader`
     */
    private var faultLogReader: VescFaultLogReader? = null
    private var faultLogTickHandle: Cancellable? = null

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `readVescFaultLog`
     */
    fun readVescFaultLog(
        boardId: String,
        onSuccess: (String) -> Unit,
        onError: (String, String) -> Unit,
    ) {
        if (boardStatus != BoardPhase.Connected || boardConfig?.appBoardId != boardId) {
            onError("VESC_FAULT_LOG_BOARD_NOT_CONNECTED", "Matching Board must be connected")
            return
        }
        val speed = telemetry?.speed
        if (speed == null || !speed.isFinite() || kotlin.math.abs(speed) > MANUAL_FAULT_LOG_MAX_SPEED_KMH) {
            onError("VESC_FAULT_LOG_BOARD_MOVING", "Stop the Board before reading controller fault log")
            return
        }
        if (faultLogReader != null) {
            onError("VESC_FAULT_LOG_BUSY", "Controller fault log read already in progress")
            return
        }
        val session = boardSession ?: return onError(
            "VESC_FAULT_LOG_BOARD_NOT_CONNECTED",
            "Matching Board must be connected",
        )
        val transport = currentBoardTransport() ?: return onError(
            "VESC_FAULT_LOG_BOARD_NOT_CONNECTED",
            "Matching Board must be connected",
        )
        val reader = VescFaultLogReader(System.currentTimeMillis(), onSuccess, onError)
        faultLogReader = reader
        sendPayloadWithRetry(buildFaultsTerminalCommand(transport), session)
        scheduleFaultLogTick(session)
    }

    private fun scheduleFaultLogTick(session: BoardSession) {
        faultLogTickHandle?.cancel()
        faultLogTickHandle = scheduler.postDelayedForSession(
            session,
            VescFaultLogReader.TICK_MS,
            ::isCurrentBoardSession,
        ) {
            faultLogTickHandle = null
            val reader = faultLogReader ?: return@postDelayedForSession
            if (!reader.poll(System.currentTimeMillis())) {
                scheduleFaultLogTick(session)
                return@postDelayedForSession
            }
            faultLogReader = null
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `handlePrintPayload`
     */
    private fun handlePrintPayload(body: ByteArray) {
        faultLogReader?.onPrintChunk(body, System.currentTimeMillis())
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `liveFaultCode`
     */
    private var liveFaultCode: Int? = FAULT_CODE_UNKNOWN
    private var lastFaultDispatchAtMs = 0L

    private fun launchWarningWrite(block: suspend () -> Unit) {
        CoreForegroundService.appDataScope.launch(
            warningWriteExceptionHandler + CoreForegroundService.warningWriteDispatcher,
        ) { block() }
    }

    private fun launchFaultWrite(block: suspend () -> Unit) {
        CoreForegroundService.appDataScope.launch(
            faultWriteExceptionHandler + CoreForegroundService.warningWriteDispatcher,
        ) { block() }
    }

    /**
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
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onBoardConfigValues`
     */
    private fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) {
        if (values.boardId != boardConfig?.appBoardId) return
        if (lastEmittedLinkIntegrity != LinkIntegrity.Trusted) return
        boardConfigValues = values
        syncBoardLightsFromConfig(values)
        alertCoordinator.updateBoardConfigValues(values.values)
        val repo = AppDataRepository.get(service.applicationContext)
        CoreForegroundService.appDataScope.launch {
            try {
                when (origin) {
                    BoardConfigOperationOrigin.FreshRead -> {
                        repo.saveFreshBoardConfigValues(values)?.let { emitEvent("onBoardConfigChangeNotice", mapOf("notice" to it.toMap())) }
                    }
                    is BoardConfigOperationOrigin.VescapeWrite -> {
                        repo.saveBoardConfigValues(values, origin.source, origin.tuneProfileId)
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Throwable) { RecordingStorageFailure.report("board_config_save", "write_failed", e) }
        }
        evaluateConfigSafety(values)
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `restoredBoardConfigValues`
     */
    private fun restoreBoardConfigValues(config: SessionConfig) {
        val boardId = config.appBoardId ?: return
        val refloatBaseVersion = config.refloatBaseVersion ?: return
        val repo = AppDataRepository.get(service.applicationContext)
        val session = boardSession
        CoreForegroundService.appDataScope.launch {
            val restored = try { repo.getBoardConfigValues(boardId, refloatBaseVersion) }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Throwable) { RecordingStorageFailure.reportRead("board_config_restore", e); return@launch }
                ?: return@launch
            scheduler.post {
                if (session == null || !isCurrentBoardSession(session)) return@post
                if (boardConfig?.appBoardId != boardId) return@post
                if (boardConfig?.refloatBaseVersion != refloatBaseVersion) return@post
                if (lastEmittedLinkIntegrity == LinkIntegrity.Mismatched) return@post
                if (boardConfigValues != null) return@post
                boardConfigValues = restored
                syncBoardLightsFromConfig(restored)
                alertCoordinator.updateBoardConfigValues(restored.values)
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `beginSession`
     */
    private fun restoreMotorConfigValues(config: SessionConfig) {
        val boardId = config.appBoardId ?: return
        val repo = AppDataRepository.get(service.applicationContext)
        val session = boardSession
        CoreForegroundService.appDataScope.launch {
            val restored = try { repo.getLatestMotorConfigValues(boardId) }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Throwable) { RecordingStorageFailure.reportRead("motor_config_restore", e); return@launch }
                ?: return@launch
            scheduler.post {
                if (session == null || !isCurrentBoardSession(session)) return@post
                if (boardConfig?.appBoardId != boardId) return@post
                if (lastEmittedLinkIntegrity == LinkIntegrity.Mismatched) return@post
                if (motorConfigValues != null) return@post
                motorConfigValues = restored
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `clearBoardConfigValues`
     */
    private fun clearBoardConfigValues() {
        boardConfigValues = null
        motorConfigValues = null
        alertCoordinator.updateBoardConfigValues(emptyMap())
        val boardId = boardConfig?.appBoardId ?: return
        val repo = AppDataRepository.get(service.applicationContext)
        CoreForegroundService.appDataScope.launch { repo.clearBoardConfigValues(boardId) }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `evaluateConfigSafety`
     */
    private fun evaluateConfigSafety(values: BoardConfigValues) = guardWarningEval("config_safety") {
        if (!boardWarningsEnabled) return@guardWarningEval
        val boardId = boardConfig?.appBoardId ?: return@guardWarningEval
        val seriesCount = (batteryConfigCache?.get("seriesCount") as? Number)?.toInt()
        val perCellSupported = ConfigSafetyDetector.supportsPerCellVoltage(fwVersionString)
        val report = ConfigSafetyDetector.evaluate(values, seriesCount, perCellSupported)
        val registry = BoardWarningRegistry.get(service.applicationContext)
        launchWarningWrite {
            for (finding in report.findings) {
                registry.reportFinding(boardId, finding.kind, finding.severity, finding.payloadJson)
            }
            for (kind in report.cleanKinds) {
                registry.reportCleanEvaluation(boardId, kind)
            }
            for (wire in BoardWarningKind.RETIRED_WIRE) {
                registry.reportCleanEvaluation(boardId, wire)
            }
        }
    }

    private fun triggerBoardConfigRead(session: BoardSession) {
        if (!isCurrentBoardSession(session)) return
        configController.consumeRead(
            PendingConfigRead(
                onSuccess = { requestMotorConfig(session) },
                onError = { _, _ -> requestMotorConfig(session) },
            ),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `requestMotorConfig`
     */
    private fun requestMotorConfig(session: BoardSession) {
        if (!isCurrentBoardSession(session) || motorConfigRequested) return
        val transport = currentBoardTransport() ?: return
        motorConfigRequested = true
        sendPayloadWithRetry(transport.frame(byteArrayOf(COMM_GET_MCCONF.toByte())), session)
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `handleMcconfPayload`
     */
    private fun handleMcconfPayload(body: ByteArray) {
        val session = boardSession ?: return
        if (!isCurrentBoardSession(session) || !motorConfigRequested) return
        if (lastEmittedLinkIntegrity != LinkIntegrity.Trusted) return
        when (val result = McconfDecoder.decode(body)) {
            is McconfDecodeResult.Decoded -> {
                val values = MotorConfigValues(
                    boardId = boardConfig?.appBoardId,
                    signature = result.signature,
                    firmware = result.firmware,
                    capturedAtMs = System.currentTimeMillis(),
                    freshness = BoardConfigFreshness.FRESH,
                    values = result.values,
                )
                motorConfigValues = values
                val repo = AppDataRepository.get(service.applicationContext)
                CoreForegroundService.appDataScope.launch {
                    try { repo.saveFreshMotorConfigValues(values)?.let {
                      emitEvent("onBoardConfigChangeNotice", mapOf("notice" to it.toMap()))
                    } } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (e: Throwable) { RecordingStorageFailure.report("motor_config_save", "write_failed", e) }
                }
                Log.i(
                    VESC_SESSION_TAG,
                    "MCCONF decoded: ${result.firmware} signature=${result.signature} fields=${result.values.size}",
                )
            }
            is McconfDecodeResult.UnknownSignature -> {
                motorConfigValues = null
                Log.w(
                    VESC_SESSION_TAG,
                    "MCCONF signature ${result.signature} has no layout (${result.byteCount} bytes)",
                )
            }
            is McconfDecodeResult.Malformed -> {
                motorConfigValues = null
                Log.w(VESC_SESSION_TAG, "MCCONF malformed: ${result.reason}")
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (setBmsSeriesFocused)
     */
    fun setBmsSeriesFocused(focused: Boolean) {
        bmsSeriesFocused = focused
        if (!focused) return
        emitBmsSeries(
            "snapshot",
            bmsSeriesRing.snapshot(telemetryPipeline.recentWindowMs(), System.currentTimeMillis()),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (setFocusedSeriesMetrics)
     */
    fun setFocusedSeriesMetrics(metrics: List<String>) {
        liveSeriesEmitter.setFocusedMetrics(metrics.toSet())
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `setLiveSeriesMetrics`
     */
    fun setLiveSeriesMetrics(metrics: List<String>) {
        liveSeriesEmitter.setLiveMetrics(metrics.toSet())
    }

    fun recentTelemetry(): List<Map<String, Any?>> = telemetryPipeline.recentSnapshot()

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
        val version = when (val result = RefloatConfigProtocol.parseGetInfoResponse(payload, currentBoardTransport())) {
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
        scheduler.postDelayedForSession(session, LINK_INTEGRITY_CHECK_TIMEOUT_MS, ::isCurrentBoardSession) {
            updateLinkIntegrity(session.markCheckTimedOut())
        }
    }

    private var lastEmittedLinkIntegrity = LinkIntegrity.Unknown
    private var boardConfigReadScheduled = false
    private var motorConfigRequested = false

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `motorConfigValues`
     */
    private var motorConfigValues: MotorConfigValues? = null
        set(value) {
            field = value
            alertCoordinator.updateMotorConfigValues(value?.values.orEmpty())
            emitEvent("onMotorConfigValues", mapOf("values" to value?.toBridgeMap()))
        }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `motorConfigValuesMap`
     */
    internal fun motorConfigValuesMap(): Map<String, Any?>? = motorConfigValues?.toBridgeMap()

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `boardConfigValues`
     */
    private var boardConfigValues: BoardConfigValues? = null
        set(value) {
            field = value
            emitEvent("onBoardConfigValues", mapOf("values" to value?.toBridgeMap()))
        }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `boardConfigValuesMap`
     */
    internal fun boardConfigValuesMap(): Map<String, Any?>? = boardConfigValues?.toBridgeMap()

    private fun updateLinkIntegrity(next: LinkIntegrity) {
        if (next == lastEmittedLinkIntegrity) return
        lastEmittedLinkIntegrity = next
        emitState()
        pushWatchBoard()
        if (next == LinkIntegrity.Trusted) scheduleBoardConfigRead()
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
        if (boardStatus == BoardPhase.WaitingForTelemetry) {
            armBoardReadyTimeout(session)
        }
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
        startGroundClearanceTilt(sessionToken)
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startPolling`
     */
    private fun currentBoardTransport(): BoardTransport? = boardConfig?.transport

    private val currentCanId: Int? get() = (currentBoardTransport() as? BoardTransport.Can)?.canId

    private fun stopPolling() {
        pollingLoop.stop()
        stopGroundClearanceTilt()
        AccessorySessionManager.setRiding(false)
        AccessorySessionManager.clearLightTelemetry()
        idlePauseDetector.reset()
        telemetryPipeline.cancelStaleWatchdog()
        liveSeriesEmitter.stop()
    }

    private fun watchSnapshot(): WatchSnapshot {
        val current = telemetry
        val progress = NavigationController.get(service.applicationContext).currentProgress
        val origin = WatchRouteMirror.origin
        val rider = locationTracker.riderPosition
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
            navBearingDeg = if (offset != null) progress?.bearingDeg else null,
            navDistanceM = if (offset != null) progress?.remainingMeters else null,
            riderEastM = offset?.first,
            riderNorthM = offset?.second,
            courseDeg = rider?.courseDeg,
            routeSpanM = WatchRouteMirror.viewportSpanM,
            remoteTilt = if (current != null) remoteTiltController.currentValue else null,
            tiltControl = watchTiltControl(),
            mapPosition = rider?.let { expo.modules.vescapecore.watch.WatchMapPosition(it.latitude, it.longitude) },
            riderSpeedMps = rider?.speedMps,
            trail = expo.modules.vescapecore.watch.watchTrail(
                rider?.let { GeoPoint(it.latitude, it.longitude) },
                locationTracker.recentLocations(),
            ),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `groupRideFrame`
     */
    private fun groupRideFrame(): GroupRideFrame? {
        val roster = groupRideObserver.watchRoster ?: return null
        val rider = locationTracker.riderPosition
        return GroupRideFrameBuilder.build(
            roster = roster,
            own = rider?.let { GeoPoint(it.latitude, it.longitude) },
            courseDeg = rider?.courseDeg,
            spanM = WatchRouteMirror.viewportSpanM,
            nowMs = System.currentTimeMillis(),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `watchTiltControl`
     */
    private fun watchTiltControl(): WatchTiltControl = when (remoteInput.manualBlocker) {
        RemoteInputOwner.SENSOR -> WatchTiltControl.SENSOR
        RemoteInputOwner.MOVE -> WatchTiltControl.MOVE
        else -> when {
            !firmwareCommandsTrusted() -> WatchTiltControl.BLOCKED
            remoteInput.owner == RemoteInputOwner.MANUAL -> WatchTiltControl.MANUAL
            else -> WatchTiltControl.FREE
        }
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `isTelemetryStale` */
    private fun isTelemetryStale(now: Long = System.currentTimeMillis()): Boolean =
        now - telemetryPipeline.lastTelemetryAt >= TELEMETRY_STALE_MS

    private fun buildLiveTick(
        parsed: RefloatTelemetry,
        processed: ProcessedTelemetry,
        batteryPercent: Double?,
        generation: Long,
        firedAlerts: List<Map<String, Any?>>,
    ): Map<String, Any?> {
        val tick = parsed.toMap().toMutableMap()
        tick.remove("location")
        tick["batteryPercent"] = batteryPercent
        tick["speedPeak"] = processed.speedPeak
        tick["dutyPeak"] = processed.dutyPeak
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
        gattHandshakeDeadline.reset()
        reconnectScheduler.resetAttempts()
        boardError = null
        recordLocalDiagnostic(
            "board_ready",
            boardConfig,
            "connect",
            mapOf("message" to "Board telemetry received"),
        )
        boardConfig?.let { recordingCoordinator.markBoardReady(it) }
        alertFeedback.wake()
        alertFeedback.boardConnected(playCue = connectionSoundsEnabled)
        watchMirror.boardConnected(currentSessionId)
        setLinkLost(false)
        transitionBoardPhase(BoardPhase.Connected)
        weatherCoordinator.refresh()
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onTelemetryStaleFired` */
    private fun onTelemetryStaleFired() {
        val now = System.currentTimeMillis()
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
        firmwareCommandsTrusted() && remoteInput.manualHold(value)

    fun lockRemoteTilt(value: Int): Boolean =
        firmwareCommandsTrusted() && remoteInput.manualLock(value)

    fun releaseRemoteTilt(value: Int, durationMs: Long): Boolean =
        firmwareCommandsTrusted() && remoteInput.manualRelease(value, durationMs)

    // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `stopRemoteTilt`
    fun stopRemoteTilt(): Boolean =
        remoteInput.cancelTilt()

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startGroundClearanceTilt`
     */
    private fun startGroundClearanceTilt(session: BoardSession) {
        groundClearanceBinding.start(
            schedule = { tick ->
                scheduler.postDelayedForSession(
                    session,
                    BoardGroundClearanceBinding.TICK_MS,
                    ::isCurrentBoardSession,
                ) { tick() }
            },
            boardInput = {
                BoardGroundClearanceBinding.BoardInput(
                    commandsTrusted = firmwareCommandsTrusted(),
                    telemetryFresh = telemetry != null && !isTelemetryStale(),
                )
            },
        )
    }

    private fun stopGroundClearanceTilt() {
        groundClearanceBinding.stop()
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `groundClearanceTiltState`
     * @parity /modules/vescape-core/src/index.ts `GroundClearanceTiltState`
     */
    fun groundClearanceTiltState(): Map<String, Any?> = groundClearanceBinding.state()

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `boardLights`
     */
    private var boardLights: BoardLightsState? = null

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `lightsEventBody` */
    fun lightsEventBody(): Map<String, Any?> = mapOf(
        "enabled" to boardLights?.enabled,
        "headlightsEnabled" to boardLights?.headlightsEnabled,
    )

    private fun publishBoardLights() {
        emitEvent("onBoardLights", lightsEventBody())
        pushWatchBoard()
    }

    private fun pushWatchBoard() {
        watchMirror.pushBoard(
            WatchBoard(
                lightsEnabled = boardLights?.enabled,
                headlightsEnabled = boardLights?.headlightsEnabled,
                lightsControllable = firmwareCommandsTrusted() && currentBoardTransport() != null,
            ),
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `setBoardLights`
     */
    fun setBoardLights(enabled: Boolean, headlightsEnabled: Boolean): Boolean {
        if (!firmwareCommandsTrusted()) return false
        val transport = currentBoardTransport() ?: return false
        return sendPayloadWithRetry(
            buildLightsControlCommand(transport, lightsGeneration(), enabled, headlightsEnabled),
        )
    }

    private fun lightsGeneration(): BoardLightsGeneration =
        BoardLightsGeneration.forBaseVersion(boardConfig?.refloatBaseVersion)

    private fun onBoardLightsEcho(lights: BoardLightsState) {
        boardLights = lights
        publishBoardLights()
        if (!lightsCommandChangesBoardConfig(boardConfig?.refloatBaseVersion)) return
        val values = boardConfigValues ?: return
        val rebased = try {
            values.withLights(lights.enabled, lights.headlightsEnabled)
        } catch (e: RefloatConfigEncodeException) {
            captureDiagnostic(
                "board_lights_write_base_patch_failed",
                diagnosticProperties(boardConfig, "config_rw") + mapOf("code" to e.code.name, "message" to e.message),
            )
            values.demotedToProvisional().withLights(lights.enabled, lights.headlightsEnabled)
        } ?: return
        boardConfigValues = rebased
        val boardId = rebased.boardId ?: return
        val baseVersion = rebased.refloatBaseVersion ?: return
        val patch = rebased.values.filterKeys {
            it == BoardConfigFlagField.LEDS_ON.id || it == BoardConfigFlagField.HEADLIGHTS_ON.id
        }
        val repo = AppDataRepository.get(service.applicationContext)
        CoreForegroundService.appDataScope.launch { repo.patchBoardConfigValues(boardId, baseVersion, patch) }
    }

    private fun syncBoardLightsFromConfig(values: BoardConfigValues) {
        if (lightsGeneration() == BoardLightsGeneration.Current && boardLights != null) return
        val enabled = values.flag(BoardConfigFlagField.LEDS_ON) ?: return
        val lights = BoardLightsState(enabled, values.flag(BoardConfigFlagField.HEADLIGHTS_ON) ?: false)
        if (lights == boardLights) return
        boardLights = lights
        publishBoardLights()
    }

    fun startBoardMove(input: Int): Boolean = remoteInput.startMove(input)

    fun watchMove(direction: Int) = watchMoveRelay.accept(direction)

    internal fun watchLights(switch: WatchLightsSwitch, on: Boolean) = watchLightsRelay.accept(switch, on)

    private var watchTiltRefused = false

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `watchTiltLock`
     */
    fun watchTiltLock(value: Int) = scheduler.post {
        val refused = !lockRemoteTilt(value)
        if (refused != watchTiltRefused) {
            watchTiltRefused = refused
            recordWatchDiagnostic(if (refused) "watch_tilt_refused" else "watch_tilt_locked", mapOf("value" to value))
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `watchTiltCancel`
     */
    fun watchTiltCancel() = scheduler.post {
        watchTiltRefused = false
        recordWatchDiagnostic("watch_tilt_cancel", mapOf("accepted" to stopRemoteTilt()))
    }

    internal fun watchMirrorWakeLevel(level: WatchMirrorWakeLevel) {
        scheduler.post { watchMirror.acceptWakeLevel(level) }
    }

    fun stopBoardMove(): Boolean = remoteInput.stopMove()

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `riderPosition`
     */
    fun riderPosition(): LocationSnapshot? = locationTracker.riderPosition

    fun remoteTiltState(): Map<String, Any?>? =
        remoteTiltWire(
            remoteTiltController.currentValue,
            remoteTiltController.phase,
            remoteTiltController.decayProgress,
            remoteInput.owner,
        )

    // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `sendPayloadWithRetry`
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
        persistLastBattery(latestBatterySoc, telemetry?.batteryVoltage, System.currentTimeMillis(), force = true)
        stopGroundClearanceTilt()
        remoteInput.reset()
        flushTelemetryDiagnostics("stop")
        configController.onSessionTerminated("Board session stopped during Refloat config op")
        val stoppedConfig = boardConfig
        val wasReplay = simulatedBoard != null
        reconnectScheduler.cancelAndReset()
        cancelBoardReadyTimeout()
        stopPolling()
        transport.clear(markIntentional = true)
        simulatedBoard = null
        alertCoordinator.stopAllGeiger()
        alertFeedback.goIdle()
        weatherAlerts.rideEnded()
        recordGpsSessionSummary(stoppedConfig)
        recordingCoordinator.finishBoardSession(
            status = if (emitDisconnected) "disconnected" else "stopped",
            markerType = if (emitDisconnected) "disconnected" else "app_stop",
            config = stoppedConfig,
        )
        connectionCoordinator.clearPending()
        fwVersionString = null
        telemetry = null
        boardConfigValues = null
        motorConfigValues = null
        motorConfigRequested = false
        boardLights = null
        publishBoardLights()
        boardSession?.invalidate()
        boardSession = null
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
        faultLogTickHandle?.cancel()
        faultLogTickHandle = null
        faultLogReader?.cancel()
        faultLogReader = null
        telemetryPipeline.endSession()
        sessionSequence += 1
        boardConfig = null
        boardError = null
        // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `releaseGpsFromSession`
        if (wasReplay) locationTracker.resetTrail()
        clearDropoutGrace()
        transitionBoardPhase(BoardPhase.Idle)
        refreshGpsDemand()
    }

    private fun persistLastBattery(percent: Double?, voltage: Double?, now: Long, force: Boolean = false) {
        if (percent == null) return
        val boardId = boardConfig?.appBoardId ?: return
        if (!force && now - lastBatteryPersistedAt < 30_000L) return
        lastBatteryPersistedAt = now
        CoreForegroundService.appDataScope.launch {
            try {
                AppDataRepository.get(service.applicationContext).updateLastBattery(boardId, percent, voltage, now)
                WatchLastBatteryPusher.push(service)
            } catch (error: Exception) {
                RecordingStorageFailure.report("last_battery_save", "write_failed", error)
            }
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

    private fun failStartTerminal(start: PendingStart, code: String, message: String) {
        connectionCoordinator.clearPending()
        cancelBoardReadyTimeout()
        stopPolling()
        transport.clear(markIntentional = true)
        setError(message)
        recordingCoordinator.failSession()
        start.onError(code, message)
    }

    private fun transitionBoardPhase(
        next: BoardPhase,
        recordName: String? = null,
        recordProperties: Map<String, Any?> = emptyMap(),
    ) {
        boardStatus = next
        publicRideBoardPhase(next)
        pushWatchBoard()
        recordName?.let { recordingCoordinator.recordState(it, recordProperties) }
        rescheduleAutoClose()
        refreshNotification()
        emitState()
    }

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

    private fun isAppVisible(): Boolean {
        val state = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(state)
        return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    private fun onAutoCloseFired() {
        if (!autoCloseEnabled || isBoardLinked() || isStoppingService) return
        if (isAppVisible() || groupRideObserver.publicRideNeedsGps) {
            rescheduleAutoClose()
            return
        }
        Log.i(VESC_SESSION_TAG, "Auto close: no board link for ${autoCloseDelayMinutes}min, exiting app")
        recordLocalDiagnostic("auto_close_app", boardConfig, "session", mapOf("delayMinutes" to autoCloseDelayMinutes))
        isStoppingService = true
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
        notificationController.cancel()
        stopCurrentBoardSession(emitDisconnected = true)
        forceStopGps()
        closeAppTask()
        service.stopSelf()
    }

    private fun setStatus(next: BoardPhase) =
        transitionBoardPhase(next, recordName = next.recordName())

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `beginReconnect`
     */
    private fun scheduleAutoReconnect(session: SessionConfig, gattStatus: Int?, reason: String) {
        if (!session.autoReconnect || isStoppingService) return
        val reconnectSession = boardSession ?: return
        resetIdlePause()
        if (boardStatus == BoardPhase.Connected || boardStatus == BoardPhase.Stale) {
            alertFeedback.boardDisconnected(playCue = connectionSoundsEnabled)
        }
        setLinkLost(true)
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

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `gpsPhase`
     */
    private fun gpsPhase(): GpsPhase = if (simulatedBoard != null) GpsPhase.Active else gpsMonitor.phase

    private fun reportedBoardPhase(atMs: Long = System.currentTimeMillis()): BoardPhase =
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
        if (!notificationGate.shouldPost(phase, System.currentTimeMillis(), force)) return
        presenter.show(
            phase = phase,
            telemetry = telemetry,
            batteryPercent = batteryPercent,
            errorMessage = errorMessage,
        )
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onRideNoticesChanged`
     */
    private fun onRideNoticesChanged(notices: List<RideNotice>) {
        val top = notices.firstOrNull()
        val changed = top?.headline() != notificationNotice?.headline()
        notificationNotice = top
        if (changed && notificationController.isShowing()) refreshNotification(force = true)
    }

    private fun RideNotice.headline() = listOf(id, rev, content.title, content.severity)

    private inline fun withNotificationRepaintSuppressed(block: () -> Unit) {
        notificationRepaintSuppressed = true
        try {
            block()
        } finally {
            notificationRepaintSuppressed = false
        }
    }

    private fun emitState() {
        CoreForegroundService.liveStateChanged?.invoke()
    }

    private fun emitEvent(name: String, body: Map<String, Any?>) {
        CoreForegroundService.emitEvent?.invoke(name, body)
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `riding`
     */
    private val riding: Boolean
        get() {
            if (boardConfig == null || idlePauseDetector.isPaused) return false
            return GpsDemand.ridingThroughDropout(linkLostAtMs, System.currentTimeMillis())
        }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `refreshGpsDemand`
     */
    fun refreshGpsDemand() {
        val mode = GpsDemand.resolve(
            appVisible = appVisible,
            riding = riding,
            watchNavigating = watchMirror.navigating,
            replayOwnsPosition = simulatedBoard != null,
            manualPublicRide = groupRideObserver.publicRideNeedsGps,
        )
        val wasActive = gpsMonitor.active
        gpsMonitor.apply(mode)
        if (wasActive && mode == GpsPowerMode.Off) {
            val appContext = service.applicationContext
            CoreForegroundService.appDataScope.launch {
                TelemetryRepository.get(appContext).flushBlocking()
            }
        }
        emitState()
        if (wasActive != gpsMonitor.active) reassertForeground()
        if (!beginningSession && wasActive && !gpsMonitor.active) stopIfIdle()
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `setLinkLost`
     */
    private fun setLinkLost(lost: Boolean) {
        if (!lost) {
            if (linkLostAtMs == null) return
            dropoutGraceHandle?.cancel()
            dropoutGraceHandle = null
            linkLostAtMs = null
            refreshGpsDemand()
            return
        }
        if (linkLostAtMs != null) return
        linkLostAtMs = System.currentTimeMillis()
        dropoutGraceHandle?.cancel()
        dropoutGraceHandle = scheduler.postDelayed(RIDE_DROPOUT_GRACE_MS) {
            dropoutGraceHandle = null
            weatherAlerts.rideEnded()
            alertFeedback.goIdle()
            refreshGpsDemand()
        }
        refreshGpsDemand()
    }

    private fun clearDropoutGrace() {
        linkLostAtMs = null
        dropoutGraceHandle?.cancel()
        dropoutGraceHandle = null
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
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `replayedLocation`
     */
    private fun replayedLocation(fix: ReplayLocation, atMs: Long): Location =
        Location(LocationManager.GPS_PROVIDER).apply {
            latitude = fix.latitude
            longitude = fix.longitude
            time = atMs
            elapsedRealtimeNanos =
                SystemClock.elapsedRealtimeNanos() - (System.currentTimeMillis() - atMs) * 1_000_000
            fix.speedMps?.let { speed = it }
            fix.bearingDeg?.let { bearing = it }
            fix.accuracyM?.let { accuracy = it }
            fix.altitudeM?.let { altitude = it }
        }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `prefillReplayWarmup`
     */
    private fun prefillReplayWarmup(board: SimulatedBoard, warmupMs: Long, session: BoardSession) {
        val warmup = board.warmup
        if (warmup.isEmpty()) return
        val startedAt = System.currentTimeMillis()
        val oldest = startedAt - telemetryPipeline.recentWindowMs()
        for (event in warmup) {
            val stamp = startedAt - (warmupMs - event.t)
            if (stamp < oldest) continue
            when (event) {
                is ReplayEvent.Frame -> prefillFrame(event.payload, stamp, session)
                is ReplayEvent.Fix -> locationTracker.prefill(replayedLocation(event.fix, stamp))
                is ReplayEvent.ConfigWrite -> Unit
            }
        }
        telemetryPipeline.finishPrefill()
        telemetryPipeline.cancelStaleWatchdog()
    }

    private fun prefillFrame(payload: ByteArray, stamp: Long, session: BoardSession) {
        when (payload[0].toInt() and 0xff) {
            COMM_BMS_GET_VALUES -> parseBmsValues(payload, stamp)?.let { bms ->
                bmsSeriesRing.append(
                    capturedAtMs = bms.capturedAt,
                    cellVoltages = bms.cellVoltages,
                    balancing = bms.balancing,
                    windowMs = telemetryPipeline.recentWindowMs(),
                )
            }
            COMM_CUSTOM_APP_DATA -> {
                val parsed = parseRefloatGetAllData(
                    payload = payload,
                    avgLatency = null,
                    packetAt = stamp,
                    location = null,
                    pullRateHz = null,
                ) ?: return
                if (parsed.hasFault) return
                val processed = telemetryPipeline.prefill(parsed, session) ?: return
                processed.eventMap["batteryPercent"] =
                    BatterySocEstimator.estimateBatteryPercent(parsed.batteryVoltage, batteryConfigCache, parsed.batteryCurrent)
                        ?.let { socWindow.median(it, stamp) }
            }
        }
    }

    private fun onReplayEnded() {
        stopCurrentBoardSession(emitDisconnected = false)
    }

    private fun onLocationUpdated(location: Location) {
        recordGpsFix(location)
        val snapshot = locationTracker.onLocationUpdated(location)
        recordRideTrackFix(snapshot)
        latestRiderPresence()?.let(groupRideObserver::pushPresence)
        groupRideObserver.refreshSignalAvailability()
        groupRideObserver.onFix(location.latitude, location.longitude)
        weatherCoordinator.onPosition(location.latitude, location.longitude)
    }

    private fun recordRideTrackFix(snapshot: LocationSnapshot) {
        if (idlePauseDetector.isPaused) return
        recordingCoordinator.recordGpsFix(snapshot.toCapture())
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `recordGpsSessionSummary`
     */
    private fun beginGpsSessionDiagnostics() {
        gpsSessionStartedAt = System.currentTimeMillis()
        gpsFixCount = 0
        gpsPreciseFixCount = 0
        gpsFirstFixAt = null
        gpsFirstPreciseFixAt = null
        gpsLastFixAt = null
    }

    private fun recordGpsFix(location: Location) {
        if (gpsSessionStartedAt == null) return
        val at = System.currentTimeMillis()
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
        val endedAt = System.currentTimeMillis()
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
                "updates_started" to gpsMonitor.updatesStarted,
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
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendWeather`
     */
    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `storeWeatherObservation`
     */
    private fun storeWeatherObservation(weather: Weather?) {
        val observation = weather?.observation() ?: return
        val recorder = weatherObservationRecorder(service.applicationContext)
        val ticket = recorder.ticket()
        CoreForegroundService.appDataScope.launch {
            try {
                recorder.record(observation, ticket)
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                RecordingStorageFailure.report("weather_observations", "write_failed", error)
            }
        }
    }

    private fun onWeatherChanged(weather: Weather?) {
        if (weather == null) return
        emitEvent("onWeather", mapOf("weather" to weather.toMap()))
        weatherAlerts.evaluate(weather)
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `latestRiderPresence` */
    private fun latestRiderPresence(): RiderPresence? {
        val location = groupRidePrivacy.presenceFix(locationTracker.latestPreciseLocation ?: locationTracker.latestLocation)
            ?: return null
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
            phoneBattery = readPhoneBattery(service),
            boardName = if (boardConfig != null) (boardConfig?.deviceName ?: selectedBoardName) else null,
            target = groupRideTarget,
            atMs = location.timestamp,
        )
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `riderSignalContext` */
    private fun riderSignalContext(): RiderSignalContext =
        groupRidePrivacy.signalContext(locationTracker.latestLocation, System.currentTimeMillis())

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `loadPrivacyZones`
     */
    suspend fun loadPrivacyZones(context: Context) {
        try {
            groupRidePrivacy.reload {
                AppDataRepository.get(context).getEnabledPrivacyZoneEntities()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load privacy zones for presence gate: ${e.message}")
            RecordingStorageFailure.reportRead("group_ride_privacy_zones_read", e)
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `loadGroupRideTarget`
     */
    suspend fun loadGroupRideTarget(context: Context) {
        val reload = reloadGroupRideTarget(groupRideTarget, read = {
            AppDataRepository.get(context).getDirectionPoint()?.let { (latitude, longitude) ->
                TargetPoint(lat = latitude, lng = longitude)
            }
        })
        if (!reload.loaded) return
        groupRideTarget = reload.target
        mainHandler.post { latestRiderPresence()?.let(groupRideObserver::pushPresence) }
    }

    /**
     * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `liveState`
     */
    fun liveStateMap(includeRecent: Boolean = false): Map<String, Any?> {
        val settings = kotlinx.coroutines.runBlocking {
            AppDataRepository.get(service.applicationContext).getTypedSettings()
        }
        applyTelemetrySettings(settings)
        return liveStateMapWithoutStorage(settings, includeRecent)
    }

    fun liveStateMapWithoutStorage(includeRecent: Boolean = false): Map<String, Any?> =
        liveStateMapWithoutStorage(lastAppliedSettings, includeRecent)

    private fun liveStateMapWithoutStorage(
        settings: AppSettings,
        includeRecent: Boolean,
    ): Map<String, Any?> {
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
                gpsPhase = gpsPhase(),
                gpsMode = gpsMonitor.mode,
                latestLocation = locationTracker.latestLocation,
                latestPreciseLocation = locationTracker.latestPreciseLocation,
                recentLocations = recentLocationsValue,
                gpsError = gpsError,
                recordingEnabled = recordingCoordinator.telemetryRecordingEnabled,
                recordingPaused = idlePauseDetector.isPaused,
                remoteTiltValue = remoteTiltController.currentValue,
                remoteTiltPhase = remoteTiltController.phase,
                remoteTiltDecay = remoteTiltController.decayProgress,
                remoteTiltOwner = remoteInput.owner,
                linkIntegrity = boardSession?.linkIntegrity ?: LinkIntegrity.Unknown,
                settings = settings,
            )
        )
    }

    suspend fun loadAlertRules(context: Context, generation: Long) {
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
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load alert rules: ${e.message}")
            RecordingStorageFailure.reportRead("enabled_alert_rules_read", e)
        }
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `reloadBoardDataForActiveBoard`
     * @platform-diff Android also refreshes the selected-board idle notification title.
     */
    suspend fun reloadBoardDataForActiveBoard() {
        val current = boardConfig
        val repo = AppDataRepository.get(service.applicationContext)
        val selectedBoardId: String?
        val board: Map<String, Any?>?
        val activeBoardId = current?.appBoardId
        try {
            selectedBoardId = repo.getTypedSettings().selectedBoardId
            val boardId = activeBoardId ?: selectedBoardId ?: return
            board = repo.getBoard(boardId)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load board data: ${e.message}")
            RecordingStorageFailure.reportRead("active_board_read", e)
            return
        }
        val boardId = activeBoardId ?: selectedBoardId ?: return
        board ?: return
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
            }
            board?.get("batteryConfig") as? Map<String, Any?>
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Failed to load battery config: ${e.message}")
            RecordingStorageFailure.reportRead("board_battery_config_read", e)
            return
        }
    }

    private fun evaluateAlerts(t: RefloatTelemetry, batteryPercent: Double?): List<Map<String, Any?>> =
        alertCoordinator.evaluate(t, batteryPercent) { name, properties ->
            val batteryProperties = if (name == "battery_alert_fired") properties + mapOf("battery_config_loaded" to (batteryConfigCache != null)) else properties
            recordLocalDiagnostic(name, boardConfig, "alert", batteryProperties)
        }

    fun applyLiveHistoryLimitMinutes(minutes: Int) {
        telemetryPipeline.setLiveHistoryLimitMinutes(minutes)
        locationTracker.pruneRecentLocations(System.currentTimeMillis())
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
        lastAppliedSettings = settings
        applyTelemetryPipelineSettings(settings)
        recordingCoordinator.applySettings(settings)
        socWindow.windowMs = settings.socEstimateWindowSeconds * 1000L
        connectionSoundsEnabled = settings.connectionSoundsEnabled
        alertCoordinator.distanceUnit = settings.distanceUnit
        alertCoordinator.temperatureUnit = settings.temperatureUnit
        alertFeedback.setSoundSettings(settings)
        weatherAlerts.settings = WeatherAlertSettings.of(
            settings.weatherRainAlertLevel,
            settings.weatherWindAlertLevel,
        )
        val coordinator = VescFaultCoordinator.get(service.applicationContext)
        val collectionWasEnabled = coordinator.collectionEnabled
        coordinator.collectionEnabled = settings.vescFaultCollectionEnabled
        VescFaultCaptureCoordinator.get(service.applicationContext)
            .setCollectionEnabled(settings.vescFaultCollectionEnabled)
        if (!collectionWasEnabled && settings.vescFaultCollectionEnabled) {
            liveFaultCode = FAULT_CODE_UNKNOWN
            lastFaultDispatchAtMs = 0L
        }
        val warningsWereEnabled = boardWarningsEnabled
        boardWarningsEnabled = settings.boardWarningsEnabled
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
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
        scheduler.post {
            watchMirror.applySettings(
                settings.toWatchSettings(),
                pollIntervalMsForHz(settings.wearPushRateHz),
                settings.wearAutoLaunchOnConnect,
            )
        }
        boardMoveStrengthPercent = settings.boardMoveStrengthPercent
        val autoCloseDelayChanged = autoCloseDelayMinutes != settings.autoCloseDelayMinutes
        autoCloseEnabled = settings.autoCloseEnabled
        autoCloseDelayMinutes = settings.autoCloseDelayMinutes
        scheduler.post {
            if (autoCloseDelayChanged) {
                autoCloseHandle?.cancel()
                autoCloseHandle = null
            }
            rescheduleAutoClose()
        }
    }

    private fun effectivePollIntervalMs(): Long =
        if (idlePauseDetector.isPaused) maxOf(IDLE_PAUSE_POLL_INTERVAL_MS, configuredPollIntervalMs)
        else configuredPollIntervalMs

    private fun updateIdlePause(capture: TelemetryCapture) {
        if (!recordingCoordinator.telemetryRecordingEnabled) {
            if (idlePauseDetector.isPaused) {
                resetIdlePause()
                emitState()
            }
            return
        }
        val transition = idlePauseDetector.onSample(
            state = capture.state,
        ) ?: return
        if (transition == IdlePauseTransition.Paused) {
            recordingCoordinator.recordIdlePauseMarker(boardConfig)
        }
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
        refreshGpsDemand()
        emitState()
    }

    private fun resetIdlePause() {
        val wasPaused = idlePauseDetector.isPaused
        idlePauseDetector.reset()
        pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
        if (wasPaused) refreshGpsDemand()
    }

    private fun applyTelemetryPipelineSettings(settings: AppSettings) {
        applyLiveHistoryLimitMinutes(settings.liveHistoryLimit)
        telemetryPipeline.metricSanitizerConfig = settings.toMetricSanitizerConfig()
    }

    fun previewAlertSound(spec: String) {
        alertFeedback.preview(spec)
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `previewWeatherAlert` */
    internal fun previewWeatherAlert(line: WeatherAlertLine) {
        alertFeedback.speakVoice(line.voiceAnnouncement())
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
        if (timeout.phase == "gatt_ready") gattHandshakeDeadline.timedOut()
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

// @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `linkIntegrityCheckTimeoutSeconds`
private const val LINK_INTEGRITY_CHECK_TIMEOUT_MS = 20_000L

private const val CONFIG_SAFETY_READ_DELAY_MS = 400L

private fun SessionConfig.linkIdentity(): LinkIdentity =
    LinkIdentity(
        linkVersion = linkVersion,
        hasBms = hasBms,
        firmware = vescFirmwareVersion,
        refloatVersion = refloatVersion,
        refloatBaseVersion = refloatBaseVersion,
    )

/**
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `readPhoneBattery`
 */
internal fun readPhoneBattery(context: Context): Double? {
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
    val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return if (level in 0..100) level / 100.0 else null
}
