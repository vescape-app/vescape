package expo.modules.vescapecore.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchMapTilePlanTests.swift */
class WatchMapTilePlanTest {
    private val wroclaw = WatchMapPosition(51.13185, 16.98653)

    private fun rider(
        position: WatchMapPosition = wroclaw,
        courseDeg: Double? = null,
        speedMps: Double? = null,
        spanM: Double? = null,
    ) = WatchMapRider(position, courseDeg, speedMps, spanM)

    @Test fun `zoom follows span and latitude with the wrist clamp`() {
        // 600 m on 480 px is 1.25 m/px; z15 tiles are about 1.5 m/px there, a 1.2x upscale.
        assertEquals(15, watchMapTileZoom(600.0, wroclaw.latitude, null))
        assertEquals(15, watchMapTileZoom(null, wroclaw.latitude, null))
        assertEquals(16, watchMapTileZoom(300.0, wroclaw.latitude, null))
        // Clamped to the wrist's 150 m .. 2 km before choosing.
        assertEquals(watchMapTileZoom(150.0, wroclaw.latitude, null), watchMapTileZoom(10.0, wroclaw.latitude, null))
        assertEquals(watchMapTileZoom(2_000.0, wroclaw.latitude, null), watchMapTileZoom(50_000.0, wroclaw.latitude, null))
        // Ground per pixel shrinks towards the poles, so the same span needs fewer levels there.
        assertTrue(watchMapTileZoom(600.0, 0.0, null) > watchMapTileZoom(600.0, 70.0, null))
    }

    @Test fun `a held zoom survives a span near its boundary`() {
        // At Wroclaw z15 is the lowest level from about 554 m to 1107 m of span.
        assertEquals(15, watchMapTileZoom(570.0, wroclaw.latitude, null))
        assertEquals(16, watchMapTileZoom(570.0, wroclaw.latitude, 16))
        assertEquals(16, watchMapTileZoom(520.0, wroclaw.latitude, null))
        assertEquals(15, watchMapTileZoom(520.0, wroclaw.latitude, 15))
        assertEquals(14, watchMapTileZoom(1_150.0, wroclaw.latitude, null))
        assertEquals(15, watchMapTileZoom(1_150.0, wroclaw.latitude, 15))
        // Past the band the held level gives way.
        assertEquals(14, watchMapTileZoom(1_400.0, wroclaw.latitude, 15))
        assertEquals(16, watchMapTileZoom(400.0, wroclaw.latitude, 15))
    }

    @Test fun `the ring is nearest first and reaches further ahead than behind`() {
        val east = rider(courseDeg = 90.0, speedMps = 10.0)
        val ring = watchMapTileRing(east, 15)
        val here = watchMapTileRing(rider(), 15).first()
        assertEquals(here, ring.first())
        val still = watchMapTileRing(rider(), 15)
        assertTrue(ring.map { it.x }.average() > still.map { it.x }.average())
        assertTrue(ring.maxOf { it.x } >= still.maxOf { it.x })
        assertEquals(ring.size, ring.toSet().size)
        // Speed pushes the centre further than half a span: 30 s at 40 m/s is 1.2 km.
        val fast = watchMapTileRing(east.copy(speedMps = 40.0), 15)
        assertTrue(fast.maxOf { it.x } > ring.maxOf { it.x })
    }

    @Test fun `the ring wraps across the antimeridian`() {
        val ring = watchMapTileRing(rider(position = WatchMapPosition(0.0, 179.999)), 15)
        assertTrue(ring.any { it.x == (1 shl 15) - 1 })
        assertTrue(ring.any { it.x == 0 })
        assertTrue(ring.all { it.x in 0 until (1 shl 15) })
        val west = watchMapTileRing(rider(position = WatchMapPosition(0.0, -179.999), courseDeg = 270.0), 15)
        assertTrue(west.any { it.x == (1 shl 15) - 1 })
    }

    @Test fun `the cap drops least recently needed tiles behind the rider first`() {
        val north = rider(courseDeg = 0.0)
        val here = watchMapTileRing(north, 15).first()
        val behindOld = WatchMapTileNeed(WatchMapTile(15, here.x, here.y + 5), 1)
        val aheadOld = WatchMapTileNeed(WatchMapTile(15, here.x, here.y - 5), 1)
        val recentBehind = WatchMapTileNeed(WatchMapTile(15, here.x, here.y + 6), 2)
        val needed = listOf(here)
        val kept = retainWatchMapTiles(needed, listOf(behindOld, aheadOld, recentBehind), north, step = 3, cap = 3)
        assertEquals(listOf(here, recentBehind.tile, aheadOld.tile), kept.map { it.tile })
        assertEquals(3L, kept.first().neededAt)
        // Other zoom levels are not carried over.
        val other = WatchMapTileNeed(WatchMapTile(14, here.x / 2, here.y / 2), 2)
        assertFalse(retainWatchMapTiles(needed, listOf(other), north, step = 3).any { it.tile.z == 14 })
        // The plan never exceeds the cap.
        val many = (0 until 300).map { WatchMapTileNeed(WatchMapTile(15, it, 0), 1) }
        assertEquals(WATCH_MAP_TILE_CAP, retainWatchMapTiles(needed, many, north, step = 2).size)
    }

    @Test fun `the planner re-plans on a new tile, a new zoom or a sharp turn only`() {
        val planner = WatchMapTilePlanner()
        assertTrue(planner.update(rider(courseDeg = 0.0)))
        val first = planner.wanted
        assertFalse(planner.update(rider(courseDeg = 30.0)))
        assertTrue(planner.update(rider(courseDeg = 90.0)))
        assertFalse(planner.update(rider(courseDeg = 90.0, position = WatchMapPosition(wroclaw.latitude, wroclaw.longitude + 0.00001))))
        assertTrue(planner.update(rider(courseDeg = 90.0, spanM = 300.0)))
        assertTrue(planner.wanted.all { it.tile.z == 16 })
        assertTrue(first.isNotEmpty())
        // Moving a tile east keeps what was needed before, behind the fresh ring.
        val moved = WatchMapTilePlanner()
        moved.update(rider())
        val before = moved.wanted.map { it.tile }.toSet()
        assertTrue(moved.update(rider(position = WatchMapPosition(wroclaw.latitude, wroclaw.longitude + 0.02))))
        assertTrue(moved.wanted.map { it.tile }.containsAll(before))
    }

    @Test fun `tile corners and paths`() {
        val tile = WatchMapTile(1, 1, 0)
        assertEquals(0.0, tile.northWest.longitude, 0.0)
        assertEquals(180.0, tile.southEast.longitude, 0.0)
        assertEquals(0.0, tile.southEast.latitude, 1e-9)
        assertEquals(85.0511, tile.northWest.latitude, 1e-4)
        assertEquals(WatchMapTile(15, 17930, 10979), WatchMapTile.parse("15/17930/10979"))
        assertEquals(null, WatchMapTile.parse("1/2/0"))
        assertEquals(null, WatchMapTile.parse("15/x/1"))
        assertEquals("/map-tile/a/b/1/1/0", tile.path("a/b"))
        assertEquals("a/b" to tile, WatchMapTile.fromPath(tile.path("a/b")))
        assertEquals(null, WatchMapTile.fromPath("/route"))
    }
}
