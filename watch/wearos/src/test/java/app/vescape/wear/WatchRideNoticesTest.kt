package app.vescape.wear

import expo.modules.vescapecore.watch.RideNoticeFrame
import expo.modules.vescapecore.watch.RideNoticeFrameCodec
import expo.modules.vescapecore.watch.RideNoticeFrameItem
import expo.modules.vescapecore.watch.RideNoticeFrameSeverity
import expo.modules.vescapecore.watch.WATCH_RIDE_NOTICES_VERSION
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchRideNoticesTests.swift */
class WatchRideNoticesTest {
    private var now = 1_000L
    private val intake = WatchMirrorIntake { now }
    private var sentAt = 0L

    private fun notice(id: Int, rev: Int = 1, title: String = "Rider down", expiresAtMs: Long? = null) =
        RideNoticeFrameItem(id, rev, RideNoticeFrameSeverity.CRITICAL, title, "Ola", expiresAtMs)

    private fun push(vararg notices: RideNoticeFrameItem): Boolean =
        intake.acceptRideNotices(RideNoticeFrameCodec.encode(RideNoticeFrame(++sentAt, notices.toList())))

    @Test
    fun `a new pair buzzes and shows, an update in place does neither`() {
        assertTrue(push(notice(1)))
        assertEquals(1, intake.rideNoticeCard!!.id)

        assertFalse(push(notice(1, title = "Rider down · 200 m")))
        assertEquals("Rider down · 200 m", intake.rideNoticeCard!!.title)
    }

    @Test
    fun `a new revision or a reused id buzzes again and brings back a hidden card`() {
        push(notice(1))
        intake.hideRideNotice(1, 1)
        assertNull(intake.rideNoticeCard)
        assertFalse(push(notice(1)))
        assertNull(intake.rideNoticeCard)

        assertTrue(push(notice(1, rev = 2)))
        assertEquals(2, intake.rideNoticeCard!!.rev)

        push()
        assertNull(intake.rideNoticeCard)
        assertTrue(push(notice(1, rev = 2)))
    }

    @Test
    fun `hiding the top card shows the next one`() {
        push(notice(1), notice(2))
        intake.hideRideNotice(1, 1)

        assertEquals(2, intake.rideNoticeCard!!.id)
    }

    @Test
    fun `expired notices leave without a phone push`() {
        push(notice(1, expiresAtMs = 5_000))
        now = 5_000
        intake.refresh(0)

        assertNull(intake.rideNoticeCard)
    }

    @Test
    fun `a repeated or older frame is ignored`() {
        val bytes = RideNoticeFrameCodec.encode(RideNoticeFrame(10, listOf(notice(1))))
        assertTrue(intake.acceptRideNotices(bytes))
        assertFalse(intake.restoreColdState(null, null, null, null, bytes))

        assertFalse(intake.acceptRideNotices(RideNoticeFrameCodec.encode(RideNoticeFrame(5, emptyList()))))
        assertEquals(1, intake.rideNoticeCard!!.id)
    }

    @Test
    fun `an unreadable frame keeps the list, a deleted item clears it`() {
        push(notice(1))
        val newer = RideNoticeFrameCodec.encode(RideNoticeFrame(99, emptyList()))
        newer[0] = (WATCH_RIDE_NOTICES_VERSION + 1).toByte()

        assertFalse(intake.acceptRideNotices(newer))
        assertEquals(1, intake.rideNoticeCard!!.id)

        intake.acceptRideNotices(null)
        assertNull(intake.rideNoticeCard)
    }

    @Test
    fun `phone codec round trip decodes on the wrist`() {
        val frame = RideNoticeFrame(7, listOf(notice(3, rev = 9, expiresAtMs = 9_000)))

        assertEquals(frame, RideNoticeFrameCodec.decode(RideNoticeFrameCodec.encode(frame)))
    }
}
