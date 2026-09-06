package app.vescape.wear

import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.mutableStateOf
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val TAG = "VescMirror"
private const val MAX_EVENTS = 50

data class DiagnosticEvent(val time: String, val text: String, val warn: Boolean)

data class DiagnosticCounters(
    val framesDecoded: Long = 0,
    val decodeFailures: Long = 0,
    val unknownPathMessages: Long = 0,
    /** [SystemClock.elapsedRealtime] of the last decoded frame. */
    val lastFrameAtMs: Long? = null,
)

/**
 * Watch-local diagnostics for the frame path (main thread only). The wrist has no adb in the field,
 * so this is the observable half of "why is the Mirror dark": counters plus a small ring of events,
 * rendered by [DiagnosticsScreen] on the pager page right of the gauges. Splits "frames never
 * arrived" (phone-side problem) from "frames arrived but failed to decode" (build mismatch).
 * Events also go to logcat (`VescMirror`) for wired debug sessions. In-memory only — resets with
 * the process, which matches its job of explaining the incident currently on screen.
 */
object WatchDiagnostics {
    val counters = mutableStateOf(DiagnosticCounters())
    val events = mutableStateOf(listOf<DiagnosticEvent>())

    private var lastLink: PhoneLink? = null
    private var inDecodeFailStreak = false

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
        // Event once per failure streak, not per frame — frames flow at ~2 Hz. The first byte is
        // the sender's field count (ADR-0018), which names a phone/watch build mismatch.
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
    }

    fun recordReceiver(active: Boolean) {
        event(if (active) "receiver on" else "receiver off")
    }

    /** Emulator replay is a dev path, so its state is worth naming: the gauges are not showing a real ride. */
    fun recordReplay(fixture: String, sampleCount: Int) {
        event("replay $fixture ($sampleCount samples)")
    }

    fun recordReplayError(fixture: String, error: Exception) {
        event("replay $fixture failed: ${error.message}", warn = true)
    }

    /**
     * Radar is the one thing the wrist fetches itself, so its failures are not the phone's and must
     * not read like a dead link.
     */
    fun recordRadarFailure() {
        event("radar fetch failed", warn = true)
    }

    private fun event(text: String, warn: Boolean = false) {
        if (warn) Log.w(TAG, text) else Log.d(TAG, text)
        val time = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        events.value = (listOf(DiagnosticEvent(time, text, warn)) + events.value).take(MAX_EVENTS)
    }
}
