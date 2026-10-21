package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/GroupRideFrameTickTests.swift */
class GroupRideFrameTickTest {
    private class Gate(
        var present: Boolean = true,
        var wake: WatchMirrorWakeLevel = WatchMirrorWakeLevel.ACTIVE,
        var joined: Boolean = true,
    )

    private fun tick(scheduler: TestScheduler, gate: Gate, onPush: (ByteArray) -> Unit) = GroupRideFrameTick(
        scheduler = scheduler,
        canPushWatchFrame = { gate.present },
        wakeLevel = { gate.wake },
        frame = { if (gate.joined) GroupRideFrame(0.0, 600.0, emptyList()) else null },
        push = onPush,
    )

    @Test
    fun `pushes about once a second while joined with the wrist awake`() {
        val scheduler = TestScheduler()
        val pushed = mutableListOf<ByteArray>()
        tick(scheduler, Gate()) { pushed += it }.start()

        scheduler.advance(3 * GROUP_RIDE_FRAME_INTERVAL_MS)

        assertEquals(3, pushed.size)
        assertEquals(WATCH_GROUP_RIDE_VERSION, pushed.first()[0].toInt())
    }

    @Test
    fun `pushes nothing when not joined, asleep, in ambient, or with no mirror`() {
        for (gate in listOf(
            Gate(joined = false),
            Gate(wake = WatchMirrorWakeLevel.ASLEEP),
            Gate(wake = WatchMirrorWakeLevel.AMBIENT),
            Gate(present = false),
        )) {
            val scheduler = TestScheduler()
            var pushes = 0
            tick(scheduler, gate) { pushes++ }.start()

            scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)

            assertEquals(0, pushes)
        }
    }

    @Test
    fun `the tick keeps running through a gated stretch and resumes when it lifts`() {
        val scheduler = TestScheduler()
        val gate = Gate(wake = WatchMirrorWakeLevel.AMBIENT)
        var pushes = 0
        val groupTick = tick(scheduler, gate) { pushes++ }
        groupTick.start()

        scheduler.advance(2 * GROUP_RIDE_FRAME_INTERVAL_MS)
        gate.wake = WatchMirrorWakeLevel.ACTIVE
        scheduler.advance(GROUP_RIDE_FRAME_INTERVAL_MS)
        assertEquals(1, pushes)

        groupTick.stop()
        scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)
        assertFalse(pushes > 1)
    }
}
