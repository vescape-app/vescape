package expo.modules.vescapecore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/GroupRideCuesTests.swift */
class GroupRideCuesTest {
    private val cues = GroupRideCues()

    private fun roster(vararg ids: String, away: Set<String> = emptySet(), rideId: String = "ride") =
        cues.roster(rideId, ids.toList(), away, "me")

    private fun signal(kind: RiderSignalKind, startedAt: Long = 1_000, expiresAt: Long = 61_000) =
        RiderSignal(kind, 50.0, 19.0, startedAt, expiresAt)

    private fun signals(vararg ids: String, signals: Map<String, RiderSignal>, now: Long? = 10_000) =
        cues.roster("ride", ids.toList(), emptySet(), "me", signals, now)

    private fun joinedWith(vararg ids: String, away: Set<String> = emptySet()) {
        assertEquals("groupRide.joined", cues.joined("ride"))
        assertNull(roster(*ids, away = away))
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
    fun `a rider removed while away plays nothing`() {
        joinedWith("me", "ola", "kai")

        assertNull(roster("me", "ola", "kai", away = setOf("kai")))
        assertNull(roster("me", "ola"))
    }

    @Test
    fun `a rider away in the first roster leaves silently`() {
        joinedWith("me", "ola", "kai", away = setOf("kai"))

        assertNull(roster("me", "ola"))
    }

    @Test
    fun `a rider back from away who then leaves cues riderLeft`() {
        joinedWith("me", "ola")
        assertNull(roster("me", "ola", away = setOf("ola")))
        assertNull(roster("me", "ola"))

        assertEquals("groupRide.riderLeft", roster("me"))
    }

    @Test
    fun `several riders removed at once cue one riderLeft only when one was live`() {
        joinedWith("me", "ola", "kai", "zoe", "ian", away = setOf("kai", "zoe"))

        assertNull(roster("me", "ola", "ian", away = setOf("ian")))
        assertEquals("groupRide.riderLeft", roster("me"))
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

    @Test
    fun `another rider's new signal cues its kind once`() {
        joinedWith("me", "ola")
        val down = signal(RiderSignalKind.DOWN)

        assertEquals("groupRide.signal.down", signals("me", "ola", signals = mapOf("ola" to down)))
        assertNull(signals("me", "ola", signals = mapOf("ola" to down)))
    }

    @Test
    fun `a replaced signal cues the new kind`() {
        joinedWith("me", "ola")
        signals("me", "ola", signals = mapOf("ola" to signal(RiderSignalKind.WAIT)))

        assertEquals(
            "groupRide.signal.battery",
            signals("me", "ola", signals = mapOf("ola" to signal(RiderSignalKind.BATTERY, startedAt = 5_000))),
        )
    }

    @Test
    fun `a signal cleared before it expires by relay now cues ok, expiry is silent`() {
        joinedWith("me", "ola", "kai")
        val help = mapOf("ola" to signal(RiderSignalKind.HELP), "kai" to signal(RiderSignalKind.BOARD))
        signals("me", "ola", "kai", signals = help)

        assertEquals("groupRide.signal.ok", signals("me", "ola", "kai", signals = help - "ola", now = 60_999))
        assertNull(signals("me", "ola", "kai", signals = emptyMap(), now = 61_000))
    }

    @Test
    fun `a signal gone a second late or without relay now stays silent`() {
        joinedWith("me", "ola")
        val board = mapOf("ola" to signal(RiderSignalKind.BOARD))
        signals("me", "ola", signals = board)
        assertNull(signals("me", "ola", signals = emptyMap(), now = 62_000))

        signals("me", "ola", signals = mapOf("ola" to signal(RiderSignalKind.BOARD, startedAt = 2_000)))
        assertNull(signals("me", "ola", signals = emptyMap(), now = null))
    }

    @Test
    fun `a rider leaving with an active signal cues riderLeft, not ok`() {
        joinedWith("me", "ola", "kai")
        signals("me", "ola", "kai", signals = mapOf("ola" to signal(RiderSignalKind.WAIT)))

        assertEquals("groupRide.riderLeft", signals("me", "kai", signals = emptyMap()))
    }

    @Test
    fun `the rider's own signal never cues`() {
        joinedWith("me", "ola")
        val own = mapOf("me" to signal(RiderSignalKind.DOWN))

        assertNull(signals("me", "ola", signals = own))
        assertNull(signals("me", "ola", signals = emptyMap()))
    }

    @Test
    fun `signals already active at join or reconnect stay silent`() {
        val down = mapOf("ola" to signal(RiderSignalKind.DOWN))
        assertEquals("groupRide.joined", cues.joined("ride"))
        assertNull(signals("me", "ola", signals = down))
        assertNull(signals("me", "ola", signals = down))

        cues.linkDropped()
        cues.joined("ride")
        val wait = mapOf("ola" to signal(RiderSignalKind.WAIT, startedAt = 3_000))
        assertNull(signals("me", "ola", signals = wait))
        assertNull(signals("me", "ola", signals = wait))
    }

    @Test
    fun `a signal wins over social cues and a critical signal over others`() {
        joinedWith("me", "ola")
        val both = mapOf("ola" to signal(RiderSignalKind.WAIT), "kai" to signal(RiderSignalKind.HELP))

        assertEquals("groupRide.signal.help", signals("me", "ola", "kai", signals = both))
        assertEquals("groupRide.signal.ok", signals("me", "kai", "zoe", signals = emptyMap()))
    }

    @Test
    fun `with connection sounds off only signal cues play`() {
        joinedWith("me", "ola")
        val down = signals("me", "ola", signals = mapOf("ola" to signal(RiderSignalKind.DOWN)))!!
        val ok = signals("me", "ola", signals = emptyMap())!!
        val joined = roster("me", "ola", "kai")!!
        cues.linkDropped()
        cues.linkDropped()
        val lost = cues.graceElapsed()!!

        for (cue in listOf(down, ok)) assertTrue(cue, GroupRideCues.audible(cue, connectionSoundsEnabled = false))
        for (cue in listOf(joined, lost, "groupRide.joined", "groupRide.created")) {
            assertFalse(cue, GroupRideCues.audible(cue, connectionSoundsEnabled = false))
            assertTrue(cue, GroupRideCues.audible(cue, connectionSoundsEnabled = true))
        }
    }
}
