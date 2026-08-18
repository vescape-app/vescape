package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchRouteTest {
    @Test
    fun `an empty route encodes to nothing, so absence is a clear and not an empty item`() {
        assertNull(WatchRouteEncoder.encode(emptyList()))
    }

    @Test
    fun `the first point is the origin and the rest ride as micro-degree deltas`() {
        val bytes = WatchRouteEncoder.encode(
            listOf(GeoPoint(52.0, 21.0), GeoPoint(52.001, 21.0), GeoPoint(52.001, 21.002)),
        )!!
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

        assertEquals(WATCH_ROUTE_VERSION, buf.get().toInt())
        assertEquals(3, buf.short.toInt())
        assertEquals(52.0, buf.double, 1e-9)
        assertEquals(21.0, buf.double, 1e-9)
        assertEquals(1_000, buf.int)
        assertEquals(0, buf.int)
        assertEquals(0, buf.int)
        assertEquals(2_000, buf.int)
    }

    @Test
    fun `rounding does not accumulate along a long route`() {
        // Each hop is half a micro-degree, so naive per-hop rounding would drift a full step per point.
        val points = (0..500).map { GeoPoint(52.0 + it * 0.0000005, 21.0) }
        val bytes = WatchRouteEncoder.encode(points)!!
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).apply { position(19) }

        var total = 0L
        repeat(points.size - 1) {
            total += buf.int
            buf.int
        }
        assertEquals(250L, total)
    }

    @Test
    fun `an over-long route is thinned to the cap, keeping both ends`() {
        val points = (0..WATCH_ROUTE_MAX_POINTS * 2).map { GeoPoint(52.0 + it * 0.00001, 21.0) }
        val bytes = WatchRouteEncoder.encode(points)!!
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

        assertEquals(WATCH_ROUTE_VERSION, buf.get().toInt())
        assertEquals(WATCH_ROUTE_MAX_POINTS, buf.short.toInt() and 0xFFFF)
        assertEquals(points.first().lat, buf.double, 1e-9)
        buf.double
        var lat = 0L
        repeat(WATCH_ROUTE_MAX_POINTS - 1) {
            lat += buf.int
            buf.int
        }
        val endLat = points.first().lat + lat / 1_000_000.0
        assertTrue(abs(endLat - points.last().lat) < 1e-5)
    }

    @Test
    fun `offsets are metres east and north of the origin`() {
        val (east, north) = offsetMeters(GeoPoint(52.0, 21.0), GeoPoint(52.001, 21.001))

        assertEquals(110.6, north, 0.5)
        assertEquals(68.5, east, 0.5)
    }
}
