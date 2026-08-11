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
    private val isAmbient = mutableStateOf(false)
    private val wakeHeartbeat = Handler(Looper.getMainLooper())
    private val ambientObserver = AmbientLifecycleObserver(this, AmbientCallback())
    private val replayEnabled by lazy {
        ReplayGate.isEnabled(this, intent?.hasExtra("replay") == true)
    }
    private val requestPostNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { isGranted ->
        if (isGranted) ongoingActivityController.start()
    }

    private val listener = MessageClient.OnMessageReceivedListener { event ->
        if (event.path != TELEMETRY_PATH) {
            runOnUiThread { WatchDiagnostics.recordUnknownPath(event.path) }
            return@OnMessageReceivedListener
        }
        val frame = WatchFrameDecoder.decode(event.data)
        runOnUiThread {
            if (frame != null) {
                WatchDiagnostics.recordFrame()
                TelemetryState.acceptFrame(frame, SystemClock.elapsedRealtime())
            } else {
                WatchDiagnostics.recordDecodeFailure(event.data)
            }
        }
    }

    /**
     * Cold phone state arriving on the Data Layer: the route polyline (pushed once per route
     * change, deleted when the route ends — deletion is what hides the drawn line) and the rider's
     * settings (pushed once per settings change).
     */
    private val dataListener = DataClient.OnDataChangedListener { events ->
        for (event in events) {
            val deleted = event.type == DataEvent.TYPE_DELETED
            when (event.dataItem.uri.path) {
                ROUTE_PATH -> {
                    val route = if (deleted) null else WatchRouteDecoder.decode(event.dataItem.data ?: ByteArray(0))
                    runOnUiThread { RouteState.accept(route) }
                }
                SETTINGS_PATH -> {
                    val settings = if (deleted) WatchSettings() else readSettings(event.dataItem)
                    runOnUiThread { SettingsState.accept(settings) }
                }
                WEATHER_PATH -> {
                    val weather = if (deleted) null else readWeather(event.dataItem)
                    runOnUiThread { WeatherState.accept(weather) }
                }
            }
        }
        events.release()
    }

    private fun readSettings(item: DataItem): WatchSettings {
        val dataMap = DataMapItem.fromDataItem(item).dataMap
        return WatchSettings(
            riderColor = parseRiderColor(dataMap.getString(SETTING_RIDER_COLOR)),
            // An older phone never sends the key; `getInt` would read that absence as 0 %.
            boardMoveStrengthPercent = if (dataMap.containsKey(SETTING_BOARD_MOVE_STRENGTH)) {
                dataMap.getInt(SETTING_BOARD_MOVE_STRENGTH)
            } else {
                null
            },
        )
    }

    /**
     * The forecast, or null when the phone sent a payload this build cannot use. Hours ride as
     * parallel arrays, so a truncated set is read to the shortest one rather than trusted blindly.
     */
    private fun readWeather(item: DataItem): WatchWeather? {
        val dataMap = DataMapItem.fromDataItem(item).dataMap
        if (!dataMap.containsKey(WEATHER_TEMP_C)) return null
        val minutes = dataMap.getIntegerArrayList(WEATHER_HOUR_MINUTES) ?: emptyList<Int>()
        val temps = dataMap.getIntegerArrayList(WEATHER_HOUR_TEMPS) ?: emptyList<Int>()
        val icons = dataMap.getStringArray(WEATHER_HOUR_ICONS) ?: emptyArray()
        val precips = dataMap.getIntegerArrayList(WEATHER_HOUR_PRECIPS) ?: emptyList<Int>()
        val hourCount = minOf(minutes.size, temps.size, icons.size, precips.size)
        return WatchWeather(
            temperatureC = dataMap.getInt(WEATHER_TEMP_C),
            icon = dataMap.getString(WEATHER_ICON).orEmpty(),
            label = dataMap.getString(WEATHER_LABEL).orEmpty(),
            precipitationProbability = dataMap.getInt(WEATHER_PRECIP),
            hourly = (0 until hourCount).map { index ->
                WatchWeatherHour(
                    minuteOfDay = minutes[index],
                    temperatureC = temps[index],
                    icon = icons[index],
                    precipitationProbability = precips[index],
                )
            },
            // An older phone never sends the sun keys; `getInt` would read that absence as midnight.
            sunriseMinuteOfDay = if (dataMap.containsKey(WEATHER_SUNRISE)) dataMap.getInt(WEATHER_SUNRISE) else null,
            sunsetMinuteOfDay = if (dataMap.containsKey(WEATHER_SUNSET)) dataMap.getInt(WEATHER_SUNSET) else null,
            fetchedAtMs = dataMap.getLong(WEATHER_FETCHED_AT),
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        setContent {
            MirrorScreen(
                sender = commandSender,
                isAmbient = isAmbient.value,
                onRequestClose = { finishAndRemoveTask() },
            )
        }
        startOngoingActivityWhenAllowed()
    }

    override fun onStart() {
        super.onStart()
        // Fixture replay is opt-in via `bun run wear:replay`; an ordinary emulator mirrors its
        // paired phone exactly like physical Wear OS hardware.
        if (replayEnabled) {
            frameReplayer.start(replayFixture())
            return
        }
        publishWakeLevel()
        messageClient.addListener(listener)
        dataClient.addListener(dataListener)
        // A listener only sees changes, so pick up whatever synced while we were stopped.
        dataClient.dataItems.addOnSuccessListener { items ->
            val route = items.firstOrNull { it.uri.path == ROUTE_PATH }
            RouteState.accept(route?.data?.let(WatchRouteDecoder::decode))
            val settings = items.firstOrNull { it.uri.path == SETTINGS_PATH }
            SettingsState.accept(settings?.let(::readSettings) ?: WatchSettings())
            val weather = items.firstOrNull { it.uri.path == WEATHER_PATH }
            WeatherState.accept(weather?.let(::readWeather))
            items.release()
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
     */
    private fun replayFixture(): String =
        if (intent?.getStringExtra("replay") == "sweep") REPLAY_FIXTURE_SWEEP else REPLAY_FIXTURE_RIDE

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
        commandSender.sendWakeLevel(if (isAmbient.value) WakeLevel.AMBIENT else WakeLevel.ACTIVE)
        wakeHeartbeat.postDelayed(::publishWakeLevel, WAKE_LEVEL_HEARTBEAT_MS)
    }

    private inner class AmbientCallback : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            isAmbient.value = true
            publishWakeLevel()
        }

        override fun onExitAmbient() {
            isAmbient.value = false
            publishWakeLevel()
        }
    }
}
