package expo.modules.vescapecore.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// @parity /modules/vescape-core/ios/runtime/SchedulerTests.swift
class TestSchedulerTest {

    @Test
    fun `postDelayed fires after exact delay`() {
        val scheduler = TestScheduler()
        var fired = false
        scheduler.postDelayed(100) { fired = true }

        scheduler.advance(99)
        assertFalse(fired)

        scheduler.advance(1)
        assertTrue(fired)
    }

    @Test
    fun `multiple tasks fire in due-time order`() {
        val scheduler = TestScheduler()
        val order = mutableListOf<String>()
        scheduler.postDelayed(200) { order.add("b") }
        scheduler.postDelayed(100) { order.add("a") }
        scheduler.postDelayed(300) { order.add("c") }

        scheduler.advance(500)

        assertEquals(listOf("a", "b", "c"), order)
    }

    @Test
    fun `tasks at same dueAt fire in submission order`() {
        val scheduler = TestScheduler()
        val order = mutableListOf<String>()
        scheduler.postDelayed(100) { order.add("first") }
        scheduler.postDelayed(100) { order.add("second") }

        scheduler.advance(100)

        assertEquals(listOf("first", "second"), order)
    }

    @Test
    fun `cancel prevents block from running`() {
        val scheduler = TestScheduler()
        var fired = false
        val handle = scheduler.postDelayed(100) { fired = true }
        handle.cancel()

        scheduler.advance(200)

        assertFalse(fired)
    }

    @Test
    fun `re-entrant scheduling chains across advance`() {
        val scheduler = TestScheduler()
        var count = 0
        fun reschedule() {
            scheduler.postDelayed(50) {
                count++
                if (count < 3) reschedule()
            }
        }
        reschedule()

        scheduler.advance(200)

        assertEquals(3, count)
    }

    @Test
    fun `post runs at current time`() {
        val scheduler = TestScheduler()
        var firedAt = -1L
        scheduler.post { firedAt = scheduler.currentTimeMs }

        scheduler.advance(0)

        assertEquals(0L, firedAt)
    }

    @Test
    fun `cancel during run skips dependent task`() {
        val scheduler = TestScheduler()
        var bRan = false
        val handleB = arrayOfNulls<Cancellable>(1)
        scheduler.postDelayed(50) { handleB[0]?.cancel() }
        handleB[0] = scheduler.postDelayed(100) { bRan = true }

        scheduler.advance(200)

        assertFalse(bRan)
    }
}
