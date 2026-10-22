package expo.modules.vescapecore.ow

import expo.modules.vescapecore.location.GpsDisplaySmoother
import expo.modules.vescapecore.location.GpsDisplayTelemetry
import org.junit.Assert.*
import org.junit.Test

class OwGpsDisplayTest {
    private val metersPerDegree = Math.PI / 180 * 6_371_000
    private val smoother = GpsDisplaySmoother(0.0, 100.0)
    private val display = GpsDisplayTelemetry(smoother)

    private fun fix(time: Long, meters: Double) {
        val speed = display.speedSample
        smoother.update(0.0, meters / metersPerDegree, time, true, 5.0,
            null, null, null, speed.first, speed.second, time)
    }

    private fun tick(time: Long, kmh: Double) = OwFrame(atMs = time, speedKmh = kmh, speedAtMs = time)
        .let { it.liveTick(it.toRefloatTelemetry(), 7L, emptyList(), display, time) }

    @Test fun `FM speed drives straight line prediction and brakes before next GPS fix`() {
        fix(10_000, 0.0)
        tick(10_900, 36.0)
        fix(11_000, 10.0)
        assertEquals(15.0, smoother.motion!!.positionAt(11_500).second * metersPerDegree, 0.00001)

        val brakingTick = tick(11_500, 0.0)
        assertTrue("FM tick must deliver changed motion to the map", brakingTick.containsKey("displayMotion"))
        assertEquals(7L, brakingTick["generation"])
        val stopped = smoother.motion!!
        assertEquals(stopped.positionAt(11_500), stopped.positionAt(11_900))
        assertEquals(15.0, stopped.positionAt(11_900).second * metersPerDegree, 0.00001)
    }

    @Test fun `FM GPS corrections stay smooth while prediction moves between fixes`() {
        smoother.configure(100.0, 100.0, 9_000)
        fix(10_000, 0.0)
        tick(10_900, 36.0)
        fix(11_000, 10.0)
        val motion = smoother.motion!!
        assertFalse(motion.resetPosition)
        assertEquals(10.0, motion.positionAt(11_500).second * metersPerDegree, 0.00001)
        tick(11_500, 36.0)
        assertEquals(20.0, smoother.motion!!.positionAt(12_000).second * metersPerDegree, 0.00001)
    }

    @Test fun `disconnect freezes prediction and clears FM speed for subsequent GPS fixes`() {
        fix(10_000, 0.0)
        tick(10_900, 36.0)
        fix(11_000, 10.0)
        display.clear(11_400)
        assertNull(display.speedSample.first)
        val stopped = smoother.motion!!
        assertEquals(stopped.positionAt(11_400), stopped.positionAt(11_900))
        fix(12_000, 20.0)
        assertEquals(smoother.motion!!.positionAt(12_000), smoother.motion!!.positionAt(12_500))
    }
    @Test fun `battery updates do not renew old RPM speed`() {
        fix(10_000, 0.0)
        tick(10_900, 36.0)
        fix(11_000, 10.0)
        val batteryFrame = OwFrame(atMs = 12_000, speedKmh = 36.0, speedAtMs = 10_900, batteryPercent = 80)
        val output = batteryFrame.liveTick(batteryFrame.toRefloatTelemetry(), 7L, emptyList(), display, 12_000)
        assertEquals(80.0, output["batteryPercent"])
        val motion = output["displayMotion"] as Map<*, *>
        assertEquals(0.0, motion["longitudePerMs"])
        assertEquals(19.0, smoother.motion!!.positionAt(13_000).second * metersPerDegree, 0.00001)
        fix(12_100, 20.0)
        assertEquals(smoother.motion!!.positionAt(12_100), smoother.motion!!.positionAt(12_900))
    }

    @Test fun `fresh FM tick publishes velocity and settings still control motion`() {
        fix(10_000, 0.0)
        tick(10_900, 36.0)
        fix(11_000, 10.0)
        val output = tick(11_500, -36.0)
        val motion = output["displayMotion"] as Map<*, *>
        assertEquals(10.0 / metersPerDegree / 1000.0, motion["longitudePerMs"] as Double, 1e-12)
        assertEquals(36.0, kotlin.math.abs(output["speed"] as Double), 0.0)
        smoother.configure(0.0, 0.0, 11_600)
        val stopped = smoother.motion!!
        assertEquals(stopped.positionAt(11_600), stopped.positionAt(11_900))
    }

}
