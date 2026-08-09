package expo.modules.vescapecore.connection

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Handler
import android.util.Log
import expo.modules.vescapecore.RemoteTiltPhase
import expo.modules.vescapecore.VescLiveStateSnapshot
import expo.modules.vescapecore.alerts.AlertCoordinator
import expo.modules.vescapecore.alerts.AlertFeedback
import expo.modules.vescapecore.buildLiveState
import expo.modules.vescapecore.ow.OwFrame
import expo.modules.vescapecore.ow.OwGattClient
import expo.modules.vescapecore.ow.OwPhase
import expo.modules.vescapecore.ow.toRefloatTelemetry
import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.protocol.toCapture
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.HandlerScheduler
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.LiveSeriesEmitter
import expo.modules.vescapecore.telemetry.TelemetryPipeline
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

private const val TAG = "OwSession"
private const val HISTORY_FLUSH_INTERVAL_MS = 300L
private const val LIVE_SERIES_INTERVAL_MS = 1_000L
private const val LIVE_SERIES_BUCKETS = 64
private const val RECONNECT_MAX_DELAY_MS = 5_000L
// Original OneWheel telemetry is change-driven and can be silent while stationary. Its 15-second
// firmware keepalive is also transport activity, so allow one keepalive plus BLE scheduling slack.
private const val TRANSPORT_STALE_MS = 20_000L

/**
 * OneWheel Board Session: owns the GATT client, the firmware-lock handshake outcome, and the
 * mapping of OneWheel channels onto the shared telemetry pipeline — so live gauges, charts,
 * recording, and alerts all run unchanged. Deliberately a sibling of [BoardSessionController],
 * not a branch inside it; the service branches here once, at session start.
 *
 * TODO(iOS parity): OneWheel sessions are Android-only for now.
 */
