package expo.modules.vescapecore.watch

import expo.modules.vescapecore.BuildConfig

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Wear capability our Mirror app declares (watch/wearos res/values/wear.xml). Keep the two in sync. */
internal const val WATCH_MIRROR_CAPABILITY = "vescape_watch_mirror"

/**
 * Declared only by wrist builds that report a [WatchMirrorWakeLevel]. Phone and watch ship as
 * separate Play tracks and update independently, so the wake gate has to be opt-in per wrist build:
 * without this, a phone that updated first would gate on a level an older wrist never sends and
 * leave its Mirror permanently blank. Delete once the minimum supported wrist build sends one.
 */
internal const val WATCH_MIRROR_WAKE_CAPABILITY = "vescape_watch_mirror_wake"

/**
 * Re-query cadence: a quick burst right after session start (the window where the watch link is
 * most likely still settling), then a slow steady heartbeat. The CapabilityClient listener stays
 * the instant path; this only backstops missed events.
 */
private val PRESENCE_REFRESH_BURST_MS = longArrayOf(1_000L, 2_000L, 5_000L)
private const val PRESENCE_REFRESH_STEADY_MS = 15_000L

/**
 * Tracks whether a reachable Wear node actually runs our Watch Mirror, gating the phone push (ADR-0019).
 * A *paired* watch is not enough — only a declared [CapabilityClient] capability proves our app is
 * installed and connected, so we never burn Bluetooth/battery pushing frames into the void.
 *
 * Reactive like [CompanionPresence] (note: that one tracks a CompanionDeviceManager BLE device —
 * unrelated concept, do not conflate): a [CapabilityClient] listener gives the instant positive, and a
 * slow periodic re-query keeps the cached [present] flag honest — a watch whose Bluetooth link was
 * down at session start must start receiving frames once it comes back, not stay dark all session.
 * The watch tick reads [present] each tick; it never does an async lookup.
 *
 * [record] feeds the in-app diagnostic event log: one baseline event per session start plus every
 * transition, each with the raw connected-node count so "no watch at all" and "watch linked but
 * Mirror app missing" are distinguishable in the field without watch access.
 */
internal class WatchMirrorPresence(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val capabilityClient by lazy { Wearable.getCapabilityClient(context) }
    private val nodeClient by lazy { Wearable.getNodeClient(context) }

    @Volatile
    var present: Boolean = false
        private set

    /** Whether the reachable wrist build reports a wake level, and can therefore be gated on one. */
    @Volatile
    var reportsWakeLevel: Boolean = false
        private set

    private var refreshJob: Job? = null

    private val listener = CapabilityClient.OnCapabilityChangedListener { info ->
        if (info.name == WATCH_MIRROR_WAKE_CAPABILITY) {
            reportsWakeLevel = info.nodes.isNotEmpty()
            return@OnCapabilityChangedListener
        }
        update(info.nodes.isNotEmpty(), source = "listener")
    }

    fun start() {
        if (refreshJob?.isActive == true) return
        capabilityClient.addListener(listener, WATCH_MIRROR_CAPABILITY)
        capabilityClient.addListener(listener, WATCH_MIRROR_WAKE_CAPABILITY)
        refreshJob = scope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive) {
                val capabilityPresent = runCatching {
                    Tasks.await(
                        capabilityClient.getCapability(WATCH_MIRROR_CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                    )
                }.getOrNull()?.nodes?.isNotEmpty() ?: false
                reportsWakeLevel = runCatching {
                    Tasks.await(
                        capabilityClient.getCapability(WATCH_MIRROR_WAKE_CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                    )
                }.getOrNull()?.nodes?.isNotEmpty() ?: false
                val next = capabilityPresent || debugReachableWearNode()
                // Baseline event on the first query so an absent watch still leaves a trace.
                update(next, source = "refresh", force = attempt == 0)
                delay(PRESENCE_REFRESH_BURST_MS.getOrElse(attempt) { PRESENCE_REFRESH_STEADY_MS })
                attempt++
            }
        }
    }

    fun stop() {
        refreshJob?.cancel()
        refreshJob = null
        runCatching { capabilityClient.removeListener(listener, WATCH_MIRROR_CAPABILITY) }
        runCatching { capabilityClient.removeListener(listener, WATCH_MIRROR_WAKE_CAPABILITY) }
        present = false
        reportsWakeLevel = false
    }

    private fun update(next: Boolean, source: String, force: Boolean = false) {
        val changed = next != present
        present = next
        if (!changed && !force) return
        Log.d(VESC_SESSION_TAG, "Watch mirror presence: $next source=$source")
        scope.launch(Dispatchers.IO) {
            val connectedNodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull()?.size
            record(
                if (next) "watch_mirror_present" else "watch_mirror_absent",
                mapOf("source" to source, "connected_nodes" to connectedNodes),
            )
        }
    }

    private fun debugReachableWearNode(): Boolean {
        if (!BuildConfig.DEBUG) return false

        val nodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull().orEmpty()
        return nodes.isNotEmpty()
    }
}
