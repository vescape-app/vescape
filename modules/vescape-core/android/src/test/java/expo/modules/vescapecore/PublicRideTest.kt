package expo.modules.vescapecore

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
    private var retry: Long? = null
    private var ridersFlush: Long? = null
    private val linkDemands = mutableListOf<Boolean>()
    private lateinit var ride: PublicRide
    private var pinUpdates = mutableListOf<Pair<List<SignalRider>, Map<String, RideHazard>>>()
    private val cues = mutableListOf<String>()

    private val presence = RiderPresence(52.0, 21.0, null, null, null, null, null, null, null)

    @Before
    fun setUp() {
        now = 1_000_000L
        persisted.clear()
        timer = null
        retry = null
        ridersFlush = null
        events.clear()
        sent.clear()
        linkDemands.clear()
        pinUpdates.clear()
        cues.clear()
        linkOpen = true
        ride = PublicRide(
            now = { now },
            persist = { persisted += it },
            scheduleExpiry = { timer = it },
            emit = { name, payload -> events += name to payload },
            send = { frame -> linkOpen && sent.add(frame) },
            scheduleMissedRetry = { retry = it },
            scheduleRidersFlush = { ridersFlush = it },
            onPublicRideDemandChanged = { linkDemands += ride.needsLink },
            onPins = { signals, hazards, _ -> pinUpdates += signals to hazards },
            onCue = { cues += it },
        )
    }

    private fun types() = sent.map { it.getString("type") }
    private fun status() = events.last { it.first == "onPublicRideStatus" }.second

    private fun ready(features: Set<String> = setOf("public-ride")) = ride.linkReady(features, "acc")

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
        assertTrue(ride.switch.on)
    }

    @Test
    fun `manual sharing hands off to the board without resetting the timer`() {
        val until = now + 3_600_000L
        val selected = PublicRideSwitch(true, until)
        ride.load(selected, "acc")
        ready()
        ride.watchNearby(52.0 to 21.0)
        sent.clear()
        linkDemands.clear()

        ride.setManualSharing(true)
        assertTrue(ride.needsGps)
        assertEquals("phone", status()["activation"])
        assertEquals(until, sent.last().getLong("until"))
        assertEquals(false, status()["live"])
        ride.handle("public-status", JSONObject().put("on", true))
        ride.position(presence, atMs = now)

        ride.setBoardConnected(true)
        assertEquals("board", status()["activation"])
        assertFalse(ride.needsGps)
        assertTrue(ride.riding)
        ride.setManualSharing(true)
        assertFalse(ride.needsGps)
        assertEquals(listOf("public-on", "public-position"), types())
        ride.setBoardConnected(false)
        assertEquals(listOf("public-on", "public-position", "public-off"), types())
        assertEquals("waiting", status()["activation"])
        assertFalse(ride.needsGps)
        assertEquals(listOf(true, true), linkDemands)
        assertEquals(selected, ride.switch)
        assertEquals(3_600_000L, timer)
        assertTrue(persisted.isEmpty())

        ride.setBoardConnected(true)
        assertEquals("public-on", types().last())
    }

    @Test
    fun `manual sharing expires and does not restart with the switch`() {
        ride.load(PublicRideSwitch.OFF, "acc")
        ready()
        ride.setManualSharing(true)
        assertFalse(ride.needsGps)

        val until = now + 1_000L
        ride.set(PublicRideSwitch(true, until))
        ride.setManualSharing(true)
        now = until
        ride.expire()
        assertEquals("off", status()["activation"])
        assertEquals(listOf("public-on", "public-off"), types())
        ride.set(PublicRideSwitch(true, null))
        assertFalse(ride.wanted)

        ride.setManualSharing(true)
        ride.setAccount("another-account")
        assertFalse(ride.needsGps)
        ride.set(PublicRideSwitch(true, null))
        assertFalse(ride.wanted)
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
    fun `a public-on refused for a newer connection turns the switch off as replaced`() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        assertTrue(ride.handleError("connection replaced"))
        assertEquals(PublicRideSwitch.OFF, ride.switch)
        assertEquals("replaced", status()["reason"])
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

    @Test
    fun `one tick of rider updates reaches JS as one list`() {
        ride.load(PublicRideSwitch.OFF, null)
        ready()
        ride.watchNearby(52.0 to 21.0)
        ride.handle("nearby-riders", JSONObject().put("now", 1).put("riders", JSONArray()))
        events.clear()
        for (id in listOf("a", "b", "c")) {
            val presence = JSONObject().put("lat", 52).put("lng", 21)
            val rider = JSONObject().put("accountId", id).put("nick", "R$id").put("presence", presence)
                .put("stale", false).put("lastSeen", 2).put("away", false)
            ride.handle("public-rider", JSONObject().put("now", 2).put("rider", rider))
        }
        assertTrue(events.none { it.first == "onPublicRiders" })
        assertEquals(PublicRide.RIDERS_BATCH_MS, ridersFlush)

        ride.flushRiders()
        val emitted = events.filter { it.first == "onPublicRiders" }
        assertEquals(1, emitted.size)
        assertEquals(3, (emitted[0].second["riders"] as List<*>).size)
        assertNull(ridersFlush)
    }

    @Test
    fun `looking around re-centres after the rider moves a kilometre, but not while public`() {
        ride.load(PublicRideSwitch.OFF, null)
        ready()
        ride.followNearby(52.0 to 21.0)
        ride.followNearby(52.005 to 21.0)
        ride.followNearby(52.011 to 21.0)
        val nearby = sent.filter { it.getString("type") == "nearby" }.map { it.getDouble("lat") }
        assertEquals(listOf(52.0, 52.011), nearby)

        goLive()
        sent.clear()
        ride.followNearby(52.03 to 21.0)
        assertTrue(sent.none { it.getString("type") == "nearby" })
    }

    private fun ownPins() = events.last { it.first == "onPublicPins" }.second["own"] as Map<*, *>

    private fun goLive() {
        ride.load(PublicRideSwitch(true, null), "acc")
        ride.setBoardConnected(true)
        ready()
        ride.handle("public-status", JSONObject().put("on", true))
    }

    @Test
    fun `peer signal cues once per raise and only explicit clear says OK`() {
        goLive()
        fun receive(startedAt: Long?, relayTime: Long, cleared: Long? = null) {
            val frame = JSONObject().put("accountId", "friend").put("now", relayTime)
            if (startedAt != null) {
                val signal = JSONObject().put("kind", "serious").put("lat", 52).put("lng", 21)
                    .put("startedAt", startedAt).put("expiresAt", startedAt + 10)
                frame.put("signal", signal)
            }
            frame.put("clearedSignalStartedAt", cleared)
            ride.handle("public-pins", frame)
        }
        receive(5, 6)
        receive(5, 7)
        ride.linkLost()
        ready()
        receive(5, 8)
        receive(9, 9)
        receive(null, 10)
        receive(11, 11)
        receive(null, 12, cleared = 11)
        receive(null, 13, cleared = 11)
        receive(11, 21)
        assertEquals(List(3) { "groupRide.signal.serious" } + "groupRide.signal.ok", cues)
    }

    @Test
    fun `own signal sounds only after the relay echoes it`() {
        goLive()
        ride.submitPin(RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0))
        assertTrue(cues.isEmpty())
        val pin = JSONObject().put("kind", "wait").put("lat", 52).put("lng", 21)
            .put("startedAt", 5).put("expiresAt", 20)
        fun receive(relayTime: Long, signal: JSONObject? = null) {
            ride.handle("public-pins", JSONObject().put("accountId", "acc").put("signal", signal).put("now", relayTime))
        }
        receive(5, pin)
        receive(6, pin)
        ride.submitPin(RiderPinIntent.Clear(PinSlot.SIGNAL))
        assertEquals(listOf("groupRide.signal.sent"), cues)
        receive(7)
        receive(8)
        assertEquals(listOf("groupRide.signal.sent", "groupRide.signal.cleared"), cues)
        ride.submitPin(RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0))
        receive(9, pin.put("startedAt", 9))
        receive(20)
        assertEquals(listOf("groupRide.signal.sent", "groupRide.signal.cleared", "groupRide.signal.sent"), cues)
        assertTrue(pinUpdates.isEmpty())
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
        assertEquals(1, types().count { it == "missed-positions" })
        assertEquals(listOf(10_000L, 15_000L, 21_000L), batchAts())
        assertEquals(listOf("missed-positions", "public-on"), types().takeLast(2))
        ride.handle("public-status", JSONObject().put("on", true))
        ride.position(presence, 30_000L)
        assertEquals(1, types().count { it == "missed-positions" })
        ride.handleError("missed positions not stored")
        assertEquals(PublicRideSwitch(true, null), ride.switch)
        assertEquals(PublicRide.MISSED_RETRY_MS, retry)
        ride.linkLost()
        ready(withMissed)
        assertEquals(2, types().count { it == "missed-positions" })
        assertEquals(listOf(10_000L, 15_000L, 21_000L, 26_000L), batchAts())
        ride.handle("missed-stored", JSONObject().put("from", 10_000L).put("to", 26_000L).put("stored", 4))
        assertNull(retry)
        ride.handle("public-status", JSONObject().put("on", true))
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
        ride.linkReady(withMissed, "other")
        ride.handle("public-status", JSONObject().put("on", true))
        assertFalse("missed-positions" in types())
    }
    @Test
    fun `offline finish by off disconnect or expiry drains without a public ride or new GPS`() {
        for (ending in listOf("off", "disconnect", "expiry")) {
            setUp()
            goLiveWithMissed()
            ride.set(PublicRideSwitch(true, now + 60_000))
            ride.linkLost()
            ride.position(presence, 10_000)
            when (ending) {
                "off" -> ride.set(PublicRideSwitch.OFF)
                "disconnect" -> ride.setBoardConnected(false)
                else -> { now += 60_000; ride.expire() }
            }
            ride.position(presence, 20_000)
            assertFalse(ride.wanted)
            assertTrue(ride.needsLink)
            sent.clear()
            ready(withMissed)
            assertEquals(listOf("missed-positions"), types())
            assertEquals(listOf(10_000L), batchAts())
            assertFalse(ride.riding)
            assertTrue(ride.needsLink)
            ride.handleError("missed positions not stored")
            assertEquals(PublicRide.MISSED_RETRY_MS, retry)
            ride.linkLost()
            assertNull(retry)
            ready(withMissed)
            assertEquals(listOf("missed-positions", "missed-positions"), types())
            ride.handle("missed-stored", JSONObject())
            assertFalse(ride.needsLink)
            assertEquals(false, linkDemands.last())
            assertNull(retry)
        }
    }

    @Test
    fun `completed buffer waits for authenticated capability readiness and cannot cross accounts or servers`() {
        for (account in listOf<String?>(null, "other")) {
            setUp()
            goLiveWithMissed()
            ride.linkLost()
            ride.position(presence, 10_000)
            ride.set(PublicRideSwitch.OFF)
            sent.clear()
            ride.linkReady(withMissed, account)
            assertTrue(sent.isEmpty())
            assertTrue(ride.needsLink)
            ride.linkLost()
            ready(withMissed)
            assertEquals(listOf("missed-positions"), types())
        }
        for (clear in listOf("sign-out", "account", "server", "unsupported")) {
            setUp()
            goLiveWithMissed()
            ride.linkLost()
            ride.position(presence, 10_000)
            ride.set(PublicRideSwitch.OFF)
            ready(withMissed)
            assertNotNull(retry)
            when (clear) {
                "sign-out" -> ride.setAccount(null)
                "account" -> ride.setAccount("other")
                "server" -> ride.discardMissed()
                else -> ride.linkReady(setOf("public-ride"), "acc")
            }
            assertFalse(ride.needsLink)
            assertNull(retry)
            sent.clear()
            ride.linkLost()
            ready(withMissed)
            ride.handle("missed-stored", JSONObject())
            assertTrue(sent.isEmpty())
        }
    }

    @Test
    fun `thinning during an upload preserves the acknowledged prefix and waiting tail`() {
        goLiveWithMissed()
        ride.linkLost()
        ride.position(presence, 0)
        ride.position(presence, 5_000)
        ready(withMissed)
        val late = PublicRide.MISSED_MAX_AGE_MS + 10_000
        ride.position(presence, late)
        ride.position(presence, late + 1_000)
        assertEquals(listOf(0L, 5_000L), batchAts())
        ride.handle("missed-stored", JSONObject())
        assertEquals(listOf(late), batchAts())
        ride.set(PublicRideSwitch.OFF)
        ride.handle("missed-stored", JSONObject())
        assertFalse(ride.needsLink)
    }

    @Test
    fun `link and account resets forget peers but only identity drops pending own intents`() {
        for (changeAccount in listOf(false, true)) {
            setUp()
            goLive()
            val peer = JSONObject("""{"accountId":"friend","nick":"Ola","signal":{"kind":"serious","lat":52,"lng":21,"startedAt":5,"expiresAt":9000000},"now":6}""")
            ride.handle("public-pins", peer)
            ride.linkLost()
            assertTrue(pinUpdates.last().first.isEmpty())
            assertTrue(pinUpdates.last().second.isEmpty())
            assertTrue((events.last { it.first == "onPublicPins" }.second["pins"] as List<*>).isEmpty())
            ride.submitPin(RiderPinIntent.Send(RiderSignalKind.WAIT, 52.0, 21.0))
            if (changeAccount) {
                ride.handle("public-pins", peer)
                ride.setAccount("other")
                assertTrue(pinUpdates.last().first.isEmpty())
                ride.set(PublicRideSwitch(true, null))
            }
            sent.clear()
            ride.linkReady(setOf("public-ride"), if (changeAccount) "other" else "acc")
            ride.handle("public-status", JSONObject().put("on", true))
            assertEquals(!changeAccount, "public-signal" in types())
            assertTrue((events.last { it.first == "onPublicPins" }.second["pins"] as List<*>).isEmpty())
        }
    }

}
