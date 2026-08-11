package expo.modules.vescapecore.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Route Progress is the number the rider reads while riding, so what matters is that it follows the
 * path rather than the crow: projecting between vertices, measuring along the line, and aiming far
 * enough ahead to be a direction rather than a jitter.
 *
 * Paths here run along the equator so a degree of longitude is a flat ~111.19 km and the expected
 * metres can be read straight off the coordinates.
 *
 * @parity /modules/vescape-core/ios/navigation/RouteProgressTests.swift
 */
class RouteProgressTest {

    /** 222 m east, then 222 m north. The corner is the only vertex between the ends. */
    private val cornerPath = listOf(
        0.0 to 0.0,
        0.0 to 0.002,
        0.002 to 0.002,
    )

    /** One long straight run east with nothing between its ends — the sparse-vertex case. */
    private val straightPath = listOf(0.0 to 0.0, 0.0 to 0.01)

    @Test
    fun `projects onto a segment rather than onto the nearest vertex`() {
        // Halfway along a 1.1 km run with no vertex near: the nearest *vertex* is 550 m away.
        val progress = RouteProgress.compute(straightPath, 0.0, 0.005, speedMps = null)!!

        assertEquals(0.0, progress.latitude, 1e-9)
        assertEquals(0.005, progress.longitude, 1e-9)
    }

    @Test
    fun `remaining distance is measured along the path from mid-segment`() {
        // Standing 55 m north of the middle of the first leg: half of it is left, plus all of the
        // second. The straight line to the target would be ~250 m — the ride is 333 m.
        val progress = RouteProgress.compute(cornerPath, 0.0005, 0.001, speedMps = null)!!

        assertEquals(0.001, progress.longitude, 1e-9)
        assertEquals(HALF_LEG_METERS + LEG_METERS, progress.remainingMeters, 1.0)
    }

    @Test
    fun `remaining distance reaches zero at the direction point`() {
        val progress = RouteProgress.compute(cornerPath, 0.002, 0.002, speedMps = null)!!

        assertEquals(0.0, progress.remainingMeters, 0.5)
    }

    @Test
    fun `aim point follows the path around a corner rather than pointing at the target`() {
        // 15 m before the corner with a 25 m aim: the aim lands past it, so the bearing is already
        // turning north while the target still lies north-east.
        val fifteenMetersBeforeCorner = 0.002 - 15.0 / METERS_PER_DEGREE
        val progress =
            RouteProgress.compute(cornerPath, 0.0, fifteenMetersBeforeCorner, speedMps = 10.0)!!

        // 15 m east to the corner, then 10 m north of it: atan2(15, 10).
        assertEquals(AROUND_THE_CORNER, progress.bearingDeg, 2.0)
    }

    @Test
    fun `aim point clamps to the end of the path`() {
        // 5 m from the end with 15 m of aim: there is nothing further along to aim at, so the aim
        // sits on the Direction Point itself and the bearing is the last leg's, not zero or NaN.
        val fiveMetersBeforeEnd = 0.002 - 5.0 / METERS_PER_DEGREE
        val progress = RouteProgress.compute(cornerPath, fiveMetersBeforeEnd, 0.002, speedMps = null)!!

        assertEquals(NORTH, progress.bearingDeg, 1.0)
    }

    @Test
    fun `aim distance falls back to its floor without a speed`() {
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(null), 1e-9)
        // A standing or crawling rider is on the floor too — 2.5 s of 2 m/s is only 5 m.
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(0.0), 1e-9)
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(2.0), 1e-9)
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(Double.NaN), 1e-9)
    }

    @Test
    fun `aim distance scales with speed up to its cap`() {
        assertEquals(25.0, RouteProgress.aimDistanceMeters(10.0), 1e-9)
        // 2.5 s of 30 m/s would be 75 m, which is past the next turn on anything but a highway.
        assertEquals(RouteProgress.MAX_AIM_METERS, RouteProgress.aimDistanceMeters(30.0), 1e-9)
    }

    @Test
    fun `a path with nothing to project onto has no progress`() {
        assertNull(RouteProgress.compute(emptyList(), 0.0, 0.0, speedMps = null))
        assertNull(RouteProgress.compute(listOf(0.0 to 0.0), 0.0, 0.0, speedMps = null))
    }

    @Test
    fun `a rider far off the path still attaches, with no off-route state`() {
        // 5 km north of the line. There is no threshold to fall outside of: the projection is taken
        // and the remaining distance is measured from it like any other fix.
        val progress = RouteProgress.compute(straightPath, 0.045, 0.005, speedMps = null)!!

        assertEquals(0.005, progress.longitude, 1e-9)
        assertEquals(0.0, progress.latitude, 1e-9)
    }

    private companion object {
        const val METERS_PER_DEGREE = 111_194.9
        const val LEG_METERS = 0.002 * METERS_PER_DEGREE
        const val HALF_LEG_METERS = LEG_METERS / 2
        const val NORTH = 0.0
        const val AROUND_THE_CORNER = 56.3
    }
}
