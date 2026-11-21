package app.vescape.wear

import android.os.SystemClock
import androidx.compose.runtime.mutableStateOf

const val TELEMETRY_PATH = "/telemetry"

/** @parity /watch/watchos/PhoneLink.swift */
object TelemetryState {
    val mirrorState = mutableStateOf(MirrorStateReducer.reduce(null, null, nowMs()))

    val phoneLink = mutableStateOf(PhoneLink.UNKNOWN)

    val linkProbe = mutableStateOf(LinkProbe())

    fun recordLinkProbe(nowMs: Long = nowMs()) {
        val probe = linkProbe.value
        linkProbe.value = LinkProbe(count = probe.count + 1, atMs = nowMs)
    }

    fun refresh(nowMs: Long = nowMs()) {
        MirrorIntakeState.apply { refresh(nowMs) }
    }

    private fun nowMs(): Long = SystemClock.elapsedRealtime()
}

data class LinkProbe(val count: Int = 0, val atMs: Long? = null)
