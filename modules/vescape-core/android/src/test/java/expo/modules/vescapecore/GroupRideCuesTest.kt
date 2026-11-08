package expo.modules.vescapecore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/GroupRideCuesTests.swift */
class GroupRideCuesTest {
    private val cues = GroupRideCues()

    private fun roster(vararg ids: String, rideId: String = "ride") = cues.roster(rideId, ids.toList(), "me")

    private fun joinedWith(vararg ids: String) {
        assertEquals("groupRide.joined", cues.joined("ride"))
        assertNull(roster(*ids))
    }

    @Test
    fun `the first roster after joining seeds the ride silently`() {
        joinedWith("me", "ola", "kai")

        assertNull(roster("me", "ola", "kai"))
    }

    @Test
    fun `a new rider id cues riderJoined, one seen earlier in the ride does not`() {
        joinedWith("me", "ola")

        assertEquals("groupRide.riderJoined", roster("me", "ola", "kai"))
        assertEquals("groupRide.riderLeft", roster("me", "ola"))
        assertNull(roster("me", "ola", "kai"))
    }

    @Test
    fun `a rider removed from the roster cues riderLeft once`() {
        joinedWith("me", "ola", "kai")

        assertEquals("groupRide.riderLeft", roster("me", "ola"))
        assertNull(roster("me", "ola"))
    }

    @Test
    fun `a new rider wins over one leaving in the same roster`() {
        joinedWith("me", "ola")

        assertEquals("groupRide.riderJoined", roster("me", "kai"))
    }

    @Test
    fun `the rider's own id never cues`() {
        joinedWith("ola")

        assertNull(roster("me", "ola"))
        assertNull(roster("ola"))
    }

    @Test
    fun `rosters of another ride are ignored`() {
        joinedWith("me", "ola")

        assertNull(roster("me", "ola", "kai", rideId = "other"))
        assertEquals("groupRide.riderJoined", roster("me", "ola", "kai"))
    }

    @Test
    fun `joining another ride starts its seen riders over`() {
        joinedWith("me", "ola")
        assertEquals("groupRide.joined", cues.joined("other"))
        assertNull(roster("me", rideId = "other"))

        assertEquals("groupRide.riderJoined", roster("me", "ola", rideId = "other"))
    }

    @Test
    fun `a duplicate joined for the joined ride plays nothing`() {
        joinedWith("me")

        assertNull(cues.joined("ride"))
    }

    @Test
    fun `own drop and rejoin within the grace plays nothing`() {
        joinedWith("me", "ola")

        assertTrue(cues.linkDropped())
        assertNull(cues.joined("ride"))
        assertNull(cues.graceElapsed())
    }

    @Test
    fun `a longer outage plays one lost, then restored on rejoin`() {
        joinedWith("me", "ola")

        assertTrue(cues.linkDropped())
        assertFalse(cues.linkDropped())
        assertEquals("groupRide.lost", cues.graceElapsed())
        assertNull(cues.graceElapsed())
        assertEquals("groupRide.restored", cues.joined("ride"))
    }

    @Test
    fun `our own reconnect catches up on the roster without peer cues`() {
        joinedWith("me", "ola", "kai")
        cues.linkDropped()
        assertNull(roster("me", "ola", "zoe"))
        assertNull(cues.joined("ride"))

        assertNull(roster("me", "ola", "zoe"))
        assertEquals("groupRide.riderLeft", roster("me", "ola"))
        assertNull(roster("me", "ola", "zoe"))
    }

    @Test
    fun `reset cancels a pending lost and forgets the ride`() {
        joinedWith("me", "ola")
        cues.linkDropped()
        cues.reset()

        assertNull(cues.graceElapsed())
        assertFalse(cues.linkDropped())
        assertEquals("groupRide.joined", cues.joined("ride"))
    }
}
