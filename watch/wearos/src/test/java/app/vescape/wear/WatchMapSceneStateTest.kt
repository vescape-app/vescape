package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchRouteNotice
import expo.modules.vescapecore.watch.WatchRoutePhase
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchTrailPoint
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchMapSceneStateTests.swift */
class WatchMapSceneStateTest {
    private val position = WatchMapPosition(50.0, 19.0)
    private val frame = WatchFrame(null, null, null, null, null, false,
        navBearing = 30.0, navDistanceM = 500.0, riderEastM = 10.0, riderNorthM = 20.0,
        courseDeg = 90.0, routeSpanM = 800.0,
        trail = listOf(WatchTrailPoint(-20.0, 0.0), WatchTrailPoint(0.0, 0.0)), mapPosition = position)
    private val group = WatchGroupRide(180.0, 1200.0, emptyList())
    private val ready = WatchRouteStatus(WatchRoutePhase.READY, 7)
    private fun scene(frame: WatchFrame = this.frame, status: WatchRouteStatus? = ready,
        group: WatchGroupRide? = this.group, ambient: Boolean = false, trail: Boolean = true) =
        WatchMapSceneState(frame, 7, status, group, ambient, trail)

    @Test fun `navigation ending falls through group and standalone without losing rider history`() {
        val navigation = scene()
        assertEquals(800f, navigation.target.spanM, 0f)
        assertEquals(90f, navigation.target.courseDeg)
        assertNotNull(navigation.navigation)
        val ended = frame.copy(navBearing = null, navDistanceM = null)
        val groupMap = scene(ended, WatchRouteStatus(WatchRoutePhase.IDLE))
        assertEquals(1200f, groupMap.target.spanM, 0f)
        assertEquals(180f, groupMap.target.courseDeg)
        assertNull(groupMap.navigation)
        assertEquals(position, groupMap.target.position)
        assertFalse(groupMap.showAbsentHint)
        val standalone = scene(ended, WatchRouteStatus(WatchRoutePhase.IDLE), group = null)
        assertEquals(800f, standalone.target.spanM, 0f)
        assertEquals(position, standalone.target.position)
        assertTrue(standalone.drawMap)
        assertFalse(standalone.showAbsentHint)
    }

    @Test fun `route replacement and missing fix show notice while group retains camera`() {
        val receiving = scene(status = ready.copy(routeId = 8))
        assertEquals(WatchRouteNotice.RECEIVING, receiving.notice)
        assertNull(receiving.navigation)
        assertEquals(1200f, receiving.target.spanM, 0f)
        assertFalse(receiving.showAbsentHint)
        val waiting = scene(frame.copy(navBearing = null, navDistanceM = null, riderEastM = null, riderNorthM = null))
        assertEquals(WatchRouteNotice.LOCATION, waiting.notice)
        assertNull(waiting.navigation)
        assertEquals(1200f, waiting.target.spanM, 0f)
        assertEquals(WatchRouteNotice.COMPUTING, scene(status = WatchRouteStatus(WatchRoutePhase.COMPUTING)).notice)
        assertEquals(WatchRouteNotice.FAILED, scene(status = WatchRouteStatus(WatchRoutePhase.FAILED)).notice)
        // Older phones have no status channel and retain the original lane-driven navigation.
        assertNotNull(scene(status = null).navigation)
    }

    @Test fun `trail setting affects telemetry only and ambient hides all moving layers`() {
        val disabled = scene(trail = false)
        assertEquals(0f, disabled.trailAlpha(0f), 0f)
        assertEquals(0.4f, disabled.trailAlpha(0.4f), 0f)
        assertEquals(1f, disabled.trailAlpha(1f), 0f)
        assertTrue(disabled.drawMap)
        assertNotNull(disabled.navigation)
        assertEquals(1f, scene().trailAlpha(0f), 0f)
        for (enabled in listOf(false, true)) {
            val ambient = scene(ambient = true, trail = enabled)
            assertFalse(ambient.drawMap)
            assertEquals(0f, ambient.trailAlpha(1f), 0f)
            assertNotNull(ambient.navigation) // Ambient retains the destination pointer, without map motion.
        }
        val empty = frame.copy(navBearing = null, navDistanceM = null, trail = emptyList())
        assertTrue(scene(empty, WatchRouteStatus(WatchRoutePhase.IDLE), group = null).showAbsentHint)
    }
}
