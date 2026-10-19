package app.vescape.wear

import org.junit.Assert.*
import org.junit.Test

class WatchLastBatteryTest {
    @Test fun decodesKnownUnknownClearAndRejectsInvalidValues() {
        val payload = mapOf("boardId" to "a", "boardName" to "GT Beast", "percent" to 78.5, "at" to 1000L)
        val value = WatchLastBattery.decode(payload)!!
        assertEquals("79%", value.text)
        assertEquals(1000L, value.at)
        assertEquals("--", WatchLastBattery.decode(mapOf("boardId" to "a", "boardName" to "New"))!!.text)
        assertNull(WatchLastBattery.decode(emptyMap()))
        assertNull(WatchLastBattery.decode(payload + ("percent" to Double.NaN))!!.percent)
    }
    @Test fun ageAdvancesWithoutPhoneAndGatesFollowAgeBoundaries() {
        val gate = BatteryUpdateGate()
        val battery = WatchLastBattery("a", "A", 78.2, 1000L)
        assertTrue(gate.changed(battery, 1000L))
        assertFalse(gate.changed(battery.copy(percent = 78.4, at = 2000), 2000L))
        assertNull(battery.age(3_600_999))
        assertEquals("1h", battery.age(3_601_000))
        assertTrue(gate.changed(battery, 3_601_000))
        assertFalse(gate.changed(battery, 3_602_000))
        val renamed = battery.copy(boardName = "Renamed offline")
        assertTrue(gate.changed(renamed, 3_602_000))
        assertEquals(battery.at, renamed.at)
        assertFalse(gate.changed(renamed, 3_602_000))
        assertTrue(gate.changed(battery.copy(boardId = "b"), 3_602_000))
        assertTrue(gate.changed(null, 3_602_000))
        assertFalse(gate.changed(null, 3_603_000))
        assertEquals("1d", battery.age(86_401_000))
    }
}
