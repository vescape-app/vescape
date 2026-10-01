package expo.modules.vescapecore.watch

import org.junit.Assert.*
import org.junit.Test

class WatchTrailTest {
    @Test fun `snapshot is relative to current rider and retains both ends when bounded`() {
        val rider = GeoPoint(52.0, 21.0)
        val history = (0..500).map { mapOf<String, Any?>("latitude" to 52.0, "longitude" to 21.0 + it * 0.00001) }
        val trail = watchTrail(rider, history)
        assertEquals(120, trail.size)
        assertEquals(WatchTrailPoint(0.0, 0.0), trail.first())
        assertEquals(offsetMeters(rider, GeoPoint(52.0, 21.005)).first, trail.last().eastM, 0.001)
        val moved = watchTrail(GeoPoint(52.0, 21.005), history)
        assertEquals(0.0, moved.last().eastM, 0.001)
        assertTrue(moved.first().eastM < 0)
        assertTrue(watchTrail(null, history).isEmpty())
        assertTrue(watchTrail(rider, emptyList()).isEmpty())
    }

    @Test fun `wire contract and malformed extensions`() {
        val points = listOf(WatchTrailPoint(1.0, -2.0))
        val expected = byteArrayOf(84, 82, 2, 1, 0, 0, 0, 0, 0, 0, -16, 63, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, -128, 63, 0, 0, 0, -64)
        assertArrayEquals(expected, WatchTrailCodec.encode(points, WatchMapPosition(1.0, 2.0)))
        assertEquals(points, WatchTrailCodec.decode(expected, 0).points)
        assertEquals(WatchMapPosition(1.0, 2.0), WatchTrailCodec.decode(expected, 0).position)
        assertEquals(points, WatchTrailCodec.decode(byteArrayOf(0, 0) + expected, 2).points)
        assertTrue(WatchTrailCodec.decode(expected.copyOf(27), 0).points.isEmpty())
        assertTrue(WatchTrailCodec.decode(expected.clone().apply { this[2] = 99 }, 0).points.isEmpty())
        assertTrue(WatchTrailCodec.decode(expected.clone().apply { this[3] = 121 }, 0).points.isEmpty())
        assertTrue(WatchTrailCodec.decode(WatchTrailCodec.encode(listOf(WatchTrailPoint(Double.NaN, 0.0))), 0).points.isEmpty())
    }

    @Test fun `full phone frame carries authoritative trail and explicit clear`() {
        val trail = listOf(WatchTrailPoint(-10.0, -20.0), WatchTrailPoint(0.0, 0.0))
        val snapshot = WatchSnapshot(null, null, false, null, null, null, trail = trail, mapPosition = WatchMapPosition(52.0, 21.0))
        val frame = WatchFrameBuilder.build(snapshot, stale = false)
        val bytes = WatchFrameBuilder.encode(frame)
        assertEquals(13, bytes[0].toInt())
        assertEquals(snapshot.mapPosition, WatchTrailCodec.decode(bytes, WATCH_FRAME_BYTES).position)
        assertEquals(trail, WatchTrailCodec.decode(bytes, WATCH_FRAME_BYTES).points)
        assertTrue(WatchTrailCodec.decode(WatchFrameBuilder.encode(frame.copy(trail = emptyList())), WATCH_FRAME_BYTES).points.isEmpty())
    }
}
