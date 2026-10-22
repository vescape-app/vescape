package expo.modules.vescapecore.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class PlaybackCompletionTest {
    private val inline: (() -> Unit) -> Unit = { it() }

    @Test
    fun firstOutcomeWinsAndLaterOnesAreDropped() {
        val outcomes = mutableListOf<PlaybackOutcome>()
        val done = PlaybackCompletion(inline) { outcomes += it }
        assertTrue(done.finish(PlaybackOutcome.CANCELLED))
        assertFalse(done.finish(PlaybackOutcome.COMPLETED))
        assertFalse(done.finish(PlaybackOutcome.FAILED))
        assertEquals(listOf(PlaybackOutcome.CANCELLED), outcomes)
        assertTrue(done.isDone)
    }

    @Test
    fun racingFinishesFromManyThreadsDeliverOnce() {
        val outcomes = java.util.concurrent.ConcurrentLinkedQueue<PlaybackOutcome>()
        val done = PlaybackCompletion(inline) { outcomes += it }
        val pool = Executors.newFixedThreadPool(8)
        val start = CountDownLatch(1)
        repeat(64) { index ->
            pool.execute { start.await(); done.finish(PlaybackOutcome.entries[index % 3]) }
        }
        start.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
        assertEquals(1, outcomes.size)
    }

    @Test
    fun newerSpeechCancelsTheOneItPreempts() {
        val tracker = PlaybackTracker(inline)
        val outcomes = mutableListOf<Pair<String, PlaybackOutcome>>()
        val first = tracker.start { outcomes += "first" to it }
        tracker.claimSpeech(first)
        val second = tracker.start { outcomes += "second" to it }
        tracker.claimSpeech(second)
        // The pre-empted line's own end still lands later; it must not report again.
        first.finish(PlaybackOutcome.COMPLETED)
        second.finish(PlaybackOutcome.COMPLETED)
        assertEquals(listOf("first" to PlaybackOutcome.CANCELLED, "second" to PlaybackOutcome.COMPLETED), outcomes)
    }

    @Test
    fun cancelAllCancelsOnlyUnfinishedItems() {
        val tracker = PlaybackTracker(inline)
        val outcomes = mutableListOf<Pair<String, PlaybackOutcome>>()
        val cue = tracker.start { outcomes += "cue" to it }
        val speech = tracker.start { outcomes += "speech" to it }
        tracker.claimSpeech(speech)
        cue.finish(PlaybackOutcome.COMPLETED)
        tracker.cancelAll()
        tracker.cancelAll()
        assertEquals(listOf("cue" to PlaybackOutcome.COMPLETED, "speech" to PlaybackOutcome.CANCELLED), outcomes)
    }
}
