package expo.modules.vescapecore.replay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private const val WARMUP_MS = 180_000L
private const val WARMUP_SPEED = 30.0

/** @parity /modules/vescape-core/ios/replay/ReplayClockTests.swift */
class ReplayClockTest {

    /**
     * The dev Replay UI's contract: a replay nobody asked to warm up is wall time, so a recorded
     * ride plays back exactly as it happened.
     */
    @Test
    fun `runs at wall time when no warmup was asked for`() {
        val clock = ReplayClock()
        clock.startPlayback(System.currentTimeMillis())

        assertEquals(1.0, clock.speed, 0.0)
        assertEquals(System.currentTimeMillis().toDouble(), clock.nowMs().toDouble(), 50.0)
        // 1x pacing: an event 5s into the recording is 5s of real waiting away.
        assertEquals(5_000.0, clock.delayUntilRecorded(5_000L).toDouble(), 50.0)
    }

    @Test
    fun `starts a full warmup window in the past`() {
        val clock = ReplayClock(WARMUP_MS, WARMUP_SPEED)
        val startedAt = System.currentTimeMillis()
        clock.startPlayback(startedAt)

        assertEquals((startedAt - WARMUP_MS).toDouble(), clock.nowMs().toDouble(), 50.0)
    }

    /**
     * The point of the whole design: the warmup is delivered in a fraction of the real time it
     * covers, but its samples still have to be stamped across the window they actually span, or the
     * live charts stay empty.
     */
    @Test
    fun `compresses the warmup into wall time divided by speed`() {
        val clock = ReplayClock(WARMUP_MS, WARMUP_SPEED)
        clock.startPlayback(System.currentTimeMillis())

        // Halfway through the recorded window arrives in half the compressed duration...
        assertEquals(
            (WARMUP_MS / 2 / WARMUP_SPEED),
            clock.delayUntilRecorded(WARMUP_MS / 2).toDouble(),
            50.0,
        )
        // ...and the end of it in the whole compressed duration: 3 recorded minutes in 6 seconds.
        assertEquals(WARMUP_MS / WARMUP_SPEED, clock.delayUntilRecorded(WARMUP_MS).toDouble(), 50.0)
    }

    /**
     * Session time is what the live series bucket on, so it has to advance by the recorded span
     * rather than by the real time the warmup took.
     */
    @Test
    fun `advances session time at the warmup speed`() {
        val clock = ReplayClock(WARMUP_MS, WARMUP_SPEED)
        clock.startPlayback(System.currentTimeMillis())
        val before = clock.nowMs()

        Thread.sleep(50L)

        val advancedMs = clock.nowMs() - before
        assertTrue("expected ~${50 * WARMUP_SPEED}ms of session time, was $advancedMs", advancedMs > 50 * 10)
    }

    @Test
    fun `drops to 1x once session time reaches the end of the warmup`() {
        // Short enough that the warmup really elapses inside the test.
        val clock = ReplayClock(warmupMs = 1_000L, warmupSpeed = 20.0)
        clock.startPlayback(System.currentTimeMillis())

        Thread.sleep(80L) // 1000ms of session time at 20x needs 50ms of real time
        clock.delayUntilRecorded(1_000L)

        assertEquals(1.0, clock.speed, 0.0)
        // Past the boundary, playback is real time again: 2s of recording is 2s of waiting.
        val delayMs = clock.delayUntilRecorded(3_000L) - clock.delayUntilRecorded(1_000L)
        assertEquals(2_000.0, delayMs.toDouble(), 100.0)
    }

    /**
     * Freezing the lag rather than snapping it away is what keeps the timeline continuous; a jump
     * back to wall time would tear a gap into every live series at the boundary.
     */
    @Test
    fun `keeps session time continuous across the speed change`() {
        val clock = ReplayClock(warmupMs = 1_000L, warmupSpeed = 20.0)
        clock.startPlayback(System.currentTimeMillis())
        Thread.sleep(80L)

        val beforeDrop = clock.nowMs()
        clock.delayUntilRecorded(1_000L)
        val afterDrop = clock.nowMs()

        assertTrue("session time jumped $beforeDrop -> $afterDrop", afterDrop >= beforeDrop)
        assertEquals(beforeDrop.toDouble(), afterDrop.toDouble(), 50.0)
    }
}
