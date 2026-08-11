package app.vescape.wear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchFrameDecoderTest {
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
