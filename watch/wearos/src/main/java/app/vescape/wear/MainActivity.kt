package app.vescape.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.wear.ambient.AmbientLifecycleObserver
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.watch.WATCH_GROUP_RIDE_PATH
import expo.modules.vescapecore.watch.WATCH_ROUTE_STATUS_PATH

/**
 * Wear OS Mirror entry point. Renders the live [WatchFrame] pushed from the phone over
 * [MessageClient] on [TELEMETRY_PATH] while the screen is on. Reception only runs while the
 * activity is resumed — the background-survivable transport lives on the phone side.
 */
class MainActivity : ComponentActivity() {
    private val messageClient by lazy { Wearable.getMessageClient(this) }
    private val dataClient by lazy { Wearable.getDataClient(this) }
    private val phoneLinkMonitor by lazy { PhoneLinkMonitor(this) }
    private val frameReplayer by lazy { FrameReplayer(this) }
    private val ongoingActivityController by lazy { OngoingActivityController(this) }
    private val commandSender by lazy { CommandSender(this) }
    private val ambient = mutableStateOf(AmbientOff)
    private val wakeHeartbeat = Handler(Looper.getMainLooper())
    private val ambientObserver = AmbientLifecycleObserver(this, AmbientCallback())
    private val replayEnabled by lazy {
        DevGate.isEnabled(this, intent?.hasExtra("replay") == true)
    }
    private val requestPostNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { isGranted ->
        if (isGranted) ongoingActivityController.start()
    }

    /**
     * Telemetry and Group Ride Frames share this listener; watchOS takes the Group Ride branch in its
     * own message handler.
     *
     * @parity /watch/watchos/PhoneLink.swift `session(_:didReceiveMessage:)`
     */
    private val listener = MessageClient.OnMessageReceivedListener { event ->
        // Capture arrival before dispatch: a busy UI must not make old frames appear fresh.
        val receivedAtMs = SystemClock.elapsedRealtime()
        val bytes = event.data
        runOnUiThread {
            when (event.path) {
                TELEMETRY_PATH -> MirrorIntakeState.acceptTelemetry(bytes, receivedAtMs, SystemClock.elapsedRealtime())
                WATCH_GROUP_RIDE_PATH -> MirrorIntakeState.apply { acceptGroupRide(bytes, receivedAtMs) }
                WATCH_ROUTE_STATUS_PATH -> MirrorIntakeState.apply { acceptRouteStatus(bytes) }
                else -> WatchDiagnostics.recordUnknownPath(event.path)
            }
        }
    }

    /** Incremental cold updates retain other channels; deletion resets just this channel. */
    private val dataListener = DataClient.OnDataChangedListener { events ->
        try {
            for (event in events) {
                val item = event.dataItem
                val path = item.uri.path
                val deleted = event.type == DataEvent.TYPE_DELETED
                val bytes = if (!deleted && path == ROUTE_PATH) item.data else null
                val payload = if (!deleted && path in setOf(SETTINGS_PATH, WEATHER_PATH, BOARD_PATH)) dataMapOf(item) else null
                runOnUiThread {
                    MirrorIntakeState.apply {
                        when (path) {
                            ROUTE_PATH -> acceptRoute(bytes)
                            SETTINGS_PATH -> acceptSettings(payload)
                            WEATHER_PATH -> acceptWeather(payload)
                            BOARD_PATH -> acceptBoard(payload)
                        }
                    }
                }
            }
        } finally {
            events.release()
        }
    }

