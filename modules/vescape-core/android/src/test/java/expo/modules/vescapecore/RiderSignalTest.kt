package expo.modules.vescapecore

import org.json.JSONObject
import expo.modules.vescapecore.connection.PrivacyZoneReadState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/groupride/RiderSignalTests.swift */
class RiderSignalTest {
    private val fix = 52.0 to 21.0

    @Test
    fun `a roster signal parses with its relay times`() {
        val signal = RiderSignal.parse(
            JSONObject().put("kind", "down").put("lat", 52.0).put("lng", 21.0)
                .put("startedAt", 1_000L).put("expiresAt", 601_000L),
        )

        assertEquals(RiderSignal(RiderSignalKind.DOWN, 52.0, 21.0, 1_000L, 601_000L), signal)
        assertEquals("down", signal!!.toMap()["kind"])
    }

    @Test
    fun `an unknown kind or a missing field is no signal`() {
        val full = """{"kind":"wait","lat":1,"lng":2,"startedAt":1,"expiresAt":2}"""
        assertNull(RiderSignal.parse(JSONObject(full).put("kind", "fire")))
        assertNull(RiderSignal.parse(JSONObject(full).apply { remove("lng") }))
        assertNull(RiderSignal.parse(JSONObject(full).apply { remove("expiresAt") }))
        assertNull(RiderSignal.parse(null))
    }

    @Test
    fun `a send carries the recent fix`() {
        val intent = RiderSignals.sendIntent(RiderSignalKind.HELP, RiderSignalContext(fix, insidePrivacyZone = false))

        val frame = intent!!.frame()
        assertEquals("signal", frame.getString("type"))
        assertEquals("help", frame.getString("kind"))
        assertEquals(52.0, frame.getDouble("lat"), 0.0)
        assertEquals(21.0, frame.getDouble("lng"), 0.0)
    }

    @Test
    fun `a send is rejected without a recent fix`() {
        assertNull(RiderSignals.sendIntent(RiderSignalKind.HELP, RiderSignalContext(null, insidePrivacyZone = false)))
        assertNull(RiderSignals.sendIntent(RiderSignalKind.HELP, RiderSignalContext(null, insidePrivacyZone = true)))
    }

    @Test
    fun `a send goes out while presence is gated by a Privacy Zone or unloaded zones`() {
        val zones = PrivacyZoneReadState()
        assertFalse("presence stays gated while zones load", zones.allowsLocationEgress)

        val loading = RiderSignalContext(fix, insidePrivacyZone = !zones.allowsLocationEgress)
        assertEquals(RiderSignalIntent.Send(RiderSignalKind.HELP, 52.0, 21.0), RiderSignals.sendIntent(RiderSignalKind.HELP, loading))
        assertEquals(
            RiderSignalIntent.Send(RiderSignalKind.DOWN, 52.0, 21.0),
            RiderSignals.sendIntent(RiderSignalKind.DOWN, RiderSignalContext(fix, insidePrivacyZone = true)),
        )
    }

    @Test
    fun `clear is a bare signal-clear frame`() {
        assertEquals("""{"type":"signal-clear"}""", RiderSignalIntent.Clear.frame().toString())
    }
}
