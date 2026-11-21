package expo.modules.vescapecore.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/location/GpsPowerModeTests.swift
 */
class GpsPowerModeTest {
    private fun resolve(
        appVisible: Boolean = false,
        riding: Boolean = false,
        watchNavigating: Boolean = false,
        replayOwnsPosition: Boolean = false,
        manualPublicRide: Boolean = false,
    ) = GpsDemand.resolve(
        appVisible = appVisible,
        riding = riding,
        watchNavigating = watchNavigating,
        replayOwnsPosition = replayOwnsPosition,
        manualPublicRide = manualPublicRide,
    )

    @Test
    fun `backgrounded with no ride costs nothing`() {
        assertEquals(GpsPowerMode.Off, resolve())
    }

    @Test
    fun `watching the map gets foreground grade fixes`() {
        assertEquals(GpsPowerMode.Map, resolve(appVisible = true))
    }

    @Test
    fun `riding gets background grade fixes with the phone away`() {
        assertEquals(GpsPowerMode.Ride, resolve(appVisible = false, riding = true))
    }

    @Test
    fun `riding outranks merely watching`() {
        assertEquals(GpsPowerMode.Ride, resolve(appVisible = true, riding = true))
    }

    @Test
    fun `watch navigation pays for background fixes`() {
        assertEquals(GpsPowerMode.Ride, resolve(watchNavigating = true))
    }

    @Test
    fun `manual public ride pays for background fixes`() {
        assertEquals(GpsPowerMode.Ride, resolve(manualPublicRide = true))
    }

    @Test
    fun `replay outranks every live reason`() {
        assertEquals(
            GpsPowerMode.Off,
            resolve(
                appVisible = true,
                riding = true,
                watchNavigating = true,
                replayOwnsPosition = true,
            ),
        )
    }

    @Test
    fun `link up is always within the dropout grace`() {
        assertTrue(GpsDemand.ridingThroughDropout(linkLostAtMs = null, nowMs = 10_000_000L))
    }

    @Test
    fun `a fresh dropout is still a ride`() {
        assertTrue(
            GpsDemand.ridingThroughDropout(
                linkLostAtMs = 1_000L,
                nowMs = 1_000L + RIDE_DROPOUT_GRACE_MS - 1,
            ),
        )
    }

    @Test
    fun `a dropout past the grace is an ended ride`() {
        assertFalse(
            GpsDemand.ridingThroughDropout(
                linkLostAtMs = 1_000L,
                nowMs = 1_000L + RIDE_DROPOUT_GRACE_MS,
            ),
        )
    }
}
