package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class TiltStickTest {
    @Test
    fun `a resting thumb inside the deadzone changes nothing`() {
        assertEquals(0f, stickRatePercentPerSecond(8f, deadzonePx = 8f, fullPx = 60f, ratePercent = 10), 0f)
        assertEquals(0f, stickRatePercentPerSecond(-5f, deadzonePx = 8f, fullPx = 60f, ratePercent = 10), 0f)
    }

    @Test
    fun `rate rises with the square of deflection and caps at the rider's rate`() {
        // Halfway between the deadzone and full deflection is a quarter of the rate.
        assertEquals(2.5f, stickRatePercentPerSecond(34f, deadzonePx = 8f, fullPx = 60f, ratePercent = 10), 1e-4f)
        assertEquals(10f, stickRatePercentPerSecond(60f, deadzonePx = 8f, fullPx = 60f, ratePercent = 10), 1e-4f)
        assertEquals(10f, stickRatePercentPerSecond(500f, deadzonePx = 8f, fullPx = 60f, ratePercent = 10), 1e-4f)
        assertEquals(-40f, stickRatePercentPerSecond(-90f, deadzonePx = 8f, fullPx = 60f, ratePercent = 40), 1e-4f)
    }

    @Test
    fun `integration follows elapsed time and stops at full tilt`() {
        assertEquals(0.5f, integrateTilt(0f, 10f, 50L), 1e-4f)
        assertEquals(100f, integrateTilt(99.5f, 40f, 50L), 0f)
        assertEquals(-100f, integrateTilt(-99.5f, -40f, 50L), 0f)
    }

    @Test
    fun `a stalled frame clock cannot jump the tilt`() {
        assertEquals(2f, integrateTilt(0f, 40f, 5_000L), 1e-4f)
        assertEquals(10f, integrateTilt(10f, 40f, -16L), 0f)
    }

    @Test
    fun `percent maps onto the phone pad's wire scale around neutral`() {
        assertEquals(TILT_CENTER, tiltValue(0f))
        assertEquals(255, tiltValue(100f))
        assertEquals(255, tiltValue(150f))
        assertEquals(1, tiltValue(-100f))
        assertEquals(100f, tiltPercent(255), 1e-4f)
        assertEquals(0f, tiltPercent(TILT_CENTER), 0f)
        for (value in 1..255) assertEquals(value, tiltValue(tiltPercent(value)))
    }

    @Test
    fun `readout is a signed whole percent`() {
        assertEquals("+12%", formatTilt(12.4f))
        assertEquals("0%", formatTilt(-0.3f))
        assertEquals("-4%", formatTilt(-4f))
    }
}
