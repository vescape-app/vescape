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

/** Capability the Vescape phone app advertises (vescape-core res/values/wear.xml). Keep the two in sync. */
private const val PHONE_APP_CAPABILITY = "vescape_phone_app"
/**
 * Poll spacing while the link is still unproven. Each pass is two blocking Play-services round
 * trips, so once frames are arriving the link is proven by the frames themselves and the poll
 * drops to [PHONE_LINK_SETTLED_REFRESH_MS] — it exists to explain silence, not to narrate success.
 */
private const val PHONE_LINK_REFRESH_MS = 5_000L
private const val PHONE_LINK_SETTLED_REFRESH_MS = 60_000L

/**
 * Derives the [PhoneLink] shown while no frames arrive: a capability listener for the instant
 * positive plus a slow periodic query of connected nodes, so the wrist can say "no phone link" vs
 * "phone app missing" vs "connected, waiting" instead of an anonymous spinner. Watch-local reads
 * only — the Mirror still sends nothing to the phone (ADR-0019).
 */
class PhoneLinkMonitor(context: Context) {
    private val capabilityClient = Wearable.getCapabilityClient(context)
    private val nodeClient = Wearable.getNodeClient(context)
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var running = false

    @Volatile
    private var nextRefresh: ScheduledFuture<*>? = null

    private val listener = CapabilityClient.OnCapabilityChangedListener { info ->
        if (info.nodes.isNotEmpty()) publish(PhoneLink.APP_REACHABLE)
    }

    fun start() {
        if (running) return
        running = true
        capabilityClient.addListener(listener, PHONE_APP_CAPABILITY)
        executor.execute(::refreshLoop)
    }

    fun stop() {
        running = false
        nextRefresh?.cancel(false)
        nextRefresh = null
        runCatching { capabilityClient.removeListener(listener, PHONE_APP_CAPABILITY) }
    }

    fun shutdown() {
        stop()
        executor.shutdownNow()
    }

    private fun refreshLoop() {
        if (!running) return
        val capable = runCatching {
            Tasks.await(capabilityClient.getCapability(PHONE_APP_CAPABILITY, CapabilityClient.FILTER_REACHABLE))
        }.getOrNull()?.nodes.orEmpty()
        val nodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull().orEmpty()
        publish(
            when {
                capable.isNotEmpty() -> PhoneLink.APP_REACHABLE
                nodes.isNotEmpty() -> PhoneLink.PHONE_ONLY
                else -> PhoneLink.NO_PHONE
            },
        )
        if (running) {
            val settled = TelemetryState.mirrorState.value.status == MirrorStatus.LIVE
            val delayMs = if (settled) PHONE_LINK_SETTLED_REFRESH_MS else PHONE_LINK_REFRESH_MS
            nextRefresh = executor.schedule(::refreshLoop, delayMs, TimeUnit.MILLISECONDS)
        }
    }

    private fun publish(link: PhoneLink) {
        mainHandler.post {
            if (!running) return@post
            WatchDiagnostics.recordLinkChange(link)
            TelemetryState.phoneLink.value = link
        }
    }
}
