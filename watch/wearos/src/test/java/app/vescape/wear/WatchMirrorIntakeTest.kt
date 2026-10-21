package app.vescape.wear

import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameCodec
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchRoutePhase
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec
import expo.modules.vescapecore.watch.WatchTrailPoint
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchMirrorIntakeTests.swift */
class WatchMirrorIntakeTest {
    private val route = WatchRoute(listOf(RoutePoint(0f, 0f), RoutePoint(123f, -456f)))
    private val origin = WatchMapPosition(51.13, 16.99)
    private val frame = WatchFrame(
        speed = 21.0, duty = 40.0, battery = 80.0, motorTemp = 30.0, ctrlTemp = 25.0, stale = false,
        navBearing = 30.0, navDistanceM = 150.0, riderEastM = 12.0, riderNorthM = 20.0,
        courseDeg = 90.0, trail = listOf(WatchTrailPoint(-12.0, -20.0), WatchTrailPoint(0.0, 0.0)),
        mapPosition = WatchMapPosition(50.0, 20.0),
    )
    private fun WatchMirrorIntake.frame(value: WatchFrame = frame, at: Long, applied: Long = at) =
        acceptTelemetry(WatchMirrorReplayAdapter.telemetry(value), at, applied)

    @Test
    fun `live and replay decode navigation clearing without losing independent GPS and trail`() {
        val intake = WatchMirrorIntake()
        val routeBytes = WatchMirrorReplayAdapter.route(route, origin)!!
        intake.restoreColdState(routeBytes, mapOf(SETTING_TELEMETRY_TRAIL to false), null, null)
        intake.frame(at = 1_000)
        intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(WatchRoutePhase.READY, WatchRouteStatusCodec.routeId(routeBytes))))
        assertTrue(intake.routeStatus!!.canDraw(intake.route!!.routeId))
        assertFalse(intake.settings.telemetryTrailEnabled)
        assertEquals(frame.mapPosition, intake.mirror.frame!!.mapPosition)
        assertEquals(frame.trail, intake.mirror.frame!!.trail)

        intake.acceptRoute(null)
        intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(WatchRoutePhase.IDLE)))
        intake.frame(frame.copy(navBearing = null, navDistanceM = null, riderEastM = null, riderNorthM = null), 1_250)
        assertNull(intake.route)
        assertNull(intake.mirror.frame!!.navBearing)
        assertEquals(frame.trail, intake.mirror.frame!!.trail)
        assertEquals(frame.mapPosition, intake.mirror.frame!!.mapPosition)

        intake.frame(frame.copy(mapPosition = null, trail = emptyList()), 1_500)
        assertNull(intake.mirror.frame!!.mapPosition)
        assertTrue(intake.mirror.frame!!.trail.isEmpty())
    }

    @Test
    fun `arrival clock expires queued frames and bad frames never renew freshness`() {
        val intake = WatchMirrorIntake()
        assertTrue(intake.frame(at = 1_000, applied = 2_000))
        assertEquals(MirrorStatus.DISCONNECTED, intake.mirror.status)
        assertEquals(1_000L, intake.lastFrameAtMs)
        intake.frame(at = 2_250)
        assertEquals(MirrorStatus.LIVE, intake.mirror.status)
        assertFalse(intake.acceptTelemetry(byteArrayOf(1), 5_000, 5_000))
        assertEquals(2_250L, intake.lastFrameAtMs)
        intake.refresh(6_001)
        assertEquals(MirrorStatus.DISCONNECTED, intake.mirror.status)
        intake.frame(at = 6_250)
        assertEquals(MirrorStatus.LIVE, intake.mirror.status)
    }

    /**
     * Regression: transports deliver frames in bursts. A window sized by the last gap (~0 inside a
     * burst) dropped to the floor and blinked the mirror offline in every pause between bursts.
     */
    @Test
    fun `an outage does not widen the window after the reconnect`() {
        val intake = WatchMirrorIntake()
        var at = 1_000L
        repeat(MIRROR_CADENCE_WINDOW_GAPS) {
            at += 250
            intake.frame(at = at)
        }
        at += 60_000
        intake.frame(at = at)
        intake.frame(at = at + 250)
        // The next drop is caught at the cadence's window, not the 30 s cap.
        intake.refresh(at + 250 + 751)
        assertEquals(MirrorStatus.DISCONNECTED, intake.mirror.status)
    }

    @Test
    fun `burst delivery stays live between bursts and the window shrinks back once the cadence steadies`() {
        val intake = WatchMirrorIntake()
        for (burstAt in 1_000L..3_000L step 1_000L) repeat(3) { intake.frame(at = burstAt) }
        intake.refresh(3_900)
        assertEquals(MirrorStatus.LIVE, intake.mirror.status)
        intake.refresh(6_001)
        assertEquals(MirrorStatus.DISCONNECTED, intake.mirror.status)

        var at = 6_000L
        repeat(MIRROR_CADENCE_WINDOW_GAPS + 1) {
            at += 250
            intake.frame(at = at)
        }
        intake.refresh(at + 751)
        assertEquals(MirrorStatus.DISCONNECTED, intake.mirror.status)
    }

    @Test
    fun `disconnect clears hot status and group while cold channels survive for reconnect`() {
        val intake = WatchMirrorIntake()
        intake.acceptRoute(WatchMirrorReplayAdapter.route(route, origin))
        intake.acceptSettings(mapOf(SETTING_UNIT_SYSTEM to "imperial"))
        intake.frame(at = 1_000)
        intake.acceptRouteStatus(WatchRouteStatusCodec.encode(WatchRouteStatus(WatchRoutePhase.COMPUTING)))
        intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(90.0, 600.0, emptyList())), 1_000)
        intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(null, 600.0, emptyList())), 2_000)
        assertEquals(90.0, intake.groupRide!!.courseDeg, 0.0)
        intake.acceptGroupRide(byteArrayOf(99), 5_000)
        intake.acceptRouteStatus(byteArrayOf(99))
        intake.refresh(5_501)
        assertNull(intake.groupRide)
        assertNull(intake.routeStatus)
        assertNotNull(intake.route)
        assertEquals("imperial", intake.settings.unitSystem)
        intake.frame(at = 6_000)
        intake.acceptGroupRide(GroupRideFrameCodec.encode(GroupRideFrame(null, 600.0, emptyList())), 6_000)
        assertEquals(0.0, intake.groupRide!!.courseDeg, 0.0)
        assertEquals(MirrorStatus.LIVE, intake.mirror.status)
    }

    @Test
    fun `incremental deletion leaves other channels while empty reconnect snapshot resets all cold state`() {
        val intake = WatchMirrorIntake()
        val weather = mapOf<String, Any?>(WEATHER_TEMP_C to 17, WEATHER_FETCHED_AT to 1_000L)
        intake.restoreColdState(WatchMirrorReplayAdapter.route(route, origin), mapOf(SETTING_TELEMETRY_TRAIL to false), weather,
            mapOf(BOARD_LIGHTS_ENABLED to true, BOARD_LIGHTS_CONTROLLABLE to true))
        intake.acceptWeather(weather + (WEATHER_FETCHED_AT to 2_000L))
        assertEquals(2_000L, intake.weather!!.fetchedAtMs)
        intake.acceptSettings(null)
        assertTrue(intake.settings.telemetryTrailEnabled)
        assertNotNull(intake.route)
        assertTrue(intake.board.lightsControllable)
        intake.restoreColdState(null, null, null, null)
        assertNull(intake.route)
        assertNull(intake.weather)
        assertNull(intake.board.lightsEnabled)
        assertFalse(intake.board.lightsControllable)
        assertTrue(intake.settings.telemetryTrailEnabled)
    }

    @Test
    fun `replay route uses real fingerprint and preserves fixture geometry to wire precision`() {
        val bytes = WatchMirrorReplayAdapter.route(route, origin)!!
        val intake = WatchMirrorIntake()
        intake.acceptRoute(bytes)
        assertEquals(WatchRouteStatusCodec.routeId(bytes), intake.route!!.routeId)
        assertEquals(123f, intake.route!!.points[1].eastM, 0.12f)
        assertEquals(-456f, intake.route!!.points[1].northM, 0.12f)
        assertNull(WatchMirrorReplayAdapter.route(WatchRoute(listOf(RoutePoint(1f, 2f))), origin))
        intake.acceptRoute(byteArrayOf(99))
        assertNull(intake.route)
    }
}
