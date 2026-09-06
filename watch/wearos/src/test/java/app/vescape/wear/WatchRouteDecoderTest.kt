package app.vescape.wear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchRouteDecoderTest {
    @Test
    fun `points decode as metres east and north of the origin`() {
        // ~0.001 deg north then ~0.001 deg east of 52 N.
        val route = WatchRouteDecoder.decode(encode(52.0, 21.0, 1_000 to 0, 0 to 1_000))!!

        assertEquals(3, route.points.size)
        assertEquals(0f, route.points[0].eastM, 0.001f)
        assertEquals(110.6f, route.points[1].northM, 0.5f)
        // Longitude metres shrink with the cosine of the origin latitude.
        assertEquals(68.5f, route.points[2].eastM, 0.5f)
        assertEquals(route.points[1].northM, route.points[2].northM, 0.001f)
    }

    @Test
    fun `a future wire version is refused rather than misread`() {
        val bytes = encode(52.0, 21.0, 1_000 to 0)
        bytes[0] = 9

        assertNull(WatchRouteDecoder.decode(bytes))
    }

    @Test
    fun `a truncated buffer is refused`() {
        val full = encode(52.0, 21.0, 1_000 to 0, 0 to 1_000)

        assertNull(WatchRouteDecoder.decode(full.copyOf(full.size - 4)))
    }

    /** Mirrors the phone-side `WatchRouteEncoder`: header then micro-degree deltas. */
    private fun encode(lat: Double, lon: Double, vararg deltas: Pair<Int, Int>): ByteArray =
        ByteBuffer.allocate(19 + deltas.size * 8).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(1)
            putShort((deltas.size + 1).toShort())
            putDouble(lat)
            putDouble(lon)
            deltas.forEach { (dLat, dLon) ->
                putInt(dLat)
                putInt(dLon)
            }
        }.array()
}
