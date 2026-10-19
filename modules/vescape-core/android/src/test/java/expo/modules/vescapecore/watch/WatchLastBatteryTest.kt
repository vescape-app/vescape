package expo.modules.vescapecore.watch

import org.junit.Assert.*
import org.junit.Test

class WatchLastBatteryTest {
    @Test fun encodesCommittedReadingAndOmitsUnknownPropertyListKeys() {
        assertEquals(mapOf("boardId" to "a", "boardName" to "A", "percent" to 78.0, "at" to 1000L),
            WatchLastBattery("a", "A", 78.0, 1000).payload())
        assertEquals(mapOf("boardId" to "a", "boardName" to "A"), WatchLastBattery("a", "A", null, null).payload())
        assertFalse(WatchLastBattery("a", "A", Double.NaN, 1).payload().containsKey("percent"))
    }
}
