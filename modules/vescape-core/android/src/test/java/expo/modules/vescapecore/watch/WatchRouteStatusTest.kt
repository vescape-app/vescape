package expo.modules.vescapecore.watch

import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchRouteStatusTests.swift */
class WatchRouteStatusTest {
    @Test fun `loader follows matching route receipt, position, replacement and clear`() {
        assertEquals(WatchRouteNotice.COMPUTING, WatchRouteStatus(WatchRoutePhase.COMPUTING).notice(7, true))
        val pending = WatchRouteStatus(WatchRoutePhase.READY, 42)
        assertEquals(WatchRouteNotice.RECEIVING, pending.notice(null, true))
        assertEquals(WatchRouteNotice.RECEIVING, pending.notice(7, true))
        assertFalse(pending.canDraw(7))
        assertEquals(WatchRouteNotice.LOCATION, pending.notice(42, false))
        assertNull(pending.notice(42, true))
        assertTrue(pending.canDraw(42))
        assertEquals(WatchRouteNotice.FAILED, WatchRouteStatus(WatchRoutePhase.FAILED).notice(42, true))
        assertNull(WatchRouteStatus(WatchRoutePhase.IDLE).notice(42, true))
        assertFalse(WatchRouteStatus(WatchRoutePhase.IDLE).canDraw(42))
    }

    @Test fun `wire preserves unsigned route ids and rejects unsupported or truncated messages`() {
        val status = WatchRouteStatus(WatchRoutePhase.READY, 0xfedcba98)
        val encoded = WatchRouteStatusCodec.encode(status)
        assertArrayEquals(byteArrayOf(1, 2, 0x98.toByte(), 0xba.toByte(), 0xdc.toByte(), 0xfe.toByte()), encoded)
        assertEquals(status, WatchRouteStatusCodec.decode(encoded))
        assertNull(WatchRouteStatusCodec.decode(encoded.copyOf(5)))
        assertNull(WatchRouteStatusCodec.decode(encoded.copyOf().also { it[0] = 2 }))
        assertNull(WatchRouteStatusCodec.decode(encoded.copyOf().also { it[1] = 99 }))
        assertEquals(0x4f9f2cab, WatchRouteStatusCodec.routeId("hello".toByteArray()))
    }
}
