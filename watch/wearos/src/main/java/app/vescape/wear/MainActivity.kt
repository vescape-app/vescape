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
import com.google.android.gms.wearable.DataItemAsset
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.tasks.Tasks
import expo.modules.vescapecore.watch.WATCH_MAP_TILE_ASSET
import expo.modules.vescapecore.watch.WatchMapTile
import expo.modules.vescapecore.watch.WATCH_GROUP_RIDE_PATH
import expo.modules.vescapecore.watch.WATCH_RIDE_NOTICES_PATH
import expo.modules.vescapecore.watch.WATCH_ROUTE_STATUS_PATH
import java.util.concurrent.TimeUnit

private const val MAP_TILE_READ_TIMEOUT_S = 10L

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
     * @parity /watch/watchos/PhoneLink.swift `session(_:didReceiveMessage:)`
     */
    private val listener = MessageClient.OnMessageReceivedListener { event ->
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

    private val dataListener = DataClient.OnDataChangedListener { events ->
        try {
            for (event in events) {
                val item = event.dataItem
                val path = item.uri.path
                val deleted = event.type == DataEvent.TYPE_DELETED
                val mapTile = path?.let(WatchMapTile::fromPath)?.second
                if (mapTile != null) {
                    val load = if (deleted) null else mapTileLoader(item)
                    runOnUiThread { if (load == null) MapTileState.remove(mapTile) else MapTileState.put(mapTile, load) }
                    continue
                }
                val battery = if (!deleted && path == LAST_BATTERY_PATH) decodeLastBatteryItem(item) else null
                val bytes = if (!deleted && (path == ROUTE_PATH || path == WATCH_RIDE_NOTICES_PATH)) item.data else null
                val payload = if (!deleted && path in setOf(SETTINGS_PATH, WEATHER_PATH, BOARD_PATH)) dataMapOf(item) else null
                if (path == WATCH_RIDE_NOTICES_PATH) {
                    runOnUiThread { MirrorIntakeState.acceptRideNotices { acceptRideNotices(bytes) } }
                    continue
                }
                runOnUiThread {
                    MirrorIntakeState.apply {
                        when (path) {
                            ROUTE_PATH -> acceptRoute(bytes)
                            SETTINGS_PATH -> acceptSettings(payload)
                            WEATHER_PATH -> acceptWeather(payload)
                            BOARD_PATH -> acceptBoard(payload)
                            LAST_BATTERY_PATH -> LastBatteryState.battery.value = battery
                        }
                    }
                }
            }
        } finally {
            events.release()
        }
    }

    private fun mapTileLoader(item: DataItem): (() -> ByteArray?)? {
        val asset: DataItemAsset = item.assets[WATCH_MAP_TILE_ASSET]?.freeze() ?: return null
        return { Tasks.await(dataClient.getFdForAsset(asset), MAP_TILE_READ_TIMEOUT_S, TimeUnit.SECONDS).inputStream.use { it.readBytes() } }
    }

    private fun dataMapOf(item: DataItem): Map<String, Any?> {
        val dataMap = DataMapItem.fromDataItem(item).dataMap
        return dataMap.keySet().associateWith { dataMap.get<Any>(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        RideNoticeState.attach(this)
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
                fromMs = replayFromMs(),
            )
            return
        }
        publishWakeLevel()
        messageClient.addListener(listener)
        dataClient.addListener(dataListener)
        dataClient.dataItems.addOnSuccessListener { items ->
            try {
                val route = items.firstOrNull { it.uri.path == ROUTE_PATH }?.data
                val settings = items.firstOrNull { it.uri.path == SETTINGS_PATH }?.let(::dataMapOf)
                val weather = items.firstOrNull { it.uri.path == WEATHER_PATH }?.let(::dataMapOf)
                val board = items.firstOrNull { it.uri.path == BOARD_PATH }?.let(::dataMapOf)
                val rideNotices = items.firstOrNull { it.uri.path == WATCH_RIDE_NOTICES_PATH }?.data
                MirrorIntakeState.acceptRideNotices { restoreColdState(route, settings, weather, board, rideNotices) }
                LastBatteryState.battery.value = items.firstOrNull { it.uri.path == LAST_BATTERY_PATH }?.let(::decodeLastBatteryItem)
                MapTileState.replace(
                    items.mapNotNull { item ->
                        val tile = item.uri.path?.let(WatchMapTile::fromPath)?.second ?: return@mapNotNull null
                        mapTileLoader(item)?.let { tile to it }
                    }.toMap(),
                )
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
        wakeHeartbeat.removeCallbacksAndMessages(null)
        commandSender.sendWakeLevel(WakeLevel.ASLEEP)
        phoneLinkMonitor.stop()
        dataClient.removeListener(dataListener)
        messageClient.removeListener(listener)
        super.onStop()
    }

    /**
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.requestedFixture`
     */
    private fun replayFixture(): String = when (intent?.getStringExtra("replay")) {
        "sweep" -> REPLAY_FIXTURE_SWEEP
        // TODO(iOS parity): watchOS has no preview fixture or `replayFrom`; only Android takes film a watch.
        "preview" -> REPLAY_FIXTURE_PREVIEW
        else -> REPLAY_FIXTURE_RIDE
    }

    private fun replayFromMs(): Long {
        val epoch = intent?.getLongExtra("replayEpoch", 0L) ?: 0L
        return if (epoch > 0L) (System.currentTimeMillis() - epoch).coerceAtLeast(0L) else 0L
    }

    /**
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.requestedGroup`
     */
    private fun replayGroup(): Boolean = intent?.getBooleanExtra("group", false) == true

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

    private fun publishWakeLevel() {
        wakeHeartbeat.removeCallbacksAndMessages(null)
        if (replayEnabled) return
        commandSender.sendWakeLevel(if (ambient.value.active) WakeLevel.AMBIENT else WakeLevel.ACTIVE)
        wakeHeartbeat.postDelayed(::publishWakeLevel, WAKE_LEVEL_HEARTBEAT_MS)
    }

    private inner class AmbientCallback : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
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
