package expo.modules.vescapecore.accessory

import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/accessory/ClearancePreviewLogTests.swift */
class ClearancePreviewLogTest {
    @Test fun invalidAndMissingSamplesBreakChartWithoutInventingDistance() {
        val log = ClearancePreviewLog()
        log.record(0, 0, 1, 10.0)
        log.record(50, 50, 2, null)
        log.record(100, 100, 3, 12.0)
        log.record(200, 200, 5, 14.0)
        val snapshot = log.snapshot(200)!!
        assertEquals(listOf(listOf(0.0, 10.0), listOf(100.0, 12.0), listOf(200.0, 14.0)), snapshot["segments"])
        assertEquals(1L, snapshot["dropped"])
        assertEquals(1, snapshot["invalid"])
        assertEquals(15.0, snapshot["deliveredHz"])
    }
    @Test fun displayThrottleDoesNotDropHistoryAndResetStartsFresh() {
        val log = ClearancePreviewLog()
        for (i in 0L..6L) {
            log.record(i * 50, i * 50, i + 1, 10.0)
            assertEquals(i % 2 == 0L, log.shouldEmit(i * 50))
        }
        assertEquals(7, log.snapshot(300)!!["samples"])
        assertNull(log.snapshot(400))
        log.reset()
        log.record(450, 0, 1, 8.0)
        assertTrue(log.shouldEmit(450))
        assertEquals(1, log.snapshot(450)!!["samples"])
    }
    @Test fun windowAndCapacityBoundMemory() {
        val log = ClearancePreviewLog()
        for (i in 0L..1000L) log.record(i * 50, i * 50, i + 1, 10.0)
        assertEquals(401, log.snapshot(50_000)!!["samples"])
        log.reset()
        for (i in 0L..1000L) log.record(i, i, i + 1, 10.0)
        assertEquals(601, log.snapshot(1000)!!["samples"])
    }
}
