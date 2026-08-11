package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchMoveRelayTest {
    private val scheduler = TestScheduler()
    private val started = mutableListOf<Int>()
    private var stops = 0
    private var strength = 60
    private val events = mutableListOf<String>()

    /** Commands hop to the scheduler, so a flush is what makes one actually happen. */
    private fun WatchMoveRelay.send(direction: Int) {
        accept(direction)
        scheduler.advance(0)
    }

    private fun relay() = WatchMoveRelay(
        scheduler = scheduler,
        strengthPercent = { strength },
        startMove = { input -> started.add(input); true },
        stopMove = { stops++; true },
        record = { name, _ -> events.add(name) },
    )

    @Test
    fun aHeldDirectionScalesFullInputByThePhoneStrengthSetting() {
        val relay = relay()

        relay.send(1)
        assertEquals(listOf(76), started) // 127 * 60%

        strength = 100
        relay.send(1)
        assertEquals(listOf(76, 127), started)

        relay.send(-1)
        assertEquals(listOf(76, 127, -127), started)
    }

    @Test
    fun aReleaseStopsOnceAndDisarmsTheDeadMan() {
        val relay = relay()

        relay.send(1)
        relay.send(0)
        assertEquals(1, stops)

        // A repeated release on an already-stopped board is not another stop.
        relay.send(0)
        assertEquals(1, stops)

        scheduler.advance(WATCH_MOVE_DEADMAN_MS * 2)
        assertEquals(1, stops)
    }

    @Test
    fun silenceStopsTheBoardWithoutARelease() {
        val relay = relay()

        relay.send(1)
        scheduler.advance(WATCH_MOVE_DEADMAN_MS - 1)
        assertEquals(0, stops)

        scheduler.advance(1)
        assertEquals(1, stops)
        assertEquals("watch_move_deadman_stop", events.last())
    }

    @Test
    fun everyTickRearmsTheDeadManSoALongHoldKeepsRolling() {
        val relay = relay()

        repeat(10) {
            relay.send(1)
            scheduler.advance(WATCH_MOVE_DEADMAN_MS / 3)
        }
        assertEquals(0, stops)
        assertEquals(10, started.size)

        // Only the first tick of a continuous hold is worth a diagnostic event.
        assertEquals(listOf("watch_move_held"), events)

        scheduler.advance(WATCH_MOVE_DEADMAN_MS)
        assertEquals(1, stops)
    }

    @Test
    fun teardownStopsAnActiveHoldAndDropsTheDeadMan() {
        val relay = relay()

        relay.send(1)
        relay.cancel()
        scheduler.advance(WATCH_MOVE_DEADMAN_MS * 2)
        assertEquals(1, stops)
    }

    @Test
    fun anUnknownPayloadIsNotACommand() {
        assertNull(WatchCommandDecoder.decode(ByteArray(0)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(1)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(99, 1)))
        assertEquals(WatchCommand.Move(-1), WatchCommandDecoder.decode(byteArrayOf(1, -1)))
        assertEquals(WatchCommand.Move(0), WatchCommandDecoder.decode(byteArrayOf(1, 0)))
        // A direction from a future wrist never becomes a bigger move than full reverse/forward.
        assertEquals(WatchCommand.Move(1), WatchCommandDecoder.decode(byteArrayOf(1, 7)))
    }
}
