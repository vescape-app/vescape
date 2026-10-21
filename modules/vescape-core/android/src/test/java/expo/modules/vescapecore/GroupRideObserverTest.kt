package expo.modules.vescapecore

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/GroupRideObserverTests.swift */
class GroupRideObserverTest {
    private fun rider(presence: JSONObject?) =
        GroupRideObserver.rosterRider(mapOf("id" to "ola", "presence" to GroupRideObserver.presenceMap(presence)))

    @Test
    fun `a presence with both coordinates places the rider`() {
        val position = rider(JSONObject().put("lat", 52.0).put("lng", 21.0))?.position

        assertEquals(52.0, position!!.lat, 0.0)
        assertEquals(21.0, position.lon, 0.0)
    }

    @Test
    fun `a presence missing a coordinate leaves the rider unplaced, not at 0,0`() {
        assertNull(GroupRideObserver.presenceMap(JSONObject().put("lat", 52.0).put("soc", 80.0)))
        assertNull(rider(JSONObject().put("lat", 52.0))?.position)
        assertNull(rider(JSONObject().put("lng", 21.0))?.position)
        assertNotNull(rider(JSONObject().put("lng", 21.0)))
    }

    @Test
    fun `no presence leaves the rider unplaced`() {
        assertNull(rider(null)?.position)
    }

    @Test
    fun `roster changes cue other riders joining before leaving, never the rider`() {
        val cue = GroupRideObserver::rosterCue
        assertNull(cue(emptyList(), listOf("me", "ola"), "me"))
        assertEquals("groupRide.riderJoined", cue(listOf("me"), listOf("me", "ola"), "me"))
        assertEquals("groupRide.riderLeft", cue(listOf("me", "ola"), listOf("me"), "me"))
        assertEquals("groupRide.riderJoined", cue(listOf("me", "ola"), listOf("me", "kai"), "me"))
        assertNull(cue(listOf("ola"), listOf("me", "ola"), "me"))
        assertNull(cue(listOf("me", "ola"), listOf("ola", "me"), "me"))
    }
}
