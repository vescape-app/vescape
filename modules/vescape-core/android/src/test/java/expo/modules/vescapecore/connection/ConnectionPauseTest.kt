package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Automatic Connection Pause map (ADR 0035, #406): rider intent arms a board-scoped deadline,
 * explicit Connect clears it, and mechanics never arm one.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionPauseTests.swift
 */
class ConnectionPauseTest {
    private class MemoryStorage(var value: String? = null) : ConnectionPauseStorage {
        override fun load(): String? = value

        override fun save(value: String?) {
            this.value = value
        }
    }

    private var now = 1_000_000L
    private val storage = MemoryStorage()
    private val registry = ConnectionPauseRegistry(storage) { now }

    @Test
    fun `every rider intent arms a pause, and nothing else does`() {
        for (source in listOf(
            ConnectionTraceReason.MANUAL_DISCONNECT,
            ConnectionTraceReason.END_RIDE,
            ConnectionTraceReason.APP_EXIT,
            ConnectionTraceReason.TASK_REMOVED,
        )) {
            assertTrue(source, ConnectionPausePolicy.arms(source))
        }
        // Mechanics must never suppress Auto Connect — this is the whole hazard of the slice.
        for (source in listOf(
            ConnectionTraceReason.MECHANICAL_TEARDOWN,
            ConnectionTraceReason.PROBE_CANCELLED,
            ConnectionTraceReason.STOP_SEARCH,
            ConnectionTraceReason.DEADLINE_EXPIRED,
            ConnectionTraceReason.AUTO_CLOSE,
            ConnectionTraceReason.USER_CANCELLED,
        )) {
            assertFalse(source, ConnectionPausePolicy.arms(source))
        }
    }

    @Test
    fun `a mechanical source stores nothing`() {
        assertNull(registry.arm("board-1", ConnectionTraceReason.MECHANICAL_TEARDOWN, 60))
        assertNull(registry.arm("board-1", ConnectionTraceReason.PROBE_CANCELLED, 60))
        assertNull(storage.value)
        assertNull(registry.active("board-1"))
    }

    @Test
    fun `zero duration means the rider opted out of pausing`() {
        assertNull(registry.arm("board-1", ConnectionTraceReason.MANUAL_DISCONNECT, 0))
        assertNull(registry.pausedUntilMs("board-1"))
        assertNull(storage.value)
    }

    @Test
    fun `a pause expires by absolute deadline, with no cleanup job`() {
        val pause = registry.arm("board-1", ConnectionTraceReason.END_RIDE, 30)!!
        assertEquals(now + 30 * 60_000L, pause.untilMs)

        now += 29 * 60_000L
        assertEquals(pause.untilMs, registry.pausedUntilMs("board-1"))

        now += 2 * 60_000L
        assertNull(registry.active("board-1"))
        // The expired entry is dropped on read.
        assertNull(storage.value)
    }

    @Test
    fun `boards pause independently and keep their own reason`() {
        registry.arm("board-1", ConnectionTraceReason.MANUAL_DISCONNECT, 10)
        registry.arm("board-2", ConnectionTraceReason.TASK_REMOVED, 60)

        assertEquals(ConnectionTraceReason.MANUAL_DISCONNECT, registry.active("board-1")?.source)
        assertEquals(ConnectionTraceReason.TASK_REMOVED, registry.active("board-2")?.source)

        // Expiring one Board leaves the other alone.
        now += 20 * 60_000L
        assertNull(registry.active("board-1"))
        assertEquals(ConnectionTraceReason.TASK_REMOVED, registry.active("board-2")?.source)
    }

    @Test
    fun `explicit connect clears only the affected board`() {
        registry.arm("board-1", ConnectionTraceReason.MANUAL_DISCONNECT, 60)
        registry.arm("board-2", ConnectionTraceReason.APP_EXIT, 60)

        registry.clear("board-1")

        assertNull(registry.active("board-1"))
        assertTrue(registry.active("board-2") != null)
    }

    @Test
    fun `a pause survives a process restart`() {
        registry.arm("board-1", ConnectionTraceReason.APP_EXIT, 60)

        // A fresh registry over the same persisted bytes — the force-quit case.
        val restarted = ConnectionPauseRegistry(MemoryStorage(storage.value)) { now }

        assertEquals(ConnectionTraceReason.APP_EXIT, restarted.active("board-1")?.source)
        now += 61 * 60_000L
        assertNull(restarted.active("board-1"))
    }

    @Test
    fun `corrupt persisted state fails open rather than blocking connection forever`() {
        storage.value = "{not json"
        assertNull(registry.active("board-1"))
        assertEquals(emptyMap<String, ConnectionPause>(), registry.entries())
    }

    @Test
    fun `promotion is blocked while paused and allowed once it expires`() {
        val pause = registry.arm("board-1", ConnectionTraceReason.MANUAL_DISCONNECT, 60)!!

        val blocked = PresenceScanPolicy.promotion(
            PresencePromotionInput(
                selectedObserved = true,
                autoConnectEnabled = true,
                pausedUntilMs = pause.untilMs,
                nowMs = now,
                sessionActive = false,
                currentOwner = ConnectionOwner.None,
            ),
        )
        assertFalse(blocked.proceed)
        assertEquals(ConnectionTraceReason.CONNECTION_PAUSED, blocked.reason)

        val allowed = PresenceScanPolicy.promotion(
            PresencePromotionInput(
                selectedObserved = true,
                autoConnectEnabled = true,
                pausedUntilMs = pause.untilMs,
                nowMs = pause.untilMs + 1,
                sessionActive = false,
                currentOwner = ConnectionOwner.None,
            ),
        )
        assertTrue(allowed.proceed)
    }
}
