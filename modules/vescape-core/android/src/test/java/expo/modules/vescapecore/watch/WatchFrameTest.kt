package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Round-trips the Watch Frame wire contract: build a frame, encode it, then decode it back. [decode]
 * mirrors the wrist-side `app.vescape.wear.WatchFrameDecoder` lane-for-lane (ADR-0018) — the watch
 * module is a separate Gradle app and cannot be imported here, so this copy is the executable proof
 * that the two sides agree on field count, order, the `NaN` null sentinel, and the stale flag.
 */
class WatchFrameTest {

    private fun decode(bytes: ByteArray): WatchFrame? {
        if (bytes.size < WATCH_FRAME_BYTES) return null
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if (buf.get().toInt() != WATCH_FRAME_FIELD_COUNT) return null
        val flags = buf.get().toInt()
        fun lane(): Double? = buf.float.let { if (it.isNaN()) null else it.toDouble() }
        return WatchFrame(
            lane(),
            lane(),
            lane(),
            lane(),
            lane(),
            stale = flags and WATCH_FRAME_FLAG_STALE != 0,
            waiting = flags and WATCH_FRAME_FLAG_WAITING != 0,
            navBearing = lane(),
            navDistanceM = lane(),
            riderEastM = lane(),
            riderNorthM = lane(),
            courseDeg = lane(),
            routeSpanM = lane(),
        )
    }

    private fun roundTrip(frame: WatchFrame): WatchFrame? =
        decode(WatchFrameBuilder.encode(frame))

    @Test
    fun `builds from snapshot with abs speed and duty scaled to percent`() {
        val frame = WatchFrameBuilder.build(
            WatchSnapshot(
                speed = -12.5,
                dutyCycle = -0.4,
                dutyExcluded = false,
                batterySoc = 78.0,
                motorTemp = 42.0,
                ctrlTemp = 38.0,
            ),
            stale = false,
        )
        assertEquals(12.5, frame.speed!!, 0.0)
        assertEquals(40.0, frame.duty!!, 1e-3)
    }

    @Test
    fun `nav lanes round-trip, and stay null when there is no destination`() {
        val navigating = roundTrip(
            WatchFrame(
                speed = 10.0,
                duty = 30.0,
                battery = 80.0,
                motorTemp = 40.0,
                ctrlTemp = 35.0,
                stale = false,
                navBearing = 128.0,
                navDistanceM = 1350.0,
            ),
        )!!
        assertEquals(128.0, navigating.navBearing!!, 1e-3)
        assertEquals(1350.0, navigating.navDistanceM!!, 1e-3)

        val idle = roundTrip(
            WatchFrame(
                speed = 10.0,
                duty = 30.0,
                battery = 80.0,
                motorTemp = 40.0,
                ctrlTemp = 35.0,
                stale = false,
            ),
        )!!
        assertNull(idle.navBearing)
        assertNull(idle.navDistanceM)
    }

    @Test
    fun `route span round-trips as the appended compatibility lane`() {
        val frame = roundTrip(
            WatchFrame(
                speed = null,
                duty = null,
                battery = null,
                motorTemp = null,
                ctrlTemp = null,
                stale = false,
                routeSpanM = 725.0,
            ),
        )!!

        assertEquals(725.0, frame.routeSpanM!!, 1e-3)
    }

    @Test
    fun `excluded duty becomes null in the frame`() {
        val frame = WatchFrameBuilder.build(
            WatchSnapshot(
                speed = 3.0,
                dutyCycle = 0.9,
                dutyExcluded = true,
                batterySoc = 50.0,
                motorTemp = null,
                ctrlTemp = null,
            ),
            stale = false,
        )
        assertNull(frame.duty)
    }

    @Test
    fun `round-trips all fields present`() {
        val frame = WatchFrame(
            speed = 21.3,
            duty = 64.0,
            battery = 73.0,
            motorTemp = 51.0,
            ctrlTemp = 47.0,
            stale = false,
        )
        val decoded = roundTrip(frame)!!
        assertEquals(frame.speed!!, decoded.speed!!, 1e-3)
        assertEquals(frame.duty!!, decoded.duty!!, 1e-3)
        assertEquals(frame.battery!!, decoded.battery!!, 1e-3)
        assertEquals(frame.motorTemp!!, decoded.motorTemp!!, 1e-3)
        assertEquals(frame.ctrlTemp!!, decoded.ctrlTemp!!, 1e-3)
        assertEquals(false, decoded.stale)
    }

    @Test
    fun `round-trips null sentinel lanes and stale flag`() {
        val frame = WatchFrame(
            speed = 0.0,
            duty = null,
            battery = null,
            motorTemp = null,
            ctrlTemp = null,
            stale = true,
        )
        val decoded = roundTrip(frame)!!
        assertEquals(0.0, decoded.speed!!, 0.0)
        assertNull(decoded.duty)
        assertNull(decoded.battery)
        assertNull(decoded.motorTemp)
        assertNull(decoded.ctrlTemp)
        assertTrue(decoded.stale)
    }

    @Test
    fun `waiting frame round-trips with empty lanes and degrades to stale for old decoders`() {
        val decoded = roundTrip(WatchFrameBuilder.waitingFrame())!!
        assertTrue(decoded.waiting)
        // Stale is also set so a wrist decoder without the waiting bit dims instead of showing live.
        assertTrue(decoded.stale)
        assertNull(decoded.speed)
        assertNull(decoded.duty)
        assertNull(decoded.battery)
        assertNull(decoded.motorTemp)
        assertNull(decoded.ctrlTemp)
    }

    @Test
    fun `live frame does not carry the waiting bit`() {
        val decoded = roundTrip(WatchFrame(1.0, 2.0, 3.0, 4.0, 5.0, stale = false))!!
        assertEquals(false, decoded.waiting)
    }

    @Test
    fun `decode rejects a short buffer`() {
        assertNull(decode(ByteArray(WATCH_FRAME_BYTES - 1)))
    }

    @Test
    fun `decode rejects a field-count mismatch`() {
        val bytes = WatchFrameBuilder.encode(
            WatchFrame(1.0, 2.0, 3.0, 4.0, 5.0, stale = false),
        )
        bytes[0] = (WATCH_FRAME_FIELD_COUNT + 1).toByte()
        assertNull(decode(bytes))
    }
}
