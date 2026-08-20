package expo.modules.vescapecore.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Foreground entry is a background→foreground transition, never a raw callback count. A rotation, an
 * activity swap, or a stale/duplicated stop must not start a second Presence Scan or cancel a live
 * one (#405).
 */
class ForegroundEntryTrackerTest {
    private val tracker = ForegroundEntryTracker()

    @Test
    fun `the first started activity is a foreground entry`() {
        assertTrue(tracker.started(Any()))
    }

    @Test
    fun `a second overlapping activity is not a foreground entry`() {
        tracker.started(Any())

        assertFalse(tracker.started(Any()))
    }

    @Test
    fun `a rotation handing over between activities is not a foreground entry`() {
        val first = Any()
        val second = Any()
        tracker.started(first)

        // The replacement starts before the old activity stops — the app never left the foreground.
        assertFalse(tracker.started(second))
        tracker.stopped(first)
        assertEquals(1, tracker.startedCount)
    }

    @Test
    fun `leaving and re-entering the foreground is a new entry`() {
        val first = Any()
        tracker.started(first)
        tracker.stopped(first)

        assertTrue(tracker.started(Any()))
    }

    @Test
    fun `a stale stop for an already-stopped activity cannot fake a new entry`() {
        val first = Any()
        tracker.started(first)
        tracker.stopped(first)
        val second = Any()
        tracker.started(second)

        // Late duplicate stops for the previous activity arrive after the new one is live.
        tracker.stopped(first)
        tracker.stopped(first)

        assertEquals(1, tracker.startedCount)
        // The live activity still holds the foreground, so nothing here is a fresh entry.
        assertFalse(tracker.started(second))
    }

    @Test
    fun `a repeated start for the same activity is not a second entry`() {
        val activity = Any()

        assertTrue(tracker.started(activity))
        assertFalse(tracker.started(activity))
        assertEquals(1, tracker.startedCount)
    }
}
