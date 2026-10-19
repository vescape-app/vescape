package expo.modules.vescapecore.watch

import org.junit.Assert.*
import org.junit.Test

class WatchLastBatteryTest {
    @Test fun selectsStoredReadingAndDropsIncompleteOrDeletedBoards() {
        val board = mapOf("name" to "X7", "lastBattery" to mapOf("percent" to 78.0, "voltage" to null, "at" to 1000L), "deletedAt" to null)
        assertEquals(WatchLastBattery("a", "X7", 78.0, 1000), WatchLastBattery.selected("a", board))
        assertEquals(WatchLastBattery("a", "X7", null, null), WatchLastBattery.selected("a", board - "lastBattery"))
        assertEquals(WatchLastBattery("a", "X7", null, null), WatchLastBattery.selected("a", board + ("lastBattery" to mapOf("percent" to Double.NaN, "at" to 1L))))
        assertNull(WatchLastBattery.selected("a", board + ("deletedAt" to 5L)))
        assertNull(WatchLastBattery.selected(null, board))
        assertNull(WatchLastBattery.selected("a", null))
    }
}
