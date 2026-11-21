package app.vescape.wear

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

private const val PHONE_APP_CAPABILITY = "vescape_phone_app"
private const val PHONE_LINK_REFRESH_MS = 2_000L
private const val PHONE_LINK_SETTLED_REFRESH_MS = 60_000L

/** @parity /watch/watchos/PhoneLink.swift `syncCounterpart` */
class PhoneLinkMonitor(context: Context) {
    private val capabilityClient = Wearable.getCapabilityClient(context)
    private val nodeClient = Wearable.getNodeClient(context)
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var running = false

    @Volatile
    private var nextRefresh: ScheduledFuture<*>? = null

    @Volatile
    private var ambient = false

    private val listener = CapabilityClient.OnCapabilityChangedListener { info ->
        if (info.nodes.isNotEmpty()) publish(PhoneLink.APP_REACHABLE, probe = false)
    }

    fun start() {
        if (running) return
        running = true
        capabilityClient.addListener(listener, PHONE_APP_CAPABILITY)
        executor.execute(::refreshLoop)
    }

    fun setAmbient(active: Boolean) {
        if (ambient == active) return
        ambient = active
        if (active || !running) return
        nextRefresh?.cancel(false)
        nextRefresh = null
        executor.execute(::refreshLoop)
    }

    fun stop() {
        running = false
        nextRefresh?.cancel(false)
        nextRefresh = null
        // intentional-suppression: listener teardown is best effort
        runCatching { capabilityClient.removeListener(listener, PHONE_APP_CAPABILITY) }
    }

    fun shutdown() {
        stop()
        executor.shutdownNow()
    }

    private fun refreshLoop() {
        if (!running) return
        val capable = try {
            Tasks.await(capabilityClient.getCapability(PHONE_APP_CAPABILITY, CapabilityClient.FILTER_REACHABLE)).nodes
        } catch (_: Exception) {
            publishProbeFailure()
            scheduleNext()
            return
        }
        val nodes = try {
            Tasks.await(nodeClient.connectedNodes)
        } catch (_: Exception) {
            publishProbeFailure()
            scheduleNext()
            return
        }
        publish(
            when {
                capable.isNotEmpty() -> PhoneLink.APP_REACHABLE
                nodes.isNotEmpty() -> PhoneLink.PHONE_ONLY
                else -> PhoneLink.NO_PHONE
            },
            probe = true,
        )
        scheduleNext()
    }

    private fun scheduleNext() {
        if (running) {
            val settled = ambient || TelemetryState.mirrorState.value.status == MirrorStatus.LIVE
            val delayMs = if (settled) PHONE_LINK_SETTLED_REFRESH_MS else PHONE_LINK_REFRESH_MS
            nextRefresh = executor.schedule(::refreshLoop, delayMs, TimeUnit.MILLISECONDS)
        }
    }

    private fun publishProbeFailure() {
        mainHandler.post { if (running) WatchDiagnostics.recordLinkProbeFailure() }
    }

    private fun publish(link: PhoneLink, probe: Boolean) {
        mainHandler.post {
            if (!running) return@post
            WatchDiagnostics.recordLinkChange(link)
            TelemetryState.phoneLink.value = link
            if (probe) TelemetryState.recordLinkProbe()
        }
    }
}
