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
        route: WatchMapRouteProgress? = null,
    ) = WatchMapRider(position, courseDeg, speedMps, spanM, route)

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

    @Test fun `the level a zoom change left stays behind the current levels, within the cap`() {
        val north = rider(courseDeg = 0.0)
        val here = watchMapTileRing(north, 15).first()
        val sameZoom = WatchMapTileNeed(WatchMapTile(15, here.x, here.y - 3), 1)
        val previous = WatchMapTileNeed(WatchMapTile(16, here.x * 2, here.y * 2), 2)
        val older = WatchMapTileNeed(WatchMapTile(17, here.x * 4, here.y * 4), 2)
        val kept = retainWatchMapTiles(listOf(here), listOf(previous, older, sameZoom), north, step = 3, previousZoom = 16)
        assertEquals(listOf(here, sameZoom.tile, previous.tile), kept.map { it.tile })
        assertEquals(listOf(here, sameZoom.tile), retainWatchMapTiles(listOf(here), listOf(previous, sameZoom), north, step = 3, cap = 2, previousZoom = 16).map { it.tile })
    }

    @Test fun `each step also wants the tiles one zoom out, first`() {
        val needed = watchMapTileNeeded(rider(courseDeg = 0.0), 15)
        val out = needed.takeWhile { it.z == 14 }
        assertTrue(out.size in 1..9)
        val face = watchMapTileRing(rider(courseDeg = 0.0), 15, lookahead = false)
        assertEquals(face, needed.drop(out.size).take(face.size))
        assertEquals(needed.size, needed.toSet().size)
        // Every tile at the planned level is a quarter of a planned one-out tile.
        val outAll = needed.filter { it.z == 14 }.toSet()
        assertTrue(needed.filter { it.z == 15 }.all { it.parent in outAll })
    }

    @Test fun `speed never pushes the face around the rider out of the plan`() {
        val fast = rider(courseDeg = 90.0, speedMps = 15.0, spanM = 150.0)
        val zoom = watchMapTileZoom(150.0, wroclaw.latitude, null)
        val here = watchMapTileRing(rider(spanM = 150.0), zoom).first()
        // 30 s at 15 m/s centres the ring 450 m ahead, three spans: it misses the rider's tile.
        assertFalse(here in watchMapTileRing(fast, zoom))
        val needed = watchMapTileNeeded(fast, zoom)
        assertEquals(here.parent, needed.first())
        assertEquals(here, needed.first { it.z == zoom })
    }

    @Test fun `a zoom change keeps a level on the wrist that covers the face`() {
        val planner = WatchMapTilePlanner()
        planner.update(rider(spanM = 600.0))
        val z15 = planner.wanted.map { it.tile }.filter { it.z == 15 }
        // Zoom in: the old level is now the one-out level, still wanted.
        planner.update(rider(spanM = 300.0))
        var wanted = planner.wanted.map { it.tile }
        assertTrue(wanted.containsAll(z15))
        assertTrue(wanted.any { it.z == 16 })
        assertTrue(wanted.none { it.z == 14 })
        // Zoom back out: the z16 tiles stay as the previous level, behind z15 and z14.
        val z16 = wanted.filter { it.z == 16 }
        planner.update(rider(spanM = 800.0))
        wanted = planner.wanted.map { it.tile }
        assertTrue(wanted.containsAll(z16))
        assertTrue(wanted.any { it.z == 14 })
        assertTrue(wanted.indexOfFirst { it.z == 16 } > wanted.indexOfLast { it.z != 16 })
        // Two levels out: z16 is no longer the level just left.
        planner.update(rider(spanM = 1_400.0))
        assertTrue(planner.wanted.none { it.tile.z == 16 })
        assertTrue(planner.wanted.size <= WATCH_MAP_TILE_CAP)
    }

    @Test fun `the wrist fills each cell with its tile, else the one-out quarter, else the level a zoom-out left`() {
        val own = WatchMapTile(16, 100, 200)
        val quarter = WatchMapTile(16, 101, 200)
        val zoomedOut = WatchMapTile(16, 102, 200)
        val empty = WatchMapTile(16, 104, 200)
        val parent = WatchMapTile(15, 50, 100)
        val finer = zoomedOut.children.take(2)
        val cache = WatchMapTileCache<String>()
        (listOf(own, parent) + finer).forEach { cache.put(it, it.key) }
        val frame = cache.frame(listOf(own, quarter, zoomedOut, empty), held = setOf(own, quarter, parent, zoomedOut) + finer)
        // One-out tiles go under, so the cell with its own tile covers that quarter of the parent.
        assertEquals(listOf(parent, own) + finer, frame.draw)
        // Each cell waits on its own tile only; fallbacks are drawn when decoded, never decoded for it.
        assertEquals(listOf(quarter, zoomedOut), frame.missing)
        assertTrue(cache.frame(listOf(empty), emptySet()).draw.isEmpty())
    }

    @Test fun `a cell without its own tile waits on the one-out tile, else on the held tiles one in`() {
        val cell = WatchMapTile(16, 100, 200)
        val cache = WatchMapTileCache<String>()
        assertEquals(listOf(cell.parent), cache.frame(listOf(cell), held = setOf(cell.parent!!) + cell.children).missing)
        assertEquals(cell.children.take(3), cache.frame(listOf(cell), held = cell.children.take(3).toSet()).missing)
    }

    @Test fun `a decode is kept when the face already pins a full cache`() {
        // Zoomed out: 12 old-level tiles fill three new cells as one-in fallbacks.
        val cells = (0 until 3).map { WatchMapTile(15, 50 + it, 100) }
        val finer = cells.flatMap { it.children }
        val cache = WatchMapTileCache<String>()
        finer.forEach { cache.put(it, it.key) }
        val held = (cells + finer).toSet()
        assertEquals(cells, cache.frame(cells, held).missing)
        cache.put(cells[0], cells[0].key)
        // Neither the new tile nor anything on screen is evicted, so the next frame does not decode it again.
        val next = cache.frame(cells, held)
        assertEquals(cells.drop(1), next.missing)
        assertEquals(listOf(cells[0]) + finer.drop(4), next.draw)
        assertTrue((cells.take(1) + finer).all { cache[it] != null })
    }

    @Test fun `cells come from held tiles at the level, one out and one in`() {
        val cells = watchMapTileCells(listOf(WatchMapTile(15, 50, 100), WatchMapTile(16, 300, 300), WatchMapTile(17, 20, 20), WatchMapTile(18, 1, 1)), 16)
        assertEquals(WatchMapTile(15, 50, 100).children.toSet() + WatchMapTile(16, 300, 300) + WatchMapTile(16, 10, 10), cells)
    }

    @Test fun `the planner re-plans on a new tile, a new zoom or a sharp turn only`() {
        val planner = WatchMapTilePlanner()
        assertTrue(planner.update(rider(courseDeg = 0.0)))
        val first = planner.wanted
        assertFalse(planner.update(rider(courseDeg = 30.0)))
        assertTrue(planner.update(rider(courseDeg = 90.0)))
        assertFalse(planner.update(rider(courseDeg = 90.0, position = WatchMapPosition(wroclaw.latitude, wroclaw.longitude + 0.00001))))
        assertTrue(planner.update(rider(courseDeg = 90.0, spanM = 300.0)))
        assertEquals(setOf(15, 16), planner.wanted.map { it.tile.z }.toSet())
        assertTrue(first.isNotEmpty())
        // Moving a tile east keeps what was needed before, behind the fresh ring.
        val moved = WatchMapTilePlanner()
        moved.update(rider())
        val before = moved.wanted.map { it.tile }.toSet()
        assertTrue(moved.update(rider(position = WatchMapPosition(wroclaw.latitude, wroclaw.longitude + 0.02))))
        assertTrue(moved.wanted.map { it.tile }.containsAll(before))
    }

    @Test fun `the route anchor crosses the antimeridian the short way`() {
        val route = WatchMapRoute(listOf(WatchMapPosition(0.0, 179.9), WatchMapPosition(0.0, -179.9)))
        assertEquals(-179.95, route.pointBefore(route.lengthM / 4)!!.second.longitude, 1e-6)
    }

    /** A straight path east from Wroclaw, about 21 km, and the rider [doneM] along it. */
    private fun eastRoute(doneM: Double): Pair<WatchMapRider, WatchMapRoute> {
        val route = WatchMapRoute((0..30).map { WatchMapPosition(wroclaw.latitude, wroclaw.longitude + it * 0.01) })
        val at = route.pointBefore(route.lengthM - doneM)!!.second
        return rider(position = at, courseDeg = 90.0, route = WatchMapRouteProgress(route, route.lengthM - doneM)) to route
    }

    @Test fun `route tiles run ahead of the rider's progress, nearest along the path first`() {
        val (onRoute, _) = eastRoute(5_000.0)
        val tiles = watchMapRouteTiles(onRoute, 15)
        val here = watchMapTileRing(rider(position = onRoute.position), 15).first()
        assertEquals(here, tiles.first())
        // Ahead only: nothing west of the corridor around the progress point.
        assertTrue(tiles.all { it.x >= here.x - 1 })
        // Walked in order: columns never step back by more than the corridor.
        tiles.zipWithNext().forEach { (a, b) -> assertTrue(b.x >= a.x - 1) }
        // The corridor covers the path itself to its end.
        val end = watchMapTileRing(rider(position = WatchMapPosition(wroclaw.latitude, wroclaw.longitude + 0.3)), 15).first()
        assertTrue(end in tiles)
        assertTrue((here.x..end.x).all { WatchMapTile(15, it, here.y) in tiles })
        assertEquals(tiles.size, tiles.toSet().size)
        assertEquals(10, watchMapRouteTiles(onRoute, 15, limit = 10).size)
        assertTrue(watchMapRouteTiles(rider(), 15).isEmpty())
    }

    @Test fun `route tiles follow the ring and share its cap`() {
        val (onRoute, _) = eastRoute(5_000.0)
        val planner = WatchMapTilePlanner(cap = 40)
        planner.update(onRoute)
        val ring = watchMapTileNeeded(onRoute, 15)
        val wanted = planner.wanted
        assertEquals(40, wanted.size)
        // The ring goes first, untouched by the route; route tiles fill the rest, not the ring.
        assertEquals(ring, wanted.take(ring.size).map { it.tile })
        assertTrue(wanted.take(ring.size).none { it.route })
        assertTrue(wanted.drop(ring.size).all { it.route && it.tile !in ring })
        assertEquals(watchMapRouteTiles(onRoute, 15).filter { it !in ring }.take(40 - ring.size), wanted.drop(ring.size).map { it.tile })
    }

    @Test fun `route tiles re-plan with progress and leave with the route`() {
        val (start, route) = eastRoute(5_000.0)
        val planner = WatchMapTilePlanner()
        assertTrue(planner.update(start))
        // Same rider tile, same progress tile: nothing to do.
        assertFalse(planner.update(start.copy(route = WatchMapRouteProgress(route, route.lengthM - 5_010.0))))
        // A new route object with the same path is a reroute.
        assertTrue(planner.update(start.copy(route = WatchMapRouteProgress(WatchMapRoute(route.points), route.lengthM - 5_000.0))))
        val routeTiles = planner.wanted.filter { it.route }.map { it.tile }
        assertTrue(routeTiles.isNotEmpty())
        // Clearing Navigation takes every route-only tile off the list at once.
        assertTrue(planner.update(start.copy(route = null)))
        assertTrue(planner.wanted.none { it.route || it.tile in routeTiles })
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
