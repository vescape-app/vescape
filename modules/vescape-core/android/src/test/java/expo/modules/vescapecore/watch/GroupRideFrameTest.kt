package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/GroupRideFrameTests.swift */
class GroupRideFrameTest {
    @Test
    fun `a frame survives the round trip`() {
        val frame = GroupRideFrame(
            courseDeg = 45.0,
            spanM = 750.0,
            riders = listOf(
                GroupRideFrameRider("a-1", "Ola", 0xFF38BDF8.toInt(), 12.5, -40.25, stale = false),
                GroupRideFrameRider(
                    "b-2",
                    "Żaneta",
                    0xFFF472B6.toInt(),
                    -300.0,
                    800.0,
                    stale = true,
                    batteryPercent = 0,
                    batteryLevel = TelemetryLevel.CRITICAL,
                    heatLevel = TelemetryLevel.WARNING,
                ),
                GroupRideFrameRider("c-3", "Kuba", 0, 1.0, 2.0, stale = false, batteryPercent = 100),
            ),
        )

        assertEquals(frame, GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame)))
    }

    @Test
    fun `no course yet rides as NaN and decodes back to null`() {
        val frame = GroupRideFrame(courseDeg = null, spanM = 600.0, riders = emptyList())

        assertNull(GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame))!!.courseDeg)
    }

    @Test
    fun `long names are cut on a character boundary`() {
        val name = "Ż".repeat(40)
        val frame = GroupRideFrame(0.0, 600.0, listOf(GroupRideFrameRider("x", name, 0, 1.0, 1.0, false)))

        val decoded = GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame))!!

        assertEquals("Ż".repeat(16), decoded.riders.single().name)
    }

    @Test
    fun `a different wire version is ignored whole`() {
        val bytes = GroupRideFrameCodec.encode(GroupRideFrame(0.0, 600.0, emptyList()))
        bytes[0] = (WATCH_GROUP_RIDE_VERSION + 1).toByte()

        assertNull(GroupRideFrameCodec.decode(bytes))
    }

    @Test
    fun `fields a newer phone appends to a rider record are skipped`() {
        val rider = GroupRideFrameRider("a", "Ola", 0xFF00FF00.toInt(), 5.0, 6.0, stale = false)
        val base = GroupRideFrameCodec.encode(GroupRideFrame(10.0, 600.0, listOf(rider, rider.copy(id = "b"))))
        // Rebuild with two extra bytes after each record, as a later version of the record would carry.
        val header = 1 + 4 + 4 + 1
        val out = ArrayList<Byte>(base.slice(0 until header))
        var at = header
        repeat(2) {
            val length = base[at].toInt()
            out.add((length + 2).toByte())
            out.addAll(base.slice(at + 1..at + length))
            out.add(7)
            out.add(9)
            at += 1 + length
        }

        val decoded = GroupRideFrameCodec.decode(out.toByteArray())!!

        assertEquals(listOf(rider, rider.copy(id = "b")), decoded.riders)
    }

    /** [bytes] with the last [drop] bytes of every rider record cut, as an older encoder wrote them. */
    private fun withRecordsCut(bytes: ByteArray, riders: Int, drop: Int): ByteArray {
        val header = 1 + 4 + 4 + 1
        val out = ArrayList<Byte>(bytes.slice(0 until header))
        var at = header
        repeat(riders) {
            val length = bytes[at].toInt()
            out.add((length - drop).toByte())
            out.addAll(bytes.slice(at + 1..at + length - drop))
            at += 1 + length
        }
        return out.toByteArray()
    }

    @Test
    fun `a record from a phone before battery and heat decodes as no battery and normal levels`() {
        val rider = GroupRideFrameRider(
            "a",
            "Ola",
            0,
            5.0,
            6.0,
            stale = false,
            batteryPercent = 12,
            batteryLevel = TelemetryLevel.WARNING,
            heatLevel = TelemetryLevel.CRITICAL,
        )
        val bytes = GroupRideFrameCodec.encode(GroupRideFrame(10.0, 600.0, listOf(rider)))

        val decoded = GroupRideFrameCodec.decode(withRecordsCut(bytes, riders = 1, drop = 3))!!

        assertEquals(
            rider.copy(batteryPercent = null, batteryLevel = TelemetryLevel.NORMAL, heatLevel = TelemetryLevel.NORMAL),
            decoded.riders.single(),
        )
    }

    @Test
    fun `a wrist from before battery and heat reads the records it knows and skips the rest`() {
        val riders = listOf(
            GroupRideFrameRider("a", "Ola", 0, 5.0, 6.0, stale = true, batteryPercent = 9, batteryLevel = TelemetryLevel.CRITICAL),
            GroupRideFrameRider("b", "Kuba", 0, -7.0, 8.0, stale = false, heatLevel = TelemetryLevel.WARNING),
        )
        val buffer = java.nio.ByteBuffer.wrap(GroupRideFrameCodec.encode(GroupRideFrame(10.0, 600.0, riders)))
            .order(java.nio.ByteOrder.LITTLE_ENDIAN)
        // The first release's decoder: fixed fields up to flags, then a jump to the record's end.
        buffer.position(1 + 4 + 4)
        val read = List(buffer.get().toInt()) {
            val end = buffer.position() + 1 + buffer.get().toInt()
            val id = ByteArray(buffer.get().toInt()).also { buffer.get(it) }.toString(Charsets.UTF_8)
            ByteArray(buffer.get().toInt()).also { buffer.get(it) }
            buffer.int
            val east = buffer.float.toDouble()
            val north = buffer.float.toDouble()
            val stale = buffer.get().toInt() and 1 != 0
            buffer.position(end)
            Triple(id, east to north, stale)
        }

        assertEquals(riders.map { Triple(it.id, it.eastM to it.northM, it.stale) }, read)
        assertFalse(buffer.hasRemaining())
    }

    @Test
    fun `a truncated payload decodes to nothing`() {
        val bytes = GroupRideFrameCodec.encode(
            GroupRideFrame(0.0, 600.0, listOf(GroupRideFrameRider("a", "Ola", 0, 1.0, 1.0, false))),
        )

        assertNull(GroupRideFrameCodec.decode(bytes.copyOf(bytes.size - 3)))
        assertNull(GroupRideFrameCodec.decode(ByteArray(0)))
    }
}
