package app.vescape.wear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchFrameDecoderTest {
    @Test fun `display segment roundtrips through phone encoder and wrist decoder`() {
        val motion = expo.modules.vescapecore.location.GpsDisplayMotion(52.0, 21.0, 52.001, 21.001,
            1_700_000_000_000, 1_700_000_001_000, true, 0.00000001, 0.00000002, 1_700_000_001_000)
        val snapshot = expo.modules.vescapecore.watch.WatchSnapshot(speed = 12.0, dutyCycle = null,
            dutyExcluded = false, batterySoc = null, motorTemp = null, ctrlTemp = null,
            displayMotion = motion, mapPosition = expo.modules.vescapecore.watch.WatchMapPosition(52.001, 21.001))
        val bytes = expo.modules.vescapecore.watch.WatchFrameBuilder.encode(
            expo.modules.vescapecore.watch.WatchFrameBuilder.build(snapshot, false))
        val frame = WatchFrameDecoder.decode(bytes)!!
        assertEquals(motion, frame.displayMotion)
        assertEquals(snapshot.mapPosition, frame.mapPosition)
        assertEquals(12.0, frame.speed!!, 0.0)
        val truncated = WatchFrameDecoder.decode(bytes.copyOf(bytes.size - 1))!!
        assertNull(truncated.displayMotion)
        assertEquals(12.0, truncated.speed!!, 0.0)
    }

    @Test
    fun `reads nav lanes when the phone sends them`() {
        val frame = WatchFrameDecoder.decode(encode(12.0, 20f, 80f, 33f, 5f, 42f, 1350f))!!

        assertEquals(42.0, frame.navBearing!!, 0.001)
        assertEquals(1350.0, frame.navDistanceM!!, 0.001)
    }

    @Test
    fun `a phone without nav leaves the nav lanes null so the overlay stays hidden`() {
        val frame = WatchFrameDecoder.decode(encode(12.0, 20f, 80f, 33f, 5f, Float.NaN, Float.NaN))!!

        assertNull(frame.navBearing)
        assertNull(frame.navDistanceM)
    }

    @Test
    fun `an older phone's shorter frame still decodes, just without nav`() {
        val frame = WatchFrameDecoder.decode(encode(12.0, 20f, 80f, 33f, 5f))!!

        assertEquals(12.0, frame.speed!!, 0.001)
        assertEquals(5.0, frame.ctrlTemp!!, 0.001)
        assertNull(frame.navBearing)
        assertNull(frame.routeSpanM)
    }

    @Test
    fun `reads route span appended after rider and course lanes`() {
        val frame = WatchFrameDecoder.decode(
            encode(
                12.0,
                20f,
                80f,
                33f,
                5f,
                42f,
                1350f,
                10f,
                20f,
                90f,
                725f,
            ),
        )!!

        assertEquals(725.0, frame.routeSpanM!!, 0.001)
    }

    @Test
    fun `reads remote tilt and who may drive it`() {
        val frame = WatchFrameDecoder.decode(
            encode(12.0, 20f, 80f, 33f, 5f, 42f, 1350f, 10f, 20f, 90f, 725f, 160f, 1f),
        )!!

        assertEquals(160, frame.remoteTilt)
        assertEquals(WatchTiltControl.MANUAL, frame.tiltControl)
    }

    @Test
    fun `an older phone without tilt lanes reads as no tilt`() {
        val frame = WatchFrameDecoder.decode(encode(12.0, 20f, 80f, 33f, 5f))!!

        assertNull(frame.remoteTilt)
        assertEquals(WatchTiltControl.FREE, frame.tiltControl)
    }

    /** A newer phone's reason is still a reason: read-only is the only safe reading of it. */
    @Test
    fun `an unknown tilt control code keeps the stick read-only`() {
        val frame = WatchFrameDecoder.decode(
            encode(12.0, 20f, 80f, 33f, 5f, 42f, 1350f, 10f, 20f, 90f, 725f, 128f, 9f),
        )!!

        assertEquals(false, frame.tiltControl.drivable)
    }

    @Test
    fun `a frame with fewer lanes than the required core is rejected`() {
        assertNull(WatchFrameDecoder.decode(encode(12.0, 20f, 80f, 33f)))
    }

    @Test
    fun `a truncated buffer is rejected rather than misread`() {
        val full = encode(12.0, 20f, 80f, 33f, 5f)
        assertNull(WatchFrameDecoder.decode(full.copyOf(full.size - 4)))
    }

    @Test
    fun `trail extension renders without nav and corrupt or old frames keep gauges`() {
        val core = encode(12.0, 20f, 80f, 33f, 5f, Float.NaN, Float.NaN, Float.NaN, Float.NaN, 90f, 600f, 128f, 0f)
        val points = listOf(expo.modules.vescapecore.watch.WatchTrailPoint(-20.0, -30.0), expo.modules.vescapecore.watch.WatchTrailPoint(0.0, 0.0))
        val payload = core + expo.modules.vescapecore.watch.WatchTrailCodec.encode(points)
        val decoded = WatchFrameDecoder.decode(payload)!!
        assertEquals(points, decoded.trail)
        assertNull(decoded.navBearing)
        for (bytes in listOf(core, payload.copyOf(payload.size - 1))) {
            val frame = WatchFrameDecoder.decode(bytes)!!
            assertEquals(12.0, frame.speed!!, 0.001)
            assertEquals(emptyList<expo.modules.vescapecore.watch.WatchTrailPoint>(), frame.trail)
        }
    }

    /** Encodes lane 0 (speed) plus [lanes], mirroring the phone-side writer. */
    private fun encode(speed: Double, vararg lanes: Float): ByteArray {
        val count = 1 + lanes.size
        return ByteBuffer.allocate(2 + count * 4).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(count.toByte())
            put(0)
            putFloat(speed.toFloat())
            lanes.forEach(::putFloat)
        }.array()
    }
}
