package expo.modules.vescapecore.watch

import expo.modules.vescapecore.notices.RideNotice
import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrameTests.swift */
class RideNoticeFrameTest {
    private val frame = RideNoticeFrame(
        sentAtMs = 1_700_000_000_123L,
        notices = listOf(
            RideNoticeFrameItem(7, 2, RideNoticeFrameSeverity.CRITICAL, "Rider down", "Ola · 300 m behind", 1_700_000_600_000L),
            RideNoticeFrameItem(255, 255, RideNoticeFrameSeverity.INFO, "Regroup", "", null),
        ),
    )

    @Test
    fun `a frame survives the round trip`() {
        assertEquals(frame, RideNoticeFrameCodec.decode(RideNoticeFrameCodec.encode(frame)))
    }

    @Test
    fun `long text is cut on a character boundary`() {
        val long = RideNoticeFrameItem(1, 1, RideNoticeFrameSeverity.WARNING, "Ż".repeat(80), "Ż".repeat(400), null)

        val decoded = RideNoticeFrameCodec.decode(RideNoticeFrameCodec.encode(RideNoticeFrame(0, listOf(long))))!!

        assertEquals("Ż".repeat(48), decoded.notices.single().title)
        assertEquals("Ż".repeat(256), decoded.notices.single().details)
    }

    @Test
    fun `a different wire version is ignored whole`() {
        val bytes = RideNoticeFrameCodec.encode(frame)
        bytes[0] = (WATCH_RIDE_NOTICES_VERSION + 1).toByte()

        assertNull(RideNoticeFrameCodec.decode(bytes))
    }

    @Test
    fun `fields a newer phone appends to a notice record are skipped`() {
        val base = RideNoticeFrameCodec.encode(frame)
        val header = 1 + 8 + 1
        val out = ArrayList<Byte>(base.slice(0 until header))
        var at = header
        repeat(frame.notices.size) {
            val length = (base[at].toInt() and 0xFF) or ((base[at + 1].toInt() and 0xFF) shl 8)
            out.add((length + 2).toByte())
            out.add(((length + 2) shr 8).toByte())
            out.addAll(base.slice(at + 2 until at + 2 + length))
            out.add(7)
            out.add(9)
            at += 2 + length
        }

        assertEquals(frame, RideNoticeFrameCodec.decode(out.toByteArray()))
    }

    @Test
    fun `an unknown severity reads as a warning`() {
        val bytes = RideNoticeFrameCodec.encode(frame)
        // version, sentAt, count, recordBytes, id, rev -> severity of the first notice.
        bytes[1 + 8 + 1 + 2 + 1 + 1] = 9

        assertEquals(RideNoticeFrameSeverity.WARNING, RideNoticeFrameCodec.decode(bytes)!!.notices.first().severity)
    }

    @Test
    fun `a truncated payload is rejected`() {
        val bytes = RideNoticeFrameCodec.encode(frame)

        assertNull(RideNoticeFrameCodec.decode(bytes.copyOf(bytes.size - 3)))
    }

    @Test
    fun `the wrist slice keeps identity, severity, text and expiry`() {
        val notice = RideNotice(
            3, 4, "group:rider-down:ola",
            RideNoticeContent(RideNoticeSeverity.WARNING, "Low battery", "Kuba · 12%", postedAt = 5, expiresAt = 99),
        )

        assertEquals(
            RideNoticeFrame(42, listOf(RideNoticeFrameItem(3, 4, RideNoticeFrameSeverity.WARNING, "Low battery", "Kuba · 12%", 99))),
            listOf(notice).toRideNoticeFrame(42),
        )
    }
}
