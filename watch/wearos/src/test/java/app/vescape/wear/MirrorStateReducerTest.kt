package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MirrorStateReducerTest {
    @Test
    fun `transitions live to stale to disconnected to live over clock`() {
        val liveFrame = frame(stale = false)
        val staleFrame = frame(stale = true)

        val live = MirrorStateReducer.reduce(liveFrame, lastFrameAtMs = 1_000L, nowMs = 1_000L)
        assertEquals(MirrorStatus.LIVE, live.status)
        assertEquals(liveFrame, live.frame)

        val stale = MirrorStateReducer.reduce(staleFrame, lastFrameAtMs = 1_500L, nowMs = 1_500L)
        assertEquals(MirrorStatus.STALE, stale.status)
        assertEquals(staleFrame, stale.frame)

        val disconnected = MirrorStateReducer.reduce(
            staleFrame,
            lastFrameAtMs = 1_500L,
            nowMs = 1_500L + mirrorDisconnectedTimeoutMs(null) + 1L,
        )
        assertEquals(MirrorStatus.DISCONNECTED, disconnected.status)
        assertNull(disconnected.frame)

        val recovered = MirrorStateReducer.reduce(liveFrame, lastFrameAtMs = 3_500L, nowMs = 3_500L)
        assertEquals(MirrorStatus.LIVE, recovered.status)
        assertEquals(liveFrame, recovered.frame)
    }

    @Test
    fun `fresh legacy waiting frame remains renderable, timed-out waiting is disconnected`() {
        val waitingFrame = frame(stale = true).copy(waiting = true)

        val waiting = MirrorStateReducer.reduce(waitingFrame, lastFrameAtMs = 1_000L, nowMs = 1_000L)
        assertEquals(MirrorStatus.WAITING, waiting.status)
        assertNull(waiting.frame?.speed)
        assertNull(waiting.frame?.duty)

        val timedOut = MirrorStateReducer.reduce(
            waitingFrame,
            lastFrameAtMs = 1_000L,
            nowMs = 1_000L + mirrorDisconnectedTimeoutMs(null) + 1L,
        )
        assertEquals(MirrorStatus.DISCONNECTED, timedOut.status)
    }

    @Test
    fun `the disconnect window follows the observed push cadence`() {
        // Default cadence when nothing has been observed yet, and its own floor.
        assertEquals(750L, mirrorDisconnectedTimeoutMs(null))
        assertEquals(750L, mirrorDisconnectedTimeoutMs(50L))
        // A rider-chosen slower cadence widens the window instead of pinning the mirror offline.
        assertEquals(3_000L, mirrorDisconnectedTimeoutMs(1_000L))
        // A long stall cannot widen it without bound.
        assertEquals(30_000L, mirrorDisconnectedTimeoutMs(600_000L))
    }

    @Test
    fun `no frame is disconnected`() {
        val state = MirrorStateReducer.reduce(frame = null, lastFrameAtMs = null, nowMs = 0L)

        assertEquals(MirrorStatus.DISCONNECTED, state.status)
        assertNull(state.frame)
    }

    @Test
    fun `a reachable phone app that is not pushing gets no notice`() {
        val disconnected = MirrorStateReducer.reduce(frame = null, lastFrameAtMs = null, nowMs = 0L)

        // No Board is not a fault (ADR-0039): the shell stays empty and says nothing.
        assertNull(MirrorStateReducer.linkNotice(disconnected.status, PhoneLink.APP_REACHABLE))
    }

    @Test
    fun `phone-link problems are still named while no frames arrive`() {
        val disconnected = MirrorStateReducer.reduce(frame = null, lastFrameAtMs = null, nowMs = 0L).status

        assertEquals(LinkNotice.CONNECTING, MirrorStateReducer.linkNotice(disconnected, PhoneLink.UNKNOWN))
        assertEquals(LinkNotice.NO_PHONE, MirrorStateReducer.linkNotice(disconnected, PhoneLink.NO_PHONE))
        assertEquals(LinkNotice.APP_MISSING, MirrorStateReducer.linkNotice(disconnected, PhoneLink.PHONE_ONLY))
    }

    @Test
    fun `a board-less navigation frame is live, with its nav lanes and no notice`() {
        val navOnly = WatchFrame(
            speed = null,
            duty = null,
            battery = null,
            motorTemp = null,
            ctrlTemp = null,
            stale = false,
            navBearing = 42.0,
            navDistanceM = 1_250.0,
        )

        val state = MirrorStateReducer.reduce(navOnly, lastFrameAtMs = 1_000L, nowMs = 1_000L)

        assertEquals(MirrorStatus.LIVE, state.status)
        assertEquals(1_250.0, state.frame?.navDistanceM)
        assertNull(state.frame?.speed)
        // The link view is irrelevant once frames flow, whatever it last said.
        PhoneLink.entries.forEach { assertNull(MirrorStateReducer.linkNotice(state.status, it)) }
    }

    private fun frame(stale: Boolean): WatchFrame = WatchFrame(
        speed = 18.5,
        duty = 42.0,
        battery = 83.0,
        motorTemp = 51.0,
        ctrlTemp = 48.0,
        stale = stale,
    )
}
