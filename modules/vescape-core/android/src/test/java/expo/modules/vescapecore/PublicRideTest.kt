package expo.modules.vescapecore

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/PublicRideTests.swift */
class PublicRideTest {
    private var now = 1_000_000L
    private val persisted = mutableListOf<PublicRideSwitch>()
    private var timer: Long? = null
    private val events = mutableListOf<Pair<String, Map<String, Any?>>>()
    private val sent = mutableListOf<JSONObject>()
    private var linkOpen = true
    private lateinit var ride: PublicRide

    private val presence = RiderPresence(52.0, 21.0, null, null, null, null, null, null, null)

    @Before
    fun setUp() {
        ride = PublicRide(
            now = { now },
            persist = { persisted += it },
            scheduleExpiry = { timer = it },
            emit = { name, payload -> events += name to payload },
            send = { frame -> linkOpen && sent.add(frame) },
        )
    }

    private fun types() = sent.map { it.getString("type") }
    private fun status() = events.last { it.first == "onPublicRideStatus" }.second

    private fun ready(features: Set<String> = setOf("public-ride")) = ride.linkReady(features)

    @Test
    fun `a stored switch whose end time passed loads off`() {
        ride.load(PublicRideSwitch(true, now - 1), "acc")
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertEquals(PublicRideSwitch.OFF, persisted.last())
        assertNull(timer)
    }

    @Test
    fun `a stored switch loads off when signed out`() {
        ride.load(PublicRideSwitch(true, null), null)
        assertEquals(PublicRideSwitch.OFF, ride.switch)
    }

    @Test
    fun `going public needs an Account`() {
        ride.load(PublicRideSwitch.OFF, null)
        assertFalse(ride.set(PublicRideSwitch(true, null)))
        assertEquals(PublicRideSwitch.OFF, ride.switch)
    }

    @Test
    fun `always on starts the public ride when the board connects`() {
        ride.load(PublicRideSwitch.OFF, "acc")
        ready()
        assertTrue(ride.set(PublicRideSwitch(true, null)))
        assertTrue(sent.isEmpty())
        ride.setBoardConnected(true)
        assertEquals(listOf("public-on"), types())
        assertFalse(sent.last().has("until"))
        ride.setBoardConnected(false)
        assertEquals(listOf("public-on", "public-off"), types())
        // The switch stays on for the next board connect.
        assertTrue(ride.switch.on)
    }

    @Test
    fun `the hours end time goes to the relay and the timer turns the switch off`() {
        val until = now + 2 * 3_600_000L
        ride.load(PublicRideSwitch.OFF, "acc")
        ride.setBoardConnected(true)
        ready()
        ride.set(PublicRideSwitch(true, until))
        assertEquals(until, sent.last().getLong("until"))
        assertEquals(2 * 3_600_000L, timer)
        now = until
        ride.expire()
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertEquals(PublicRideSwitch.OFF, persisted.last())
        assertEquals("end-time", status()["reason"])
    }

    @Test
    fun `the public ride waits for a relay that lists the feature`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready(features = emptySet())
        assertTrue(sent.isEmpty())
        assertEquals(false, status()["supported"])
    }

    @Test
    fun `positions go out only once the relay confirms`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        ride.position(presence, 5L)
        assertEquals(listOf("public-on"), types())
        ride.handle("public-status", JSONObject().put("on", true))
        assertEquals(true, status()["live"])
        ride.position(presence, 5L)
        assertEquals(5L, sent.last().getLong("at"))
        assertFalse(sent.last().getJSONObject("presence").has("at"))
    }

    @Test
    fun `reconnecting sends public-on again`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        ride.linkLost()
        ready()
        assertEquals(listOf("public-on", "public-on"), types())
    }

    @Test
    fun `a newer phone of the Account turns the switch off`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        ride.handle("public-status", JSONObject().put("on", false).put("reason", "replaced"))
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertEquals("replaced", status()["reason"])
        assertEquals(listOf("public-on"), types())
    }

    @Test
    fun `signing out ends the public ride and turns the switch off`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        assertTrue(ride.setAccount(null))
        assertEquals(listOf("public-on", "public-off"), types())
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertEquals("signed-out", status()["reason"])
    }

    @Test
    fun `a refused public-on turns the switch off`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        assertTrue(ride.handleError("public ride needs a nick"))
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertFalse(ride.handleError("no such ride: x"))
    }

    @Test
    fun `nearby riders follow the relay`() {
        ride.load(PublicRideSwitch.OFF, null)
        ready()
        ride.watchNearby(52.0 to 21.0)
        assertEquals("nearby", sent.last().getString("type"))
        ride.handle(
            "nearby-riders",
            JSONObject("""{"now":9,"riders":[{"accountId":"a","nick":"Ola","presence":{"lat":52,"lng":21},"stale":false,"lastSeen":8,"away":false}]}"""),
        )
        ride.handle("public-rider-gone", JSONObject().put("accountId", "a"))
        val riders = events.last { it.first == "onPublicRiders" }.second["riders"] as List<*>
        assertTrue(riders.isEmpty())
        val first = events.first { it.first == "onPublicRiders" }.second
        assertEquals(9L, first["now"])
        assertEquals("Ola", ((first["riders"] as List<*>)[0] as Map<*, *>)["nick"])
    }
}