@SuppressLint("MissingPermission") // permissions are requested at the JS/RN layer
internal class OwSessionController(
  private val context: Context,
  private val handler: Handler,
) {
  private val scheduler = HandlerScheduler(handler)

  private var session: BoardSession? = null
  private var config: SessionConfig? = null
  private var client: OwGattClient? = null
  private var boardPhase = BoardPhase.Idle
  private var boardError: String? = null
  private var reconnectAttempts = 0
  private var reconnectHandle: Cancellable? = null
  private var staleHandle: Cancellable? = null

  val isActive: Boolean
    get() = session != null && boardPhase != BoardPhase.Idle && boardPhase != BoardPhase.Error

  private val btAdapter: BluetoothAdapter
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

  private val pipeline = TelemetryPipeline(
    scheduler = scheduler,
    // OW characteristics are independent. Connection freshness is driven by any characteristic
    // below, while only RPM clocks coherent telemetry frames.
    onTelemetryStale = {},
    captureBuilder = RefloatTelemetry::toCapture,
  )

  private val liveSeriesEmitter = LiveSeriesEmitter(
    scheduler = scheduler,
    emitEvent = ::emitEvent,
    telemetryPipeline = pipeline,
    session = { session },
    isCurrentSession = { it === session },
    generation = { session?.id ?: 0L },
    historyFlushIntervalMs = HISTORY_FLUSH_INTERVAL_MS,
    liveSeriesIntervalMs = LIVE_SERIES_INTERVAL_MS,
    liveSeriesBuckets = LIVE_SERIES_BUCKETS,
  )

  private val recordingCoordinator by lazy {
    RecordingCoordinator(context = context, applyLiveSettings = {})
  }

  // Alert feedback owns a SoundPool/TTS — fresh per session, released on stop.
  private var alertFeedback: AlertFeedback? = null
  private var alertCoordinator: AlertCoordinator? = null

  fun start(config: SessionConfig) {
    stopInternal(emitDisconnected = false)
    val deviceId = config.deviceId
    if (deviceId.isNullOrBlank()) {
      boardError = "OneWheel board has no BLE id"
      transitionPhase(BoardPhase.Error)
      return
    }
    val newSession = BoardSession(System.currentTimeMillis())
    session = newSession
    this.config = config
    boardError = null
    reconnectAttempts = 0
    val feedback = AlertFeedback(context, handler)
    alertFeedback = feedback
    alertCoordinator = AlertCoordinator(feedback = { feedback })
    pipeline.beginSession(newSession, config)
    recordingCoordinator.beginBoardSession(config)
    loadAlertRules(config.appBoardId)
    transitionPhase(BoardPhase.Connecting)
    connectToDevice(deviceId)
  }

  fun stop(emitDisconnected: Boolean) = stopInternal(emitDisconnected)

  private fun stopInternal(emitDisconnected: Boolean) {
    reconnectHandle?.cancel()
    reconnectHandle = null
    staleHandle?.cancel()
    staleHandle = null
    client?.clear()
    client = null
    val stoppedConfig = config
    if (stoppedConfig != null) {
      recordingCoordinator.finishBoardSession(
        status = if (emitDisconnected) "disconnected" else "stopped",
        markerType = if (emitDisconnected) "disconnected" else "app_stop",
        config = stoppedConfig,
      )
    }
    alertCoordinator?.stopAllGeiger()
    alertFeedback?.release()
    alertCoordinator = null
    alertFeedback = null
    pipeline.endSession()
    liveSeriesEmitter.stop()
    session?.invalidate()
    session = null
    config = null
    boardError = null
    transitionPhase(BoardPhase.Idle)
  }

  // --- client wiring ----------------------------------------------------------

  private fun connectToDevice(deviceId: String) {
    val currentSession = session ?: return
    val owClient = OwGattClient(
      context = context,
      handler = handler,
      device = btAdapter.getRemoteDevice(deviceId),
      listener = object : OwGattClient.Listener {
        override fun onState(state: Map<String, Any?>) {
          // PoC/JS raw channel — a full Board Session does not re-emit it.
        }

        override fun onCharacteristic(payload: Map<String, Any?>) {
          handleClientActivity(currentSession)
        }

        override fun onPhase(phase: OwPhase, message: String?) {
          handleClientPhase(currentSession, phase, message)
        }

        override fun onTransportActivity() {
          handleClientActivity(currentSession)
        }
      },
    )
    owClient.frameListener = { frame ->
      if (session === currentSession) handleFrame(currentSession, frame)
    }
    client = owClient
    owClient.connect()
  }

  private fun handleClientPhase(currentSession: BoardSession, phase: OwPhase, message: String?) {
    if (session !== currentSession) return
    when (phase) {
      OwPhase.Connecting, OwPhase.Unlocking -> transitionPhase(BoardPhase.Connecting)
      OwPhase.Ready -> transitionPhase(BoardPhase.WaitingForTelemetry)
      OwPhase.Locked -> {
        // Locked boards need a jumpstart through the official app; retrying won't help.
        boardError = message ?: "Board locked — jumpstart it with the official Onewheel app"
        client?.clear()
        client = null
        transitionPhase(BoardPhase.Error)
      }
      OwPhase.Error -> {
        boardError = message ?: "OneWheel connection failed"
        transitionPhase(BoardPhase.Error)
        // Handshake/connect failures require the official app preparation flow. Stay stopped and
        // let the rider explicitly retry from the explanatory home-screen action.
        client?.clear()
        client = null
      }
      OwPhase.Disconnected -> {
        if (boardPhase != BoardPhase.Idle) scheduleReconnect()
      }
    }
  }

  private fun scheduleReconnect() {
    val cfg = config ?: return
    val deviceId = cfg.deviceId ?: return
    if (!cfg.autoReconnect || session == null) return
    reconnectHandle?.cancel()
    reconnectAttempts += 1
    val delayMs = (500L * reconnectAttempts).coerceAtMost(RECONNECT_MAX_DELAY_MS)
    Log.d(TAG, "reconnect attempt $reconnectAttempts in ${delayMs}ms")
    transitionPhase(BoardPhase.Reconnecting)
    reconnectHandle = scheduler.postDelayed(delayMs) {
      reconnectHandle = null
      if (session != null) connectToDevice(deviceId)
    }
  }

  private fun handleClientActivity(currentSession: BoardSession) {
    if (session !== currentSession) return
    when (boardPhase) {
      BoardPhase.WaitingForTelemetry, BoardPhase.Connected, BoardPhase.Stale -> Unit
      else -> return
    }
    staleHandle?.cancel()
    staleHandle = scheduler.postDelayed(TRANSPORT_STALE_MS) {
      staleHandle = null
      if (session === currentSession) transitionPhase(BoardPhase.Stale)
    }
  }

  // --- telemetry ----------------------------------------------------------------

  private fun handleFrame(currentSession: BoardSession, frame: OwFrame) {
    val cfg = config ?: return
    val parsed = frame.toRefloatTelemetry()
    val processed = pipeline.process(parsed, currentSession) ?: return
    if (boardPhase != BoardPhase.Connected) {
      transitionPhase(BoardPhase.Connected)
      recordingCoordinator.markBoardReady(cfg)
    }
    val batteryPercent = frame.batteryPercent?.toDouble()
    val firedAlerts = alertCoordinator?.evaluate(parsed, batteryPercent) { _, _ -> } ?: emptyList()
    // OW supplies real SoC directly. Put it on the shared processed row before history/live-series
    // consumers see it, matching the VESC path's estimated battery percentage plumbing.
    val eventMap = processed.eventMap
    eventMap["batteryPercent"] = batteryPercent
    val tick = parsed.toMap().toMutableMap()
    tick.remove("location")
    tick["batteryPercent"] = batteryPercent
    tick["generation"] = currentSession.id
    if (firedAlerts.isNotEmpty()) tick["firedAlerts"] = firedAlerts
    emitEvent("onLiveTick", tick)
    liveSeriesEmitter.enqueueHistorySample(eventMap)
    liveSeriesEmitter.primeLiveSeriesIfNeeded()
    recordingCoordinator.recordTelemetry(processed.capture)
  }

  // --- state --------------------------------------------------------------------

  fun liveStateMap(includeRecent: Boolean): Map<String, Any?> {
    val settings = runBlocking { AppDataRepository.get(context).getTypedSettings() }
    return buildLiveState(
      VescLiveStateSnapshot(
        boardPhase = boardPhase,
        boardConfig = config,
        boardError = boardError,
        connectionSeq = session?.id ?: 0L,
        lastTelemetryAt = pipeline.lastTelemetryAt.takeIf { it > 0L },
        recentTelemetry = if (includeRecent) pipeline.recentSnapshot() else emptyList(),
        // GPS stays VESC-session-owned for now; OneWheel rides record without location.
        gpsActive = false,
        latestLocation = null,
        latestPreciseLocation = null,
        recentLocations = emptyList(),
        gpsError = null,
        recordingEnabled = recordingCoordinator.telemetryRecordingEnabled,
        recordingPaused = false,
        remoteTiltValue = 0,
        remoteTiltPhase = RemoteTiltPhase.Idle,
        remoteTiltDecay = null,
        linkIntegrity = LinkIntegrity.Unknown,
        settings = settings,
      ),
    )
  }

  fun reloadAlertRules() {
    loadAlertRules(config?.appBoardId)
  }

  fun setTelemetryRecordingEnabled(enabled: Boolean) {
    val cfg = config
    if (enabled && cfg != null && boardPhase == BoardPhase.Connected) {
      recordingCoordinator.enableTelemetryRecording(cfg)
    } else if (!enabled) {
      recordingCoordinator.disableTelemetryRecording(cfg)
    } else {
      emitEvent("onError", mapOf("message" to "Recording requires a connected board"))
    }
    emitEvent("onLiveState", liveStateMap(includeRecent = false))
  }

  private fun loadAlertRules(boardId: String?) {
    val coordinator = alertCoordinator
    if (boardId == null || coordinator == null) {
      coordinator?.replaceRules(emptyList())
      return
    }
    CoreForegroundService.appDataScope.launch {
      val rules = AppDataRepository.get(context).getEnabledAlertRuleEntities(boardId)
      handler.post { alertCoordinator?.replaceRules(rules) }
    }
  }

  private fun transitionPhase(next: BoardPhase) {
    if (boardPhase == next) return
    boardPhase = next
    if (next == BoardPhase.Connected) liveSeriesEmitter.start()
    emitEvent("onLiveState", liveStateMap(includeRecent = false))
  }

  private fun emitEvent(name: String, body: Map<String, Any?>) {
    CoreForegroundService.emitEvent?.invoke(name, body)
  }
}
