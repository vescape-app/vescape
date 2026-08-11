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
            nowMs = 1_500L + MIRROR_DISCONNECTED_TIMEOUT_MS + 1L,
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
            nowMs = 1_000L + MIRROR_DISCONNECTED_TIMEOUT_MS + 1L,
        )
        assertEquals(MirrorStatus.DISCONNECTED, timedOut.status)
    }

    @Test
    fun `no frame is disconnected`() {
        val state = MirrorStateReducer.reduce(frame = null, lastFrameAtMs = null, nowMs = 0L)

        assertEquals(MirrorStatus.DISCONNECTED, state.status)
        assertNull(state.frame)
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
