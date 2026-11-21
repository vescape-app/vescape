package app.vescape.wear

import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.mutableStateOf

private const val TAG = "VescMirror"
/** @parity /modules/vescape-core/ios/watch/WatchDiagnostics.swift `maxEvents` */
private const val MAX_EVENTS = 50

/** @parity /modules/vescape-core/ios/watch/WatchDiagnostics.swift `WatchDiagnosticEvent` */
data class DiagnosticEvent(val atMs: Long, val text: String, val warn: Boolean)

data class DiagnosticCounters(
    val framesDecoded: Long = 0,
    val decodeFailures: Long = 0,
    val unknownPathMessages: Long = 0,
    val lastFrameAtMs: Long? = null,
)

/**
 * @parity /modules/vescape-core/ios/watch/WatchDiagnostics.swift `WatchDiagnosticsLog`
 */
object WatchDiagnostics {
    val counters = mutableStateOf(DiagnosticCounters())
    val events = mutableStateOf(listOf<DiagnosticEvent>())

    private var lastLink: PhoneLink? = null
    private var inDecodeFailStreak = false
    private var linkProbeFailed = false

    fun recordFrame() {
        val c = counters.value
        if (c.framesDecoded == 0L) event("first frame received")
        inDecodeFailStreak = false
        counters.value = c.copy(
            framesDecoded = c.framesDecoded + 1,
            lastFrameAtMs = SystemClock.elapsedRealtime(),
        )
    }

    fun recordDecodeFailure(bytes: ByteArray) {
        val c = counters.value
        counters.value = c.copy(decodeFailures = c.decodeFailures + 1)
        if (!inDecodeFailStreak) {
            inDecodeFailStreak = true
            event("decode fail ${bytes.size}B v${bytes.firstOrNull()?.toInt() ?: -1}", warn = true)
        }
    }

    fun recordUnknownPath(path: String) {
        val c = counters.value
        if (c.unknownPathMessages == 0L) event("message on $path", warn = true)
        counters.value = c.copy(unknownPathMessages = c.unknownPathMessages + 1)
    }

    fun recordLinkChange(link: PhoneLink) {
        if (link == lastLink) return
        lastLink = link
        event("link ${link.name}")
        linkProbeFailed = false
    }

    fun recordLinkProbeFailure() {
        if (linkProbeFailed) return
        linkProbeFailed = true
        event("phone link probe failed", warn = true)
    }

    fun recordNotificationFailure() {
        event("ongoing notification failed", warn = true)
    }

    fun recordReceiver(active: Boolean) {
        event(if (active) "receiver on" else "receiver off")
    }

    /**
     * @parity /modules/vescape-core/ios/watch/WatchDiagnostics.swift `recordReplay`
     */
    fun recordReplay(fixture: String, sampleCount: Int) {
        event("replay $fixture ($sampleCount samples)")
    }

    fun recordReplayError(fixture: String, error: Exception) {
        event("replay $fixture failed: ${error.message}", warn = true)
    }

    /**
     * @parity /modules/vescape-core/ios/watch/WatchDiagnostics.swift `recordRadarFailure`
     */
    fun recordRadarFailure() {
        event("radar fetch failed", warn = true)
    }

    private fun event(text: String, warn: Boolean = false) {
        if (warn) Log.w(TAG, text) else Log.d(TAG, text)
        events.value = (listOf(DiagnosticEvent(System.currentTimeMillis(), text, warn)) + events.value).take(MAX_EVENTS)
    }
}
