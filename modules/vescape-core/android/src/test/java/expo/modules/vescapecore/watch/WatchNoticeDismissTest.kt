package expo.modules.vescapecore.watch

import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeEngine
import expo.modules.vescapecore.notices.RideNoticeLocation
import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wrist dismiss (#652): the wire bytes a wrist sends land on the same engine dismiss the phone card
 * uses, and nothing else.
 *
 * @parity /modules/vescape-core/ios/watch/WatchNoticeDismissTests.swift
 */
class WatchNoticeDismissTest {
    private val engine = RideNoticeEngine()

    private fun post(key: String) = engine.post(
        key,
        RideNoticeContent(RideNoticeSeverity.INFO, key, "Details", 0, RideNoticeLocation(52.0, 21.0), null),
        "r1",
        0,
    )

    /** What [WatchCommandListenerService] does with a decoded dismiss. */
    private fun relay(bytes: ByteArray): Boolean {
        val command = WatchCommandDecoder.decode(bytes) as? WatchCommand.DismissNotice ?: return false
        return engine.dismiss(command.id)
    }

    @Test
    fun `a dismiss decodes its id over the whole unsigned byte`() {
        assertEquals(WatchCommand.DismissNotice(1), WatchCommandDecoder.decode(byteArrayOf(6, 1)))
        assertEquals(WatchCommand.DismissNotice(255), WatchCommandDecoder.decode(byteArrayOf(6, -1)))
    }

    @Test
    fun `a dismiss without its id byte is dropped`() {
        assertNull(WatchCommandDecoder.decode(byteArrayOf(6)))
    }

    @Test
    fun `a wrist dismiss removes the notice holding that id and leaves the rest`() {
        post("a")
        post("b")
        val id = engine.active.first { it.key == "a" }.id
        assertTrue(relay(byteArrayOf(6, id.toByte())))
        assertEquals(listOf("b"), engine.active.map { it.key })
    }

    @Test
    fun `a dismiss for an id that is not active is ignored`() {
        post("a")
        assertFalse(relay(byteArrayOf(6, 42)))
        val id = engine.active.single().id
        relay(byteArrayOf(6, id.toByte()))
        assertFalse(relay(byteArrayOf(6, id.toByte())))
        assertTrue(engine.active.isEmpty())
    }
}
