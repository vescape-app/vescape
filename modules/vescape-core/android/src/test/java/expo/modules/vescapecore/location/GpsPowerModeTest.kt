package expo.modules.vescapecore.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule that decides what the phone's GPS costs. Every case here is a battery outcome.
 *
 * @parity /modules/vescape-core/ios/location/GpsPowerModeTests.swift
 */
class GpsPowerModeTest {
    private fun resolve(
        appVisible: Boolean = false,
        riding: Boolean = false,
        groupRideParticipating: Boolean = false,
        replayOwnsPosition: Boolean = false,
    ) = GpsDemand.resolve(
        appVisible = appVisible,
        riding = riding,
        groupRideParticipating = groupRideParticipating,
        replayOwnsPosition = replayOwnsPosition,
    )

    /** The drain this whole rule exists to stop: app away, ride over, nothing running. */
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

    /**
     * A rider looking at the map mid-ride must not be downgraded to foreground-only delivery: the
     * moment they pocket the phone the Ride Track would stop.
     */
    @Test
    fun `riding outranks merely watching`() {
        assertEquals(GpsPowerMode.Ride, resolve(appVisible = true, riding = true))
    }

    /**
     * Group Ride is deliberate board-less use — the rider's position is being broadcast to others,
     * so it must keep flowing from a pocket.
     */
    @Test
    fun `group ride participation pays for background fixes`() {
        assertEquals(GpsPowerMode.Ride, resolve(groupRideParticipating = true))
    }

    /**
     * A replay owns position for its lifetime; a live fix slipping through jumps the marker off the
     * recorded track.
     */
    @Test
    fun `replay outranks every live reason`() {
        assertEquals(
            GpsPowerMode.Off,
            resolve(
                appVisible = true,
                riding = true,
                groupRideParticipating = true,
                replayOwnsPosition = true,
            ),
        )
    }

    @Test
    fun `link up is always within the dropout grace`() {
        assertTrue(GpsDemand.ridingThroughDropout(linkLostAtMs = null, nowMs = 10_000_000L))
    }

    /** A mid-ride dropout must not punch a hole in the Ride Track (ADR 0038). */
    @Test
    fun `a fresh dropout is still a ride`() {
        assertTrue(
            GpsDemand.ridingThroughDropout(
                linkLostAtMs = 1_000L,
                nowMs = 1_000L + RIDE_DROPOUT_GRACE_MS - 1,
            ),
        )
    }

    /**
     * Powering the board off is how a ride ends; past the grace the reconnect loop is chasing a
     * board that is not coming back.
     */
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
