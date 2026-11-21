package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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

    @Test
    fun anEditWithNoKnownLightsIsDropped() {
        current = null
        relay().send(WatchLightsSwitch.LEDS, true)
        assertTrue(writes.isEmpty())
        assertEquals(listOf("watch_lights_dropped"), events)
    }

    @Test
    fun aSecondEditBeforeTheEchoKeepsTheFirst() {
        current = BoardLightsState(enabled = false, headlightsEnabled = false)
        val relay = relay()
        relay.send(WatchLightsSwitch.LEDS, true)
        relay.send(WatchLightsSwitch.HEADLIGHT, true)
        assertEquals(listOf(true to false, true to true), writes)
    }

    @Test
    fun aPhoneSideChangeReplacesThePendingPair() {
        current = BoardLightsState(enabled = false, headlightsEnabled = false)
        val relay = relay()
        relay.send(WatchLightsSwitch.LEDS, true)
        current = BoardLightsState(enabled = false, headlightsEnabled = true)
        relay.send(WatchLightsSwitch.LEDS, true)
        assertEquals(listOf(true to false, true to true), writes)
    }

    @Test
    fun aRefusedWriteLeavesNoPendingPair() {
        current = BoardLightsState(enabled = false, headlightsEnabled = false)
        val relay = WatchLightsRelay(
            scheduler = scheduler,
            currentLights = { current },
            setLights = { enabled, headlights -> writes.add(enabled to headlights); false },
            record = { name, _ -> events.add(name) },
        )
        relay.send(WatchLightsSwitch.LEDS, true)
        relay.send(WatchLightsSwitch.HEADLIGHT, true)
        assertEquals(listOf(true to false, false to true), writes)
    }

    @Test
    fun nothingIsWrittenUntilTheSchedulerRunsIt() {
        relay().accept(WatchLightsSwitch.LEDS, true)
        assertTrue(writes.isEmpty())
        scheduler.advance(0)
        assertEquals(listOf(true to false), writes)
    }
}
