package expo.modules.vescapecore.location

import org.junit.Assert.*
import org.junit.Test

class GpsDisplaySmootherTest {
    private val metersPerDegree = Math.PI / 180 * 6_371_000
    private fun fix(s: GpsDisplaySmoother, time: Long, meters: Double, speed: Double = 10.0) =
        s.update(0.0, meters / metersPerDegree, time, true, 5.0, speed, 180.0, time, speed, time, time)!!

    @Test fun `full prediction continuously follows VESC and zero smoothing snaps GPS`() {
        val s = GpsDisplaySmoother(0.0, 100.0)
        fix(s, 10_000, 0.0)
        val m = fix(s, 11_000, 10.0)
        assertTrue(m.resetPosition)
        for (elapsed in 0L..1000L step 100) assertEquals(10 + elapsed / 100.0,
            m.positionAt(11_000 + elapsed).second * metersPerDegree, 0.00001)
        val next = fix(s, 12_000, 19.0)
        assertEquals(19.0, next.positionAt(12_000).second * metersPerDegree, 0.00001)
        assertEquals(24.0, next.positionAt(12_500).second * metersPerDegree, 0.00001)
    }
    @Test fun `braking before GPS is immediate and stale BLE freezes`() {
        val s = GpsDisplaySmoother(0.0, 100.0)
        fix(s, 10_000, 0.0); fix(s, 11_000, 10.0)
        val before = s.motion!!.positionAt(11_400)
        val stopped = s.updateSpeed(0.0, 11_400, 11_400)!!
        assertFalse(stopped.resetPosition)
        assertEquals(before.second, stopped.positionAt(11_900).second, 1e-12)
        val moving = s.updateSpeed(10.0, 11_900, 11_900)!!
        assertEquals(moving.positionAt(12_900), moving.positionAt(99_000))
    }
    @Test fun `GPS loss freezes even when telemetry remains fresh`() {
        val s = GpsDisplaySmoother(0.0, 100.0)
        fix(s, 10_000, 0.0); fix(s, 11_000, 10.0)
        for (t in 11_500L..18_000L step 500) s.updateSpeed(10.0, t, t)
        assertEquals(60.0, s.motion!!.positionAt(18_000).second * metersPerDegree, 0.00001)
    }
    @Test fun `GPS correction and prediction are independent and settings preserve position`() {
        val s = GpsDisplaySmoother(100.0, 25.0)
        fix(s, 10_000, 0.0)
        val m = fix(s, 11_000, 10.0)
        assertFalse(m.resetPosition)
        assertEquals(6.25, m.positionAt(11_500).second * metersPerDegree, 0.00001)
        val stopped = s.updateSpeed(0.0, 11_500, 11_500)!!
        assertEquals(m.positionAt(11_500).second, stopped.positionAt(11_500).second, 1e-12)
        assertEquals(11.25, stopped.positionAt(12_000).second * metersPerDegree, 0.00001)
        val settings = s.configure(0.0, 100.0, 11_750)!!
        assertFalse(settings.resetPosition)
        assertEquals(stopped.positionAt(11_750).second, settings.positionAt(11_750).second, 1e-12)
    }
    @Test fun `first fix has no invented direction and antimeridian stays short`() {
        val s = GpsDisplaySmoother(0.0, 100.0)
        val first = fix(s, 10_000, 0.0)
        assertEquals(first.toLongitude, first.positionAt(10_500).second, 0.0)
        val m = GpsDisplayMotion(0.0, 179.0, 0.0, -179.0, 0, 1000)
        assertEquals(-180.0, m.positionAt(500).second, 0.0)
        s.reset(); assertNull(s.motion)
    }
}
