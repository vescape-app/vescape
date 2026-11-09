package expo.modules.vescapecore

import expo.modules.vescapecore.notices.RideNoticeEngine
import expo.modules.vescapecore.notices.RideNoticeLocation
import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/RiderSignalNoticesTests.swift */
class RiderSignalNoticesTest {
    private val notices = RiderSignalNotices()
    private val engine = RideNoticeEngine()

    private fun signal(kind: RiderSignalKind, startedAt: Long = 1_000, expiresAt: Long = 601_000) =
        RiderSignal(kind, 50.0, 19.0, startedAt, expiresAt)

    /** A roster at relay `now` 10_000 seen at phone time 5_010_000: offset +5_000_000. */
    private fun roster(vararg riders: SignalRider, relayNow: Long? = 10_000, localNow: Long = 5_010_000): RiderSignalNotices.Update {
        val update = notices.roster(riders.toList(), "me", relayNow, localNow)
        update.clears.forEach(engine::clear)
        update.posts.forEach { engine.post(it.key, it.content, it.revision, localNow) }
        return update
    }

    @Test
    fun `another rider's signal posts a located notice on the phone clock`() {
        val post = roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD))).posts.single()

        assertEquals("riderSignal:ola", post.key)
        assertEquals("1000", post.revision)
        assertEquals("Ola: Board problem", post.content.title)
        assertEquals("", post.content.details)
        assertEquals(RideNoticeSeverity.WARNING, post.content.severity)
        assertEquals(RideNoticeLocation(50.0, 19.0), post.content.location)
        assertEquals(5_001_000L, post.content.postedAt)
        assertEquals(5_601_000L, post.content.expiresAt)
    }

    @Test
    fun `down and help are critical`() {
        val posts = roster(
            SignalRider("a", "A", signal(RiderSignalKind.DOWN)),
            SignalRider("b", "B", signal(RiderSignalKind.HELP)),
            SignalRider("c", "C", signal(RiderSignalKind.WAIT)),
        ).posts
        assertEquals(
            listOf(RideNoticeSeverity.CRITICAL, RideNoticeSeverity.CRITICAL, RideNoticeSeverity.WARNING),
            posts.map { it.content.severity },
        )
    }

    @Test
    fun `the rider's own signal posts nothing`() {
        assertTrue(roster(SignalRider("me", "Me", signal(RiderSignalKind.HELP))).posts.isEmpty())
    }

    @Test
    fun `a re-sent roster with another relay now keeps the first conversion`() {
        val first = roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD))).posts.single()
        val again = roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD)), relayNow = 11_000, localNow = 5_011_250).posts.single()

        assertEquals(first, again)
    }

    @Test
    fun `clearing the signal or leaving clears the notice`() {
        roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD)), SignalRider("kai", "Kai", signal(RiderSignalKind.WAIT)))

        assertEquals(listOf("riderSignal:ola"), roster(SignalRider("ola", "Ola", null), SignalRider("kai", "Kai", signal(RiderSignalKind.WAIT))).clears)
        assertEquals(listOf("riderSignal:kai"), roster().clears)
        assertTrue(engine.active.isEmpty())
    }

    @Test
    fun `reset clears every posted notice`() {
        roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD)), SignalRider("kai", "Kai", signal(RiderSignalKind.WAIT)))

        assertEquals(setOf("riderSignal:ola", "riderSignal:kai"), notices.reset().toSet())
        assertTrue(notices.reset().isEmpty())
    }

    @Test
    fun `a dismissed notice stays hidden across re-sends and a rename, and shows again on a new startedAt`() {
        roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD)))
        engine.active.single().let { engine.dismiss(it.id, it.rev) }

        roster(SignalRider("ola", "Ola", signal(RiderSignalKind.BOARD)))
        roster(SignalRider("ola", "Ola K", signal(RiderSignalKind.BOARD)))
        assertTrue(engine.active.isEmpty())

        roster(SignalRider("ola", "Ola K", signal(RiderSignalKind.DOWN, startedAt = 9_000)))
        assertEquals("Ola K: Rider down", engine.active.single().content.title)
    }

    @Test
    fun `a roster without relay now uses signal times as they are`() {
        val post = roster(SignalRider("ola", "", signal(RiderSignalKind.WAIT)), relayNow = null, localNow = 2_000).posts.single()

        assertEquals("Rider: Wait for me", post.content.title)
        assertEquals(1_000L, post.content.postedAt)
    }
}
