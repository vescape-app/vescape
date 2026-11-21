package expo.modules.vescapecore.navigation

import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/navigation/RouteProgressTests.swift
 */
class RouteProgressTest {
    @Test
    fun `remaining duration shrinks with progress without using rider speed`() {
        val path = listOf(0.0 to 0.0, 0.0 to 0.01)
        val length = expo.modules.vescapecore.geo.GeoMath.distanceMeters(0.0, 0.0, 0.0, 0.01)
        fun at(longitude: Double, speed: Double = 0.0) = RouteProgress.compute(path,
            0.0, longitude, speed, routeDistanceMeters = length, routeDurationSeconds = 600.0)!!
        assertEquals(600.0, at(0.0).remainingDurationSeconds!!, 0.01)
        assertEquals(300.0, at(0.005).remainingDurationSeconds!!, 0.01)
        assertEquals(at(0.005).remainingDurationSeconds, at(0.005, 20.0).remainingDurationSeconds)
        assertEquals(0.0, at(0.01).remainingDurationSeconds!!, 0.0)
        assertTrue(at(0.012).remainingMeters > 200)
        assertNull(at(0.012).remainingDurationSeconds)
        assertNull(RouteProgress.compute(path, 0.0, 0.005, 0.0)!!.remainingDurationSeconds)
    }

    @Test
    fun `split and deviation use clamped nearest segment`() {
        val path = listOf(0.0 to 0.0, 0.0 to 0.01)
        val middle = RouteProgress.compute(path, 0.001, 0.005, null)!!
        assertEquals(0, middle.segmentIndex)
        assertEquals(0.5, middle.segmentFraction, 0.000001)
        assertEquals(111.195, middle.deviationMeters, 0.1)
        val end = RouteProgress.compute(path, 0.0, 0.012, null)!!
        assertEquals(1.0, end.segmentFraction, 0.0)
        assertTrue(end.remainingMeters > 200)
        assertEquals(0.0, RouteProgress.compute(path, 0.0, -0.001, null)!!.segmentFraction, 0.0)
    }

    private val cornerPath = listOf(
        0.0 to 0.0,
        0.0 to 0.002,
        0.002 to 0.002,
    )

    private val straightPath = listOf(0.0 to 0.0, 0.0 to 0.01)

    @Test
    fun `projects onto a segment rather than onto the nearest vertex`() {
        val progress = RouteProgress.compute(straightPath, 0.0, 0.005, speedMps = null)!!

        assertEquals(0.0, progress.latitude, 1e-9)
        assertEquals(0.005, progress.longitude, 1e-9)
    }

    @Test
    fun `remaining distance is measured along the path from mid-segment`() {
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
    fun `a rider who rode past the direction point reads the straight line back to it`() {
        val pastEnd = 0.002 + 300.0 / METERS_PER_DEGREE
        val progress = RouteProgress.compute(cornerPath, pastEnd, 0.002, speedMps = 10.0)!!

        assertEquals(0.002, progress.latitude, 1e-9)
        assertEquals(300.0, progress.remainingMeters, 1.0)
        assertEquals(SOUTH, progress.bearingDeg, 1.0)
    }

    @Test
    fun `aim point follows the path around a corner rather than pointing at the target`() {
        val fifteenMetersBeforeCorner = 0.002 - 15.0 / METERS_PER_DEGREE
        val progress =
            RouteProgress.compute(cornerPath, 0.0, fifteenMetersBeforeCorner, speedMps = 10.0)!!

        assertEquals(AROUND_THE_CORNER, progress.bearingDeg, 2.0)
    }

    @Test
    fun `aim point clamps to the end of the path`() {
        val fiveMetersBeforeEnd = 0.002 - 5.0 / METERS_PER_DEGREE
        val progress = RouteProgress.compute(cornerPath, fiveMetersBeforeEnd, 0.002, speedMps = null)!!

        assertEquals(NORTH, progress.bearingDeg, 1.0)
    }

    @Test
    fun `standing on the direction point keeps the last leg's heading`() {
        val progress = RouteProgress.compute(cornerPath, 0.002, 0.002, speedMps = null)!!

        assertEquals(NORTH, progress.bearingDeg, 1.0)

        val westward = listOf(0.0 to 0.002, 0.0 to 0.0)
        val arrived = RouteProgress.compute(westward, 0.0, 0.0, speedMps = null)!!

        assertEquals(WEST, arrived.bearingDeg, 1.0)
    }

    @Test
    fun `a path that goes nowhere still yields a bearing`() {
        val progress = RouteProgress.compute(
            listOf(0.0 to 0.0, 0.0 to 0.0),
            0.0,
            0.0,
            speedMps = null,
        )!!

        assertEquals(0.0, progress.bearingDeg, 1e-9)
        assertEquals(0.0, progress.remainingMeters, 1e-9)
    }

    @Test
    fun `aim distance falls back to its floor without a speed`() {
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(null), 1e-9)
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(0.0), 1e-9)
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(2.0), 1e-9)
        assertEquals(RouteProgress.MIN_AIM_METERS, RouteProgress.aimDistanceMeters(Double.NaN), 1e-9)
    }

    @Test
    fun `aim distance scales with speed up to its cap`() {
        assertEquals(25.0, RouteProgress.aimDistanceMeters(10.0), 1e-9)
        assertEquals(RouteProgress.MAX_AIM_METERS, RouteProgress.aimDistanceMeters(30.0), 1e-9)
    }

    @Test
    fun `a path with nothing to project onto has no progress`() {
        assertNull(RouteProgress.compute(emptyList(), 0.0, 0.0, speedMps = null))
        assertNull(RouteProgress.compute(listOf(0.0 to 0.0), 0.0, 0.0, speedMps = null))
    }

    @Test
    fun `a rider far off the path still attaches, with no off-route state`() {
        val progress = RouteProgress.compute(straightPath, 0.045, 0.005, speedMps = null)!!

        assertEquals(0.005, progress.longitude, 1e-9)
        assertEquals(0.0, progress.latitude, 1e-9)
    }

    private companion object {
        const val METERS_PER_DEGREE = 111_194.9
        const val LEG_METERS = 0.002 * METERS_PER_DEGREE
        const val HALF_LEG_METERS = LEG_METERS / 2
        const val NORTH = 0.0
        const val SOUTH = 180.0
        const val WEST = 270.0
        const val AROUND_THE_CORNER = 56.3
    }
}
