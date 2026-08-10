package app.vescape.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.wear.ambient.AmbientLifecycleObserver
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
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
    private val isAmbient = mutableStateOf(false)
    private val ambientObserver = AmbientLifecycleObserver(this, AmbientCallback())
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
     * Route polyline arriving on the Data Layer: pushed once per route change, deleted when the
     * route ends. Deletion clears the wrist route, which is what hides the drawn line.
     */
    private val routeListener = DataClient.OnDataChangedListener { events ->
        for (event in events) {
            if (event.dataItem.uri.path != ROUTE_PATH) continue
            val route = when (event.type) {
                DataEvent.TYPE_DELETED -> null
                else -> WatchRouteDecoder.decode(event.dataItem.data ?: ByteArray(0))
            }
            runOnUiThread { RouteState.accept(route) }
        }
        events.release()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        setContent {
            MirrorScreen(
                isAmbient = isAmbient.value,
                onKeepScreenAwakeChanged = ::setKeepScreenAwake,
                onRequestClose = { finishAndRemoveTask() },
            )
        }
        startOngoingActivityWhenAllowed()
    }

    override fun onStart() {
        super.onStart()
        // An emulator has no phone to mirror, so replayed frames stand in for the real push there.
        if (ReplayGate.isEnabled(this)) {
            frameReplayer.start(replayFixture())
            return
        }
        messageClient.addListener(listener)
        dataClient.addListener(routeListener)
        // A listener only sees changes, so pick up a route that synced while we were stopped.
        dataClient.dataItems.addOnSuccessListener { items ->
            val item = items.firstOrNull { it.uri.path == ROUTE_PATH }
            RouteState.accept(item?.data?.let(WatchRouteDecoder::decode))
            items.release()
        }
        phoneLinkMonitor.start()
        WatchDiagnostics.recordReceiver(active = true)
    }

    override fun onStop() {
        if (ReplayGate.isEnabled(this)) {
            frameReplayer.stop()
            super.onStop()
            return
        }
        WatchDiagnostics.recordReceiver(active = false)
        phoneLinkMonitor.stop()
        dataClient.removeListener(routeListener)
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
        setKeepScreenAwake(false)
        phoneLinkMonitor.shutdown()
        ongoingActivityController.stop()
        super.onDestroy()
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

    private fun setKeepScreenAwake(keepAwake: Boolean) {
        if (keepAwake) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private inner class AmbientCallback : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            isAmbient.value = true
        }

        override fun onExitAmbient() {
            isAmbient.value = false
        }
    }
}
