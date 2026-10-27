package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Test
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchTrailPoint

/** @parity /modules/vescape-core/ios/watch/WatchMapViewTests.swift */
class WatchMapViewTest {
    @Test
    fun `course crosses north using shortest turn`() {
        assertEquals(1f, shortestAngleDelta(359f, 0f), 0.001f)
        assertEquals(-1f, shortestAngleDelta(0f, 359f), 0.001f)
    }

    @Test
    fun `course handles unwrapped animation values`() {
        assertEquals(2f, shortestAngleDelta(719f, 1f), 0.001f)
        assertEquals(-20f, shortestAngleDelta(-170f, 170f), 0.001f)
    }

    private fun position(north: Double) = WatchMapPosition(north / 110_574.0, 0.0)

    @Test fun `route and trail stay aligned throughout a fix and tip stays pinned`() {
        val motion = WatchMapMotion().retarget(position(0.0), 0, true).retarget(position(10.0), 1000, true)
        val trail = listOf(WatchTrailPoint(0.0, -30.0), WatchTrailPoint(0.0, -10.0), WatchTrailPoint(0.0, 0.0))
        for (time in listOf(1000L, 1075L, 1150L, 1225L, 1300L)) {
            val offset = motion.offsetAt(time)
            val rendered = movingTrail(trail, offset)
            // Route point at -20m, new rider at +10m. Both layers draw that same world point.
            assertEquals(-20.0 - (10.0 - offset.northM), rendered.first().northM, 0.0001)
            assertEquals(WatchTrailPoint(0.0, 0.0), rendered.last())
            assertEquals(true, rendered.all { it.northM <= 0 })
        }
        assertEquals(5.0, motion.offsetAt(1150).northM, 0.0001)
    }

    @Test fun `new fix mid animation preserves camera position and repeated ticks do not restart`() {
        val first = WatchMapMotion().retarget(position(0.0), 0, true).retarget(position(10.0), 1000, true)
        val next = first.retarget(position(20.0), 1150, true)
        assertEquals(15.0, next.offsetAt(1150).northM, 0.0001)
        assertEquals(next, next.retarget(position(20.0), 1200, true))
        assertEquals(0.0, next.offsetAt(1450).northM, 0.0001)
        assertEquals(0.0, next.retarget(position(20.0), 1200, false).offsetAt(1200).northM, 0.0001)
    }

    @Test fun `missing fix resets motion and a fresh fix never flies from the previous ride`() {
        val moving = WatchMapMotion().retarget(position(0.0), 0, true).retarget(position(10.0), 1000, true)
        val cleared = moving.retarget(null, 1100, true)
        assertEquals(0.0, cleared.offsetAt(1100).northM, 0.0001)
        assertEquals(0.0, cleared.retarget(position(1000.0), 1200, true).offsetAt(1200).northM, 0.0001)
    }
    @Test fun `a sampled U turn never erases retained history during camera motion`() {
        val trail = listOf(-100.0, -50.0, -2.0, 0.0).map { WatchTrailPoint(it, 0.0) }
        for (east in listOf(-1.0, -0.5, -0.01, 0.0)) {
            val rendered = movingTrail(trail, WatchTrailPoint(east, 0.0))
            assertEquals(trail.size, rendered.size)
            for (i in 0 until trail.lastIndex) {
                assertEquals(trail[i].eastM + east, rendered[i].eastM, 0.0001)
            }
            assertEquals(WatchTrailPoint(0.0, 0.0), rendered.last())
        }
    }

    @Test fun `only the pending distance at the trail tip is trimmed`() {
        val trail = listOf(-100.0, -10.0, -2.0, -1.0, 0.0).map { WatchTrailPoint(it, 0.0) }
        val rendered = movingTrail(trail, WatchTrailPoint(3.0, 0.0))
        assertEquals(listOf(-97.0, -7.0, 0.0), rendered.map { it.eastM })
    }

}
