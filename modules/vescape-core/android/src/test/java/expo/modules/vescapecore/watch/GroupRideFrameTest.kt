package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import expo.modules.vescapecore.telemetry.TelemetryLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupRideFrameTest {
    private val me = GeoPoint(52.0, 21.0)
    private val nowMs = 1_000_000L

    private fun rider(
        id: String,
        position: GeoPoint? = GeoPoint(52.001, 21.0),
        color: String? = "#FF0000",
        stale: Boolean = false,
        lastSeenMs: Long = nowMs,
    ) = GroupRideRosterRider(id, id.uppercase(), color, position, stale, lastSeenMs)

    private fun build(
        riders: List<GroupRideRosterRider>,
        own: GeoPoint? = me,
        spanM: Double? = 800.0,
    ) = GroupRideFrameBuilder.build(GroupRideRoster("me", riders), own, courseDeg = 90.0, spanM = spanM, nowMs = nowMs)

    // Builder

    @Test
    fun `other riders become east-north offsets from the rider's fix, nearest first`() {
        val frame = build(
            listOf(
                rider("far", GeoPoint(52.0, 21.01)),
                rider("near", GeoPoint(52.001, 21.0)),
            ),
        )

        assertEquals(listOf("near", "far"), frame.riders.map { it.id })
        val near = frame.riders[0]
        assertEquals(0.0, near.eastM, 0.01)
        assertEquals(110.574, near.northM, 0.01)
        val far = frame.riders[1]
        assertEquals(685.0, far.eastM, 1.0)
        assertEquals(0.0, far.northM, 0.01)
        assertEquals(90.0, frame.courseDeg!!, 0.0)
    }

    @Test
    fun `the rider's own entry is never in the frame`() {
        val frame = build(listOf(rider("me"), rider("ola")))

        assertEquals(listOf("ola"), frame.riders.map { it.id })
    }

    @Test
    fun `span falls back to 600 m until the phone map publishes one`() {
        assertEquals(600.0, build(emptyList(), spanM = null).spanM, 0.0)
        assertEquals(600.0, build(emptyList(), spanM = 0.0).spanM, 0.0)
        assertEquals(800.0, build(emptyList(), spanM = 800.0).spanM, 0.0)
    }

    @Test
    fun `without a fix nobody can be placed, but the frame still says joined`() {
        val frame = build(listOf(rider("ola")), own = null)

        assertTrue(frame.riders.isEmpty())
    }

    @Test
    fun `riders without a position or silent past the drop window are left out`() {
        val frame = build(
            listOf(
                rider("nowhere", position = null),
                rider("gone", lastSeenMs = nowMs - GROUP_RIDE_DROP_AFTER_MS),
                rider("ola"),
            ),
        )

        assertEquals(listOf("ola"), frame.riders.map { it.id })
    }

    @Test
    fun `a rider unheard past the stale window is stale even before the relay says so`() {
        val frame = build(
            listOf(
                rider("quiet", lastSeenMs = nowMs - GROUP_RIDE_STALE_AFTER_MS),
                rider("flagged", stale = true, position = GeoPoint(52.002, 21.0)),
            ),
        )

        assertTrue(frame.riders.all { it.stale })
    }

    @Test
    fun `a chosen colour is kept and a missing one falls back by roster position`() {
        val frame = build(
            listOf(
                rider("picked", color = "#10C69A", position = GeoPoint(52.001, 21.0)),
                rider("unpicked", color = null, position = GeoPoint(52.002, 21.0)),
            ),
        )

        assertEquals(0xFF10C69A.toInt(), frame.riders[0].colorArgb)
        // Second in the roster -> second fallback tint (green).
        assertEquals(0xFF22C55E.toInt(), frame.riders[1].colorArgb)
    }

    @Test
    fun `fallback colours follow the phone roster order - own rider first, then nearest`() {
        val frame = GroupRideFrameBuilder.build(
            GroupRideRoster(
                "me",
                listOf(
                    rider("me", color = null),
                    rider("far", position = GeoPoint(52.002, 21.0), color = null),
                    rider("near", position = GeoPoint(52.001, 21.0), color = null),
                ),
            ),
            me, courseDeg = null, spanM = null, nowMs = nowMs,
        )

        // Index 0 is the Rider's own entry; near is 1 (green), far is 2 (amber).
        assertEquals(listOf(0xFF22C55E.toInt(), 0xFFF59E0B.toInt()), frame.riders.map { it.colorArgb })
    }

    @Test
    fun `battery percent and levels come from the rider's presence`() {
        val frame = build(
            listOf(
                rider("low").copy(soc = 0.084, motorTempC = 72.0, ctrlTempC = 40.0),
                rider("hot", GeoPoint(52.002, 21.0)).copy(soc = 0.5, motorTempC = 30.0, ctrlTempC = 81.0),
                rider("walking", GeoPoint(52.003, 21.0)),
            ),
        )

        val (low, hot, walking) = frame.riders
        assertEquals(8, low.batteryPercent)
        assertEquals(TelemetryLevel.CRITICAL, low.batteryLevel)
        assertEquals(TelemetryLevel.WARNING, low.heatLevel)
        assertEquals(50, hot.batteryPercent)
        assertEquals(TelemetryLevel.NORMAL, hot.batteryLevel)
        assertEquals(TelemetryLevel.CRITICAL, hot.heatLevel)
        assertNull(walking.batteryPercent)
        assertEquals(TelemetryLevel.NORMAL, walking.batteryLevel)
        assertEquals(TelemetryLevel.NORMAL, walking.heatLevel)
    }

    // Codec

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

    // Push gating

    private class Gate(
        var present: Boolean = true,
        var wake: WatchMirrorWakeLevel = WatchMirrorWakeLevel.ACTIVE,
        var joined: Boolean = true,
    )

    private fun tick(scheduler: TestScheduler, gate: Gate, onPush: (ByteArray) -> Unit) = GroupRideFrameTick(
        scheduler = scheduler,
        canPushWatchFrame = { gate.present },
        wakeLevel = { gate.wake },
        frame = { if (gate.joined) GroupRideFrame(0.0, 600.0, emptyList()) else null },
        push = onPush,
    )

    @Test
    fun `pushes about once a second while joined with the wrist awake`() {
        val scheduler = TestScheduler()
        val pushed = mutableListOf<ByteArray>()
        tick(scheduler, Gate()) { pushed += it }.start()

        scheduler.advance(3 * GROUP_RIDE_FRAME_INTERVAL_MS)

        assertEquals(3, pushed.size)
        assertEquals(WATCH_GROUP_RIDE_VERSION, pushed.first()[0].toInt())
    }

    @Test
    fun `pushes nothing when not joined, asleep, in ambient, or with no mirror`() {
        for (gate in listOf(
            Gate(joined = false),
            Gate(wake = WatchMirrorWakeLevel.ASLEEP),
            Gate(wake = WatchMirrorWakeLevel.AMBIENT),
            Gate(present = false),
        )) {
            val scheduler = TestScheduler()
            var pushes = 0
            tick(scheduler, gate) { pushes++ }.start()

            scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)

            assertEquals(0, pushes)
        }
    }

    @Test
    fun `the tick keeps running through a gated stretch and resumes when it lifts`() {
        val scheduler = TestScheduler()
        val gate = Gate(wake = WatchMirrorWakeLevel.AMBIENT)
        var pushes = 0
        val groupTick = tick(scheduler, gate) { pushes++ }
        groupTick.start()

        scheduler.advance(2 * GROUP_RIDE_FRAME_INTERVAL_MS)
        gate.wake = WatchMirrorWakeLevel.ACTIVE
        scheduler.advance(GROUP_RIDE_FRAME_INTERVAL_MS)
        assertEquals(1, pushes)

        groupTick.stop()
        scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)
        assertFalse(pushes > 1)
    }
}
