package expo.modules.vescapecore.watch

import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeEngine
import expo.modules.vescapecore.notices.RideNoticeLocation
import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wrist dismiss (#652): the wire bytes a wrist sends go through the service's real routing into the
 * same engine dismiss the phone card uses, and nothing else. The engine stands in for the
 * main-looper `RideNotices` owner, which plain JVM tests cannot run.
 *
 * @parity /modules/vescape-core/ios/watch/WatchNoticeDismissTests.swift
 */
class WatchNoticeDismissTest {
    private val engine = RideNoticeEngine()

    private fun post(key: String, revision: String = "r1") = engine.post(
        key,
        RideNoticeContent(RideNoticeSeverity.INFO, key, "Details", 0, RideNoticeLocation(52.0, 21.0), null),
        revision,
        0,
    )

    private fun relay(vararg bytes: Int) =
        routeWatchCommand(ByteArray(bytes.size) { bytes[it].toByte() }) { id, rev -> engine.dismiss(id, rev) }

    @Test
    fun `a dismiss decodes its id and rev over the whole unsigned byte`() {
        assertEquals(WatchCommand.DismissNotice(1, 2), WatchCommandDecoder.decode(byteArrayOf(6, 1, 2)))
        assertEquals(WatchCommand.DismissNotice(255, 255), WatchCommandDecoder.decode(byteArrayOf(6, -1, -1)))
    }

    @Test
    fun `a dismiss without its rev byte is dropped`() {
        assertNull(WatchCommandDecoder.decode(byteArrayOf(6)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(6, 1)))
    }

    @Test
    fun `a wrist dismiss removes the notice holding that id and leaves the rest`() {
        post("a")
        post("b")
        val a = engine.active.first { it.key == "a" }
        relay(6, a.id, a.rev)
        assertEquals(listOf("b"), engine.active.map { it.key })
    }

    @Test
    fun `a dismiss for an id that is not active is ignored`() {
        post("a")
        relay(6, 42, 1)
        assertEquals(listOf("a"), engine.active.map { it.key })
    }

    @Test
    fun `a dismiss for the revision the wrist saw leaves a re-sent revision showing`() {
        post("a")
        val seen = engine.active.single()
        post("a", revision = "r2")
        relay(6, seen.id, seen.rev)
        assertEquals(seen.rev + 1, engine.active.single().rev)
        relay(6, seen.id, seen.rev + 1)
        assertTrue(engine.active.isEmpty())
    }
}
