package expo.modules.vescapecore

import expo.modules.vescapecore.connection.PrivacyZoneReadState
import expo.modules.vescapecore.database.PrivacyZoneEntity
import expo.modules.vescapecore.protocol.LocationSnapshot
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/GroupRideObserverTests.swift */
class GroupRideObserverTest {
    @Test
    fun `a signal goes out with a fix inside a Privacy Zone while presence stays suppressed`() {
        val fix = LocationSnapshot(52.0, 21.0, null, null, 5.0, null, timestamp = 1_000, precise = true)
        val zones = PrivacyZoneReadState()

        // Zones still loading: presence is gated, a signal is not.
        assertNull(zones.presenceFix(fix))
        assertNotNull(RiderSignals.sendIntent(RiderSignalKind.DOWN, zones.signalContext(fix, nowMs = 2_000)))

        // Loaded, and the fix is inside one.
        runBlocking { zones.reload { listOf(PrivacyZoneEntity("home", "custom", "Home", true, 520_000_000, 210_000_000, 200, 1, 1)) } }
        assertNull(zones.presenceFix(fix))
        val context = zones.signalContext(fix, nowMs = 2_000)
        assertTrue(context.insidePrivacyZone)
        val frame = (RiderSignals.sendIntent(RiderSignalKind.DOWN, context) as RiderPinIntent.Send).frame()
        assertEquals("down", frame.getString("kind"))
        assertEquals(52.0, frame.getDouble("lat"), 0.0)
        assertEquals(21.0, frame.getDouble("lng"), 0.0)
        // The gate opens again outside every zone.
        assertNotNull(zones.presenceFix(fix.copy(latitude = 53.0)))
    }

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
}
