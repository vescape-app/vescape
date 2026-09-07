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
 * Poll spacing while the link is still unproven. Each pass is two blocking Play-services round trips,
 * so this is deliberately the only state that pays for them: a rider staring at a dark wrist is
 * waiting on exactly this query, and the wrist shows every pass landing. Once frames are arriving the
 * link is proven by the frames themselves and the poll drops to [PHONE_LINK_SETTLED_REFRESH_MS] — it
 * exists to explain silence, not to narrate success.
 */
private const val PHONE_LINK_REFRESH_MS = 2_000L
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

    @Volatile
    private var ambient = false

    private val listener = CapabilityClient.OnCapabilityChangedListener { info ->
        // The listener is a push, not a poll: it answers instantly and proves nothing about the
        // monitor still running, so it does not count as a probe.
        if (info.nodes.isNotEmpty()) publish(PhoneLink.APP_REACHABLE, probe = false)
    }

    fun start() {
        if (running) return
        running = true
        capabilityClient.addListener(listener, PHONE_APP_CAPABILITY)
        executor.execute(::refreshLoop)
    }

    /**
     * Ambient pays the settled rate whatever the link says. The fast poll exists for a rider looking
     * at a dark screen and watching each pass land; in always-on nothing animates and each pass is
     * still two blocking Play-services round trips. Waking asks again immediately rather than
     * serving the rider a stale answer for the rest of the slow interval.
     */
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
        // Best-effort teardown: start() owns the next listener registration and stopped monitors do
        // not publish, so a Play-services race here cannot change rider-visible state.
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
