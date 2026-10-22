package expo.modules.vescapecore.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/alerts/AnnouncementQueueTests.swift */
class AnnouncementQueueTest {
    private class Item(val name: String)

    private val queue = AnnouncementQueue<Item>(settleMs = 4_000, quietGapMs = 2_000)
    private val dropped = mutableListOf<String>()

    private fun next(now: Long): Any = when (val step = queue.next(now) { dropped += it.name }) {
        is AnnouncementStep.Play -> step.item.name
        is AnnouncementStep.WaitUntil -> step.at
        AnnouncementStep.Idle -> "idle"
    }

    private fun enqueue(name: String, priority: AnnouncementPriority, now: Long = 0, ttlMs: Long = 60_000) =
        queue.enqueue(Item(name), priority, now, ttlMs)

    @Test
    fun playsOneAtATimeInPriorityOrderOldestFirst() {
        enqueue("social", AnnouncementPriority.SOCIAL)
        enqueue("ride end", AnnouncementPriority.ADVISORY)
        enqueue("weather", AnnouncementPriority.ADVISORY)
        enqueue("on", AnnouncementPriority.CONNECTION)
        assertEquals("on", next(0))
        assertEquals("idle", next(0))
        queue.finished(PlaybackOutcome.COMPLETED, 100)
        assertEquals("ride end", next(100))
        queue.finished(PlaybackOutcome.FAILED, 200)
        assertEquals("weather", next(200))
        queue.finished(PlaybackOutcome.COMPLETED, 300)
        assertEquals("social", next(300))
    }

    @Test
    fun settleWindowHoldsAllButConnectionItemsAndTheConnectCue() {
        queue.connected(0)
        enqueue("on", AnnouncementPriority.CONNECTION)
        enqueue("joined", AnnouncementPriority.SOCIAL, now = 500)
        assertEquals("on", next(500))
        queue.finished(PlaybackOutcome.COMPLETED, 1_000)
        assertEquals(4_000L, next(1_000))
        assertEquals("joined", next(4_000))
    }

    @Test
    fun criticalPreemptsRequeuesOnceAndResumesAfterQuietGap() {
        val first = Item("ride end")
        queue.enqueue(first, AnnouncementPriority.ADVISORY, 0, 60_000)
        assertEquals("ride end", next(0))
        assertEquals(first, queue.criticalStarted())
        assertNull(queue.finished(PlaybackOutcome.CANCELLED, 10))
        assertEquals("idle", next(10))
        queue.criticalEnded(1_000)
        assertEquals(3_000L, next(1_000))
        assertEquals("ride end", next(3_000))
        // Pre-empted a second time: no more retries, the cancel is final.
        queue.criticalStarted()
        assertEquals(first, queue.finished(PlaybackOutcome.CANCELLED, 3_100))
        queue.criticalEnded(3_200)
        assertEquals("idle", next(10_000))
    }

    @Test
    fun overlappingCriticalAlertsHoldUntilTheLastEnds() {
        enqueue("joined", AnnouncementPriority.SOCIAL)
        queue.criticalStarted()
        queue.criticalStarted()
        queue.criticalEnded(100)
        assertEquals("idle", next(100))
        queue.criticalEnded(500)
        assertEquals(2_500L, next(500))
    }

    @Test
    fun preemptedItemThatExpiredMeanwhileIsDropped() {
        val item = Item("joined")
        queue.enqueue(item, AnnouncementPriority.SOCIAL, 0, 1_000)
        assertEquals("joined", next(0))
        queue.criticalStarted()
        assertEquals(item, queue.finished(PlaybackOutcome.CANCELLED, 1_500))
    }

    @Test
    fun expiredItemsAreDroppedNeverPlayedLate() {
        enqueue("joined", AnnouncementPriority.SOCIAL, ttlMs = 1_000)
        enqueue("left", AnnouncementPriority.SOCIAL, ttlMs = 9_000)
        queue.criticalStarted()
        queue.criticalEnded(0)
        // Waits for the gap, or wakes early to drop the first expiry.
        assertEquals(1_000L, next(0))
        assertEquals(2_000L, next(1_000))
        assertEquals(listOf("joined"), dropped)
        assertEquals("left", next(2_000))
    }

    @Test
    fun clearReturnsPlayingAndPendingAndEndsSettle() {
        queue.connected(0)
        enqueue("on", AnnouncementPriority.CONNECTION)
        enqueue("joined", AnnouncementPriority.SOCIAL)
        assertEquals("on", next(0))
        assertEquals(listOf("on", "joined"), queue.clear().map { it.name })
        assertNull(queue.playing)
        enqueue("joined", AnnouncementPriority.SOCIAL, now = 10)
        assertEquals("joined", next(10))
    }
}