    private fun dataMapOf(item: DataItem): Map<String, Any?> {
        val dataMap = DataMapItem.fromDataItem(item).dataMap
        return dataMap.keySet().associateWith { dataMap.get<Any>(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        setContent {
            MirrorScreen(
                sender = commandSender,
                ambient = ambient.value,
                onRequestClose = { finishAndRemoveTask() },
            )
        }
        forceAmbientWhenRequested()
        startOngoingActivityWhenAllowed()
    }

    /** @parity /watch/watchos/VescapeWatchApp.swift `VescapeWatchApp` */
    override fun onStart() {
        super.onStart()
        // Fixture replay is opt-in via `bun run wear:replay`; an ordinary emulator mirrors its
        // paired phone exactly like physical Wear OS hardware.
        if (replayEnabled) {
            MirrorIntakeState.apply {
                acceptSettings(mapOf(SETTING_TELEMETRY_TRAIL to (intent?.getBooleanExtra("telemetryTrail", true) != false)))
            }
            commandSender.replayTiltEcho = frameReplayer::echoTilt
            frameReplayer.start(
                replayFixture(), group = replayGroup(),
                navigation = intent?.getBooleanExtra("navigation", true) != false,
                routeLoading = intent?.getBooleanExtra("route-loading", false) == true,
                wander = intent?.getBooleanExtra("wander", false) == true,
            )
            return
        }
        publishWakeLevel()
        messageClient.addListener(listener)
        dataClient.addListener(dataListener)
        // A listener only sees changes, so pick up whatever synced while we were stopped.
        dataClient.dataItems.addOnSuccessListener { items ->
            try {
                val route = items.firstOrNull { it.uri.path == ROUTE_PATH }?.data
                val settings = items.firstOrNull { it.uri.path == SETTINGS_PATH }?.let(::dataMapOf)
                val weather = items.firstOrNull { it.uri.path == WEATHER_PATH }?.let(::dataMapOf)
                val board = items.firstOrNull { it.uri.path == BOARD_PATH }?.let(::dataMapOf)
                MirrorIntakeState.apply { restoreColdState(route, settings, weather, board) }
            } finally {
                items.release()
            }
        }
        phoneLinkMonitor.start()
        WatchDiagnostics.recordReceiver(active = true)
    }

    override fun onStop() {
        if (replayEnabled) {
            frameReplayer.stop()
            super.onStop()
            return
        }
        WatchDiagnostics.recordReceiver(active = false)
        // Stop the stream before the listeners go: an unheard 4 Hz push is the wrist's, and the
        // phone's, single biggest avoidable drain. The phone's dead-man covers a lost stop.
        wakeHeartbeat.removeCallbacksAndMessages(null)
        commandSender.sendWakeLevel(WakeLevel.ASLEEP)
        phoneLinkMonitor.stop()
        dataClient.removeListener(dataListener)
        messageClient.removeListener(listener)
        super.onStop()
    }

    /**
     * Which fixture the emulator replays. Defaults to the recorded ride; the lane sweep is reachable
     * without a rebuild:
     * `adb shell am start -S -n <pkg>/app.vescape.wear.MainActivity --es replay sweep`
     * (`-S` because a running instance keeps its original intent).
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.requestedFixture`
     */
    private fun replayFixture(): String =
        if (intent?.getStringExtra("replay") == "sweep") REPLAY_FIXTURE_SWEEP else REPLAY_FIXTURE_RIDE

    /**
     * `--ez group true` beside `--es replay`: also replay a joined Group Ride.
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.requestedGroup`
     */
    private fun replayGroup(): Boolean = intent?.getBooleanExtra("group", false) == true

    /**
     * Emulator-only: render as if the watch were in ambient, without asking the emulator to actually
     * go always-on. The real path stays the only one on hardware — this exists because iterating on
     * the always-on layout otherwise means power-cycling the screen between every screenshot.
     *
     * `adb shell am start -S -n <pkg>/app.vescape.wear.MainActivity --ez ambient true`
     * (`-S` because a running instance keeps its original intent). Combines with `--es replay`, so
     * the ambient layout can be watched against a recorded ride or the full lane sweep. The panel
     * flags are the pessimistic pair: whatever survives here survives a real low-bit, burn-in screen.
     */
    private fun forceAmbientWhenRequested() {
        if (!DevGate.isEnabled(this, intent?.getBooleanExtra("ambient", false) == true)) return
        ambient.value = AmbientMode(
            active = true,
            lowBit = intent?.getBooleanExtra("lowBit", false) == true,
            burnInProtection = intent?.getBooleanExtra("burnIn", false) == true,
        )
    }

    override fun onDestroy() {
        lifecycle.removeObserver(ambientObserver)
        wakeHeartbeat.removeCallbacksAndMessages(null)
        phoneLinkMonitor.shutdown()
        ongoingActivityController.stop()
        super.onDestroy()
        // After super: composition disposal runs there, and MoveScreen's dispose sends its stop.
        commandSender.shutdown()
    }

    private fun startOngoingActivityWhenAllowed() {
        if (ongoingActivityController.canPostNotifications()) {
            ongoingActivityController.start()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPostNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /**
     * Re-states the current [WakeLevel] to the phone on a heartbeat, so the phone pushes frames only
     * while the Mirror is actually on a wrist, at a cadence matching what the wrist can show.
     */
    private fun publishWakeLevel() {
        wakeHeartbeat.removeCallbacksAndMessages(null)
        if (replayEnabled) return
        commandSender.sendWakeLevel(if (ambient.value.active) WakeLevel.AMBIENT else WakeLevel.ACTIVE)
        wakeHeartbeat.postDelayed(::publishWakeLevel, WAKE_LEVEL_HEARTBEAT_MS)
    }

    private inner class AmbientCallback : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            // The panel's own limits, not assumptions: a screen that cannot hold a colour palette
            // and one that needs its pixels moved are both rendered for, and neither is guessed at.
            ambient.value = AmbientMode(
                active = true,
                lowBit = ambientDetails.deviceHasLowBitAmbient,
                burnInProtection = ambientDetails.burnInProtectionRequired,
            )
            phoneLinkMonitor.setAmbient(true)
            publishWakeLevel()
        }

        override fun onExitAmbient() {
            ambient.value = AmbientOff
            phoneLinkMonitor.setAmbient(false)
            publishWakeLevel()
        }
    }
}
