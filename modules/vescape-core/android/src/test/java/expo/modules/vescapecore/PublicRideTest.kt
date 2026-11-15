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
    private var pinUpdates = mutableListOf<Pair<List<SignalRider>, Map<String, RideHazard>>>()

    private val presence = RiderPresence(52.0, 21.0, null, null, null, null, null, null, null)

    @Before
    fun setUp() {
        ride = PublicRide(
            now = { now },
            persist = { persisted += it },
            scheduleExpiry = { timer = it },
            emit = { name, payload -> events += name to payload },
            send = { frame -> linkOpen && sent.add(frame) },
            onPins = { signals, hazards, _ -> pinUpdates += signals to hazards },
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

    private fun ownPins() = events.last { it.first == "onPublicPins" }.second["own"] as Map<*, *>

    private fun goLive() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        ride.handle("public-status", JSONObject().put("on", true))
    }

    @Test
    fun `a public rider sends and clears a signal and a hazard`() {
        goLive()
        val signal = RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0)
        assertTrue(ride.submitPin(signal))
        assertTrue(ride.submitPin(RiderPinIntent.Send(RideHazardKind.WATER, 52.0, 21.0)))
        assertEquals(listOf("public-on", "public-signal", "public-hazard"), types())
        assertEquals("wait", sent[1].getString("kind"))
        assertEquals("wait", (ownPins()["signal"] as Map<*, *>)["kind"])
        assertTrue(ride.submitPin(RiderPinIntent.Clear(PinSlot.SIGNAL)))
        assertEquals("public-signal-clear", types().last())
        assertNull(ownPins()["signal"])
    }

    @Test
    fun `a pin waits for the relay to confirm the public ride`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        assertTrue(ride.submitPin(RiderPinIntent.Send(RiderSignalKind.DOWN, 52.0, 21.0)))
        assertTrue(ride.submitPin(RiderPinIntent.Send(RiderSignalKind.SERIOUS, 52.0, 21.0)))
        assertEquals(listOf("public-on"), types())
        ride.handle("public-status", JSONObject().put("on", true))
        assertEquals(listOf("public-on", "public-signal"), types())
        assertEquals("serious", sent.last().getString("kind"))
    }

    @Test
    fun `no pin goes out off the public ride, and ending it drops the own pins`() {
        ride.load(PublicRideSwitch.OFF, "acc")
        ready()
        assertFalse(ride.submitPin(RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0)))
        goLive()
        ride.submitPin(RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0))
        ride.setBoardConnected(false)
        assertNull(ownPins()["signal"])
    }

    @Test
    fun `other riders' pins follow the relay, a missing slot meaning none`() {
        ride.load(PublicRideSwitch.OFF, null)
        ready()
        val pin = """{"kind":"serious","lat":52,"lng":21,"startedAt":5,"expiresAt":9}"""
        val hazard = """{"kind":"police","lat":52,"lng":21,"startedAt":5,"expiresAt":9}"""
        ride.handle("public-pins", JSONObject("""{"accountId":"f","nick":"Ola","signal":$pin,"hazard":$hazard,"now":6}"""))
        assertEquals(RiderSignalKind.SERIOUS, pinUpdates.last().first.single().signal?.kind)
        assertEquals("Ola", pinUpdates.last().first.single().name)
        assertEquals(RideHazardKind.POLICE, pinUpdates.last().second["f"]?.kind)
        ride.handle("public-pins", JSONObject("""{"accountId":"f","nick":"Ola","hazard":$hazard,"now":7}"""))
        assertNull(pinUpdates.last().first.single().signal)
        ride.handle("public-pins", JSONObject("""{"accountId":"f","nick":"Ola","now":8}"""))
        assertTrue(pinUpdates.last().first.isEmpty())
        assertTrue(pinUpdates.last().second.isEmpty())
        val event = events.last { it.first == "onPublicPins" }.second
        assertTrue((event["pins"] as List<*>).isEmpty())
        assertEquals(8L, event["now"])
    }

    private val withMissed = setOf("public-ride", "missed-positions")

    private fun goLiveWithMissed() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready(withMissed)
        ride.handle("public-status", JSONObject().put("on", true))
    }

    private fun lastBatch() = sent.last { it.getString("type") == "missed-positions" }.getJSONArray("positions")

    private fun batchAts() = lastBatch().let { arr -> (0 until arr.length()).map { arr.getJSONObject(it).getLong("at") } }

    @Test
    fun `positions missed offline go as one thinned batch after reconnect and drop only once stored`() {
        goLiveWithMissed()
        ride.linkLost()
        listOf(10_000L, 12_000L, 15_000L, 21_000L).forEach { ride.position(presence, it) }
        ready(withMissed)
        ride.position(presence, 26_000L)
        assertEquals(0, types().count { it == "missed-positions" })
        ride.handle("public-status", JSONObject().put("on", true))
        assertEquals(listOf(10_000L, 15_000L, 21_000L, 26_000L), batchAts())
        ride.position(presence, 30_000L)
        assertEquals(1, types().count { it == "missed-positions" })
        ride.handleError("missed positions not stored")
        assertEquals(PublicRideSwitch(true, null), ride.switch)
        ride.position(presence, 31_000L)
        assertEquals(2, types().count { it == "missed-positions" })
        assertEquals(listOf(10_000L, 15_000L, 21_000L, 26_000L), batchAts())
        ride.handle("missed-stored", JSONObject().put("from", 10_000L).put("to", 26_000L).put("stored", 4))
        ride.position(presence, 32_000L)
        assertEquals(2, types().count { it == "missed-positions" })
    }

    @Test
    fun `kept positions are capped at three hours and sent in batches of 500`() {
        goLiveWithMissed()
        ride.linkLost()
        val count = 3 * 60 * 60 / 5 + 10
        (0 until count).forEach { ride.position(presence, it * 5_000L) }
        ready(withMissed)
        ride.handle("public-status", JSONObject().put("on", true))
        assertEquals(500, lastBatch().length())
        assertEquals(9 * 5_000L, batchAts().first())
        ride.handle("missed-stored", JSONObject())
        assertEquals(500 * 5_000L + 9 * 5_000L, batchAts().first())
    }

    @Test
    fun `nothing is kept for a relay without the feature, and an Account change discards the kept`() {
        goLive()
        ride.linkLost()
        ride.position(presence, 10_000L)
        ready()
        ride.handle("public-status", JSONObject().put("on", true))
        assertFalse("missed-positions" in types())

        sent.clear()
        goLiveWithMissed()
        ride.linkLost()
        ride.position(presence, 20_000L)
        ride.setAccount("other")
        ride.set(PublicRideSwitch(true, null))
        ready(withMissed)
        ride.handle("public-status", JSONObject().put("on", true))
        assertFalse("missed-positions" in types())
    }
}
