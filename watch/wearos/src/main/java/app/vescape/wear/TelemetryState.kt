package app.vescape.wear

import android.os.SystemClock
import androidx.compose.runtime.mutableStateOf

/** MessageClient path the phone pushes Watch Frames on. Must match the phone-side WatchTelemetryPusher. */
const val TELEMETRY_PATH = "/telemetry"

/**
 * Latest wrist-visible Mirror State. Frames update it on receipt; the UI also ticks the clock so a
 * stopped stream becomes disconnected without an explicit phone message.
 */
object TelemetryState {
    val mirrorState = mutableStateOf(MirrorStateReducer.reduce(null, null, nowMs()))

    /** Watch-local phone-link view, kept fresh by [PhoneLinkMonitor] while the activity is started. */
    val phoneLink = mutableStateOf(PhoneLink.UNKNOWN)

    /** The monitor's last completed probe, so the wrist can show that it is still actually looking. */
    val linkProbe = mutableStateOf(LinkProbe())

    fun recordLinkProbe(nowMs: Long = nowMs()) {
        val probe = linkProbe.value
        linkProbe.value = LinkProbe(count = probe.count + 1, atMs = nowMs)
    }

    private var latestFrame: WatchFrame? = null
    private var lastFrameAtMs: Long? = null

    /** Gap between the two most recent frames: the phone's push cadence, as actually observed. */
    private var frameGapMs: Long? = null

    fun acceptFrame(frame: WatchFrame, nowMs: Long = nowMs()) {
        lastFrameAtMs?.let { frameGapMs = (nowMs - it).coerceAtLeast(0L) }
        latestFrame = frame
        lastFrameAtMs = nowMs
        refresh(nowMs)
    }

    fun refresh(nowMs: Long = nowMs()) {
        mirrorState.value = MirrorStateReducer.reduce(
            latestFrame,
            lastFrameAtMs,
            nowMs,
            mirrorDisconnectedTimeoutMs(frameGapMs),
        )
    }

    private fun nowMs(): Long = SystemClock.elapsedRealtime()
}

/**
 * One completed pass of [PhoneLinkMonitor]'s node/capability query. [count] exists so the UI can
 * react to a probe that changed nothing — a repeated "still no phone" is the answer, and a rider
 * watching a dead screen needs to see it land.
 */
data class LinkProbe(val count: Int = 0, val atMs: Long? = null)
