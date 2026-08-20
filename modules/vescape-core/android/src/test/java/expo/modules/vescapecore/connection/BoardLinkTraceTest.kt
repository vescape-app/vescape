package expo.modules.vescapecore.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/BoardLinkTraceTests.swift */
class BoardLinkTraceTest {
    @Test
    fun `a new Board Link is a linking event`() {
        assertTrue(BoardLinkTrace.isLinkPersist(previousBleId = null, nextBleId = "AA:BB"))
    }

    @Test
    fun `a changed Board Link is a linking event`() {
        assertTrue(BoardLinkTrace.isLinkPersist(previousBleId = "AA:BB", nextBleId = "CC:DD"))
    }

    @Test
    fun `an unchanged Board Link is an ordinary Board write`() {
        assertFalse(BoardLinkTrace.isLinkPersist(previousBleId = "AA:BB", nextBleId = "AA:BB"))
    }

    @Test
    fun `an offline Board is never a linking event`() {
        assertFalse(BoardLinkTrace.isLinkPersist(previousBleId = null, nextBleId = null))
        assertFalse(BoardLinkTrace.isLinkPersist(previousBleId = "AA:BB", nextBleId = null))
    }

    @Test
    fun `ble id is read out of the link value`() {
        assertEquals("AA:BB", BoardLinkTrace.bleIdOfLink(mapOf("bleId" to "AA:BB", "transport" to 36)))
        assertNull(BoardLinkTrace.bleIdOfLink(null))
        assertNull(BoardLinkTrace.bleIdOfLink(mapOf("transport" to 36)))
        assertNull(BoardLinkTrace.bleIdOfLink(mapOf("bleId" to "")))
    }
}
