package expo.modules.vescapecore

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/RiderSignalTests.swift */
class RiderSignalTest {
    private val fix = 52.0 to 21.0

    private fun parse(obj: JSONObject?) = RiderPin.parse(obj, RiderSignalKind::fromWire)

    @Test
    fun `a roster signal parses with its relay times`() {
        val signal = parse(
            JSONObject().put("kind", "down").put("lat", 52.0).put("lng", 21.0)
                .put("startedAt", 1_000L).put("expiresAt", 601_000L),
        )

        assertEquals(RiderSignal(RiderSignalKind.DOWN, 52.0, 21.0, 1_000L, 601_000L), signal)
        assertEquals("down", signal!!.toMap()["kind"])
    }

    @Test
    fun `an unknown kind or a missing field is no signal`() {
        val full = """{"kind":"wait","lat":1,"lng":2,"startedAt":1,"expiresAt":2}"""
        assertNull(parse(JSONObject(full).put("kind", "fire")))
        assertNull(parse(JSONObject(full).apply { remove("lng") }))
        assertNull(parse(JSONObject(full).apply { remove("expiresAt") }))
        assertNull(parse(null))
    }

    @Test
    fun `a send carries the recent fix`() {
        val intent = RiderSignals.sendIntent(RiderSignalKind.DOWN, RiderSignalContext(fix, insidePrivacyZone = false))

        val frame = intent!!.frame()
        assertEquals("signal", frame.getString("type"))
        assertEquals("down", frame.getString("kind"))
        assertEquals(52.0, frame.getDouble("lat"), 0.0)
        assertEquals(21.0, frame.getDouble("lng"), 0.0)
    }

    @Test
    fun `a send is rejected without a recent fix`() {
        assertNull(RiderSignals.sendIntent(RiderSignalKind.DOWN, RiderSignalContext(null, insidePrivacyZone = false)))
        assertNull(RiderSignals.sendIntent(RiderSignalKind.DOWN, RiderSignalContext(null, insidePrivacyZone = true)))
    }

    @Test
    fun `clear is a bare signal-clear frame`() {
        assertEquals("""{"type":"signal-clear"}""", RiderPinIntent.Clear(PinSlot.SIGNAL).frame().toString())
    }

    @Test
    fun `a hazard parses in its own kinds and sends and clears in its own slot`() {
        val hazard = """{"kind":"mud","lat":1,"lng":2,"startedAt":1,"expiresAt":2}"""
        assertEquals(RideHazardKind.MUD, RiderPin.parse(JSONObject(hazard), RideHazardKind::fromWire)?.kind)
        assertNull(parse(JSONObject(hazard)))

        val send = RiderSignals.sendIntent(RideHazardKind.MUD, RiderSignalContext(fix, insidePrivacyZone = false))
        val frame = send!!.frame()
        assertEquals("hazard", frame.getString("type"))
        assertEquals("mud", frame.getString("kind"))
        assertEquals("""{"type":"hazard-clear"}""", RiderPinIntent.Clear(PinSlot.HAZARD).frame().toString())
    }
}
