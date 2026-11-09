package expo.modules.vescapecore.notices

import expo.modules.vescapecore.notices.RideNoticeEngine.PostResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/notices/RideNoticeEngineTests.swift */
class RideNoticeEngineTest {
    private val engine = RideNoticeEngine()

    private fun content(
        severity: RideNoticeSeverity = RideNoticeSeverity.INFO,
        title: String = "Title",
        postedAt: Long = 1_000,
        expiresAt: Long? = null,
    ) = RideNoticeContent(severity, title, "Details", postedAt, RideNoticeLocation(52.0, 21.0), expiresAt)

    @Test
    fun `a post shows the notice with rev 1`() {
        assertEquals(PostResult.CHANGED, engine.post("a", content(), "r1", 0))
        val notice = engine.active.single()
        assertEquals(1, notice.id)
        assertEquals(1, notice.rev)
        assertEquals("a", notice.key)
    }

    @Test
    fun `an identical re-post changes nothing`() {
        engine.post("a", content(), "r1", 0)
        assertEquals(PostResult.UNCHANGED, engine.post("a", content(), "r1", 0))
    }

    @Test
    fun `a same-revision re-post updates in place without bumping rev`() {
        engine.post("a", content(), "r1", 0)
        assertEquals(PostResult.CHANGED, engine.post("a", content(title = "New"), "r1", 0))
        val notice = engine.active.single()
        assertEquals("New", notice.content.title)
        assertEquals(1, notice.rev)
        assertEquals(1, notice.id)
    }

    @Test
    fun `a dismissed notice stays hidden on a same-revision update`() {
        engine.post("a", content(), "r1", 0)
        assertTrue(engine.dismiss(1))
        assertEquals(PostResult.UNCHANGED, engine.post("a", content(title = "New"), "r1", 0))
        assertTrue(engine.active.isEmpty())
    }

    @Test
    fun `a new revision shows a dismissed notice again and bumps rev`() {
        engine.post("a", content(), "r1", 0)
        engine.dismiss(1)
        assertEquals(PostResult.CHANGED, engine.post("a", content(), "r2", 0))
        val notice = engine.active.single()
        assertEquals(2, notice.rev)
        assertEquals(1, notice.id)
    }

    @Test
    fun `rev wraps from 255 to 1`() {
        engine.post("a", content(), "r0", 0)
        for (revision in 1..254) engine.post("a", content(), "r$revision", 0)
        assertEquals(255, engine.active.single().rev)
        engine.post("a", content(), "wrap", 0)
        assertEquals(1, engine.active.single().rev)
    }

    @Test
    fun `dismissing an unknown or already dismissed id changes nothing`() {
        engine.post("a", content(), "r1", 0)
        assertFalse(engine.dismiss(9))
        engine.dismiss(1)
        assertFalse(engine.dismiss(1))
    }

    @Test
    fun `clear removes a notice, and clearing a dismissed one emits nothing`() {
        engine.post("a", content(), "r1", 0)
        engine.post("b", content(), "r1", 0)
        assertTrue(engine.clear("a"))
        assertEquals(listOf("b"), engine.active.map { it.key })
        engine.dismiss(2)
        assertFalse(engine.clear("b"))
        assertFalse(engine.clear("missing"))
        // Cleared: a fresh post of the key shows again even with the old revision.
        assertEquals(PostResult.CHANGED, engine.post("b", content(), "r1", 0))
    }

    @Test
    fun `expired notices drop silently on tick`() {
        engine.post("a", content(expiresAt = 5_000), "r1", 0)
        engine.post("b", content(expiresAt = 9_000), "r1", 0)
        assertEquals(5_000L, engine.nextExpiryAt())
        assertFalse(engine.tick(4_999))
        assertTrue(engine.tick(5_000))
        assertEquals(listOf("b"), engine.active.map { it.key })
        engine.dismiss(2)
        assertFalse(engine.tick(9_000))
        assertEquals(null, engine.nextExpiryAt())
    }

    @Test
    fun `an already expired post clears the key`() {
        engine.post("a", content(), "r1", 0)
        assertEquals(PostResult.CHANGED, engine.post("a", content(expiresAt = 10), "r2", 10))
        assertTrue(engine.active.isEmpty())
        assertEquals(PostResult.UNCHANGED, engine.post("b", content(expiresAt = 10), "r1", 10))
    }

    @Test
    fun `orders by severity, then newest postedAt, never re-post time`() {
        engine.post("old-info", content(postedAt = 1_000), "r1", 0)
        engine.post("warning", content(RideNoticeSeverity.WARNING, postedAt = 500), "r1", 0)
        engine.post("new-info", content(postedAt = 2_000), "r1", 0)
        engine.post("critical", content(RideNoticeSeverity.CRITICAL, postedAt = 100), "r1", 0)
        // Re-posting the old notice later does not move it up.
        engine.post("old-info", content(postedAt = 1_000), "r2", 50_000)
        assertEquals(listOf("critical", "warning", "new-info", "old-info"), engine.active.map { it.key })
    }

    @Test
    fun `ids are round-robin and skip active ids`() {
        engine.post("a", content(), "r", 0)
        engine.post("b", content(), "r", 0)
        engine.clear("a")
        // Freed id 1 is not reused straight away.
        engine.post("c", content(), "r", 0)
        assertEquals(3, engine.active.first { it.key == "c" }.id)
    }

    @Test
    fun `ids wrap past 255 and a full table drops the post`() {
        for (i in 1..255) assertEquals(PostResult.CHANGED, engine.post("k$i", content(), "r", 0))
        assertEquals(PostResult.DROPPED, engine.post("extra", content(), "r", 0))
        engine.clear("k7")
        engine.post("extra", content(), "r", 0)
        assertEquals(7, engine.active.first { it.key == "extra" }.id)
    }
}
