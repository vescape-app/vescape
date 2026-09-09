package expo.modules.vescapecore.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

// @parity /modules/vescape-core/ios/runtime/SchedulerTests.swift
class SessionGuardedSchedulerTest {
    @Test
    fun `guarded callback runs for active current session`() {
        val scheduler = TestScheduler()
        val session = BoardSession(1)
        var calls = 0

        scheduler.postDelayedForSession(session, 10L, { it === session }) { calls++ }
        scheduler.advance(10L)

        assertEquals(1, calls)
    }

    @Test
    fun `guarded callback skips invalidated session`() {
        val scheduler = TestScheduler()
        val session = BoardSession(1)
        var calls = 0

        scheduler.postDelayedForSession(session, 10L, { true }) { calls++ }
        session.invalidate()
        scheduler.advance(10L)

        assertEquals(0, calls)
    }

    @Test
    fun `guarded callback skips stale session`() {
        val scheduler = TestScheduler()
        val oldSession = BoardSession(1)
        val newSession = BoardSession(2)
        var current = oldSession
        var calls = 0

        scheduler.postDelayedForSession(oldSession, 10L, { it === current }) { calls++ }
        current = newSession
        scheduler.advance(10L)

        assertEquals(0, calls)
    }
}
