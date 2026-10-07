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
        group: WatchGroupRide? = this.group, ambient: Boolean = false, trail: Boolean = true, groupOnTelemetry: Boolean = true,
        routeOnTelemetry: Boolean = true, streetMap: Boolean = true, mapGauges: Int = 60) =
        WatchMapSceneState(frame, 7, status, group, ambient, trail, groupOnTelemetry, routeOnTelemetry, streetMap, mapGauges)

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
        val standalone = scene(ended, WatchRouteStatus(WatchRoutePhase.IDLE), group = null)
        assertEquals(800f, standalone.target.spanM, 0f)
        assertEquals(position, standalone.target.position)
        assertTrue(standalone.drawMap)
    }

    @Test fun `route replacement and missing fix show notice while group retains camera`() {
        val receiving = scene(status = ready.copy(routeId = 8))
        assertEquals(WatchRouteNotice.RECEIVING, receiving.notice)
        assertNull(receiving.navigation)
        assertEquals(1200f, receiving.target.spanM, 0f)
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
    }

    @Test fun `street map dims behind the gauges and leaves in ambient`() {
        assertEquals(0.6f, scene().mapAlpha(0f), 1e-6f)
        assertEquals(1f, scene().mapAlpha(1f), 0f)
        assertEquals(1f, scene(trail = false).mapAlpha(2f), 0f)
        assertEquals(0f, scene(ambient = true).mapAlpha(1f), 0f)
    }

    /** Issue #557: Map behind gauges sets the gauge page opacity; the map page stays full. */
    @Test fun `map behind gauges sets the gauge page opacity only`() {
        assertEquals(0.3f, scene(mapGauges = 30).mapAlpha(0f), 1e-6f)
        assertEquals(0.9f, scene(mapGauges = 90).mapAlpha(0f), 1e-6f)
        assertEquals(0.65f, scene(mapGauges = 30).mapAlpha(0.5f), 1e-6f)
        assertEquals(1f, scene(mapGauges = 30).mapAlpha(1f), 0f)
        assertEquals(0f, scene(mapGauges = 90, ambient = true).mapAlpha(0f), 0f)
    }

    /** Issue #536: Group Ride marks leave the telemetry screen only; the map page fades them in. */
    @Test fun `group setting affects telemetry only and ambient hides it`() {
        val off = scene(groupOnTelemetry = false)
        assertEquals(0f, off.groupAlpha(0f), 0f)
        assertEquals(0.4f, off.groupAlpha(0.4f), 0f)
        assertEquals(1f, off.groupAlpha(1f), 0f)
        assertEquals(1f, off.trailAlpha(0f), 0f)
        assertEquals(1f, scene().groupAlpha(0f), 0f)
        assertEquals(0f, scene(ambient = true).groupAlpha(1f), 0f)
    }

    /** Issue #558: the route line leaves the telemetry screen only; the map page fades it in. */
    @Test fun `route setting affects telemetry only and ambient hides it`() {
        val off = scene(routeOnTelemetry = false)
        assertEquals(0f, off.routeAlpha(0f), 0f)
        assertEquals(0.4f, off.routeAlpha(0.4f), 0f)
        assertEquals(1f, off.routeAlpha(1f), 0f)
        assertNotNull(off.navigation)
        assertEquals(1f, off.trailAlpha(0f), 0f)
        assertEquals(1f, scene().routeAlpha(0f), 0f)
        assertEquals(0f, scene(ambient = true).routeAlpha(1f), 0f)
    }

    /** Issue #557 + #536: the Off step hides the street map behind the gauges only. */
    @Test fun `map behind gauges off fades the street map in on the map page`() {
        val off = scene(mapGauges = 0)
        assertTrue(off.drawStreetMap)
        assertEquals(0f, off.mapAlpha(0f), 0f)
        assertEquals(0.5f, off.mapAlpha(0.5f), 1e-6f)
        assertEquals(1f, off.mapAlpha(1f), 0f)
    }

    /** Issues #536 + #558: the rider circle leaves the telemetry screen only once every layer there is off. */
    @Test fun `rider circle leaves the gauges only when every telemetry layer is off`() {
        assertEquals(1f, scene().riderAlpha(0f), 0f)
        assertEquals(1f, scene(trail = false, groupOnTelemetry = false, routeOnTelemetry = false).riderAlpha(0f), 0f)
        assertEquals(1f, scene(trail = false, groupOnTelemetry = false, mapGauges = 0).riderAlpha(0f), 0f)
        assertEquals(1f, scene(trail = false, routeOnTelemetry = false, mapGauges = 0).riderAlpha(0f), 0f)
        assertEquals(1f, scene(groupOnTelemetry = false, routeOnTelemetry = false, mapGauges = 0).riderAlpha(0f), 0f)
        for (clean in listOf(scene(trail = false, groupOnTelemetry = false, routeOnTelemetry = false, mapGauges = 0),
            scene(trail = false, groupOnTelemetry = false, routeOnTelemetry = false, streetMap = false))) {
            assertEquals(0f, clean.riderAlpha(0f), 0f)
            assertEquals(0.4f, clean.riderAlpha(0.4f), 0f)
            assertEquals(1f, clean.riderAlpha(1f), 0f)
        }
        assertEquals(0f, scene(ambient = true).riderAlpha(1f), 0f)
    }

    @Test fun `street map setting off hides only the street map`() {
        val off = scene(streetMap = false)
        assertFalse(off.drawStreetMap)
        assertEquals(0f, off.mapAlpha(1f), 0f)
        assertTrue(off.drawMap) // Route, trail and Group Ride marks keep drawing.
        assertEquals(1f, off.trailAlpha(0f), 0f)
        assertTrue(scene().drawStreetMap)
    }
}
