package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The compose step a wrist edit goes through: one switch named, both switches written. */
class WatchLightsRelayTest {
    private val scheduler = TestScheduler()
    private val writes = mutableListOf<Pair<Boolean, Boolean>>()
    private val events = mutableListOf<String>()
    private var current: BoardLightsState? = BoardLightsState(enabled = false, headlightsEnabled = false)

    private fun relay() = WatchLightsRelay(
        scheduler = scheduler,
        currentLights = { current },
        setLights = { enabled, headlights -> writes.add(enabled to headlights); true },
        record = { name, _ -> events.add(name) },
    )

    /** Commands hop to the scheduler, so a flush is what makes one actually happen. */
    private fun WatchLightsRelay.send(switch: WatchLightsSwitch, on: Boolean) {
        accept(switch, on)
        scheduler.advance(0)
    }

    @Test
    fun anEditKeepsTheOtherSwitchAtThePhonesOwnValue() {
        current = BoardLightsState(enabled = false, headlightsEnabled = true)
        relay().send(WatchLightsSwitch.LEDS, true)
        assertEquals(listOf(true to true), writes)

        current = BoardLightsState(enabled = true, headlightsEnabled = true)
        relay().send(WatchLightsSwitch.HEADLIGHT, false)
        assertEquals(listOf(true to true, true to false), writes)
    }

    /** Nothing is written until the board has said what both switches are; a guess is not a write. */
    @Test
    fun anEditWithNoKnownLightsIsDropped() {
        current = null
        relay().send(WatchLightsSwitch.LEDS, true)
        assertTrue(writes.isEmpty())
        assertEquals(listOf("watch_lights_dropped"), events)
    }

    /** A binder-thread command must not touch Board Session state before the hop. */
    @Test
    fun nothingIsWrittenUntilTheSchedulerRunsIt() {
        relay().accept(WatchLightsSwitch.LEDS, true)
        assertTrue(writes.isEmpty())
        scheduler.advance(0)
        assertEquals(listOf(true to false), writes)
    }
}
