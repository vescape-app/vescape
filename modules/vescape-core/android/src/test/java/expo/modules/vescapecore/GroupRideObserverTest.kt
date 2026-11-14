package expo.modules.vescapecore

import android.os.Handler
import android.util.Log
import expo.modules.vescapecore.appstatus.OnlineCapability
import expo.modules.vescapecore.connection.PrivacyZoneReadState
import expo.modules.vescapecore.database.PrivacyZoneEntity
import expo.modules.vescapecore.protocol.LocationSnapshot
import kotlinx.coroutines.runBlocking
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyLong
import org.mockito.MockedStatic
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockStatic

/** @parity /modules/vescape-core/ios/groupride/GroupRideObserverTests.swift */
class GroupRideObserverTest {
    private class FakeSocket(private val request: Request) : WebSocket {
        val sent = mutableListOf<JSONObject>()
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String): Boolean = sent.add(JSONObject(text))
        override fun send(bytes: ByteString) = false
        override fun close(code: Int, reason: String?) = true
        override fun cancel() = Unit
    }

    private object Online : OnlineCapability {
        override val onlineBlocked = false
        override val appVersion = ""
        override fun refresh() = Unit
        override fun addListener(listener: () -> Unit): () -> Unit = {}
    }

    private lateinit var log: MockedStatic<Log>
    private val delayed = mutableListOf<Runnable>()
    private val sockets = mutableListOf<FakeSocket>()
    private val listeners = mutableListOf<WebSocketListener>()
    private var context = RiderSignalContext(fix = 52.0 to 21.0, insidePrivacyZone = false)
    private lateinit var observer: GroupRideObserver

    @Before
    fun setUp() {
        log = mockStatic(Log::class.java)
        // Main-looper stand-in: posts run inline, delayed work waits for [runDelayed].
        val handler = mock(Handler::class.java)
        doAnswer { (it.arguments[0] as Runnable).run(); true }.`when`(handler).post(any())
        doAnswer { delayed += it.arguments[0] as Runnable; true }.`when`(handler).postDelayed(any(), anyLong())
        val factory = object : WebSocket.Factory {
            override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket =
                FakeSocket(request).also { sockets += it; listeners += listener }
        }
        observer = GroupRideObserver(handler, { _, _ -> }, Online, signalContext = { context }, sockets = factory)
    }

    @After
    fun tearDown() = log.close()

    private fun open() {
        val socket = sockets.last()
        val response = Response.Builder().request(socket.request()).protocol(Protocol.HTTP_1_1).code(101).message("").build()
        listeners.last().onOpen(socket, response)
    }

    private fun receive(frame: JSONObject) = listeners.last().onMessage(sockets.last(), frame.toString())

    private fun connect(features: List<String>) {
        open()
        receive(JSONObject().put("type", "snapshot").put("rides", JSONArray()).put("features", JSONArray(features)))
    }

    private fun joined() = receive(JSONObject().put("type", "joined").put("rideId", "ride"))

    private fun joinRide(features: List<String> = listOf(PinSlot.SIGNAL.relayFeature, PinSlot.HAZARD.relayFeature)) {
        observer.start("ws://relay.test")
        connect(features)
        observer.join("me", "Me", "ride", null)
        joined()
    }

    private fun runDelayed() {
        val due = delayed.toList()
        delayed.clear()
        due.forEach(Runnable::run)
    }

    private fun frames(type: String) = sockets.flatMap { it.sent }.filter { it.getString("type") == type }

    @Test
    fun `a send emits a signal frame at the fix`() {
        joinRide()
        observer.sendSignal("down")

        val frame = frames("signal").single()
        assertEquals("down", frame.getString("kind"))
        assertEquals(52.0, frame.getDouble("lat"), 0.0)
        assertEquals(21.0, frame.getDouble("lng"), 0.0)
    }

    @Test
    fun `a clear emits signal-clear`() {
        joinRide()
        observer.clearSignal()

        assertEquals(1, frames("signal-clear").size)
    }

    @Test
    fun `a relay without rider-signals is sent nothing`() {
        joinRide(features = emptyList())
        observer.sendSignal("down")
        observer.clearSignal()

        assertTrue(frames("signal").isEmpty())
        assertTrue(frames("signal-clear").isEmpty())
    }

    @Test
    fun `an intent made while the link is down is replayed once after rejoin`() {
        joinRide()
        listeners.last().onClosed(sockets.last(), 1006, "")
        observer.sendSignal("wait")
        assertTrue(frames("signal").isEmpty())

        runDelayed()
        connect(listOf(PinSlot.SIGNAL.relayFeature, PinSlot.HAZARD.relayFeature))
        assertTrue("held until the ride is rejoined", frames("signal").isEmpty())
        joined()
        joined()

        assertEquals("wait", frames("signal").single().getString("kind"))
        assertEquals(2, sockets.size)
    }

    @Test
    fun `a signal goes out with a fix inside a Privacy Zone while presence stays suppressed`() {
        val fix = LocationSnapshot(52.0, 21.0, null, null, 5.0, null, timestamp = 1_000, precise = true)
        val zones = PrivacyZoneReadState()
        joinRide()

        // Zones still loading: presence is gated, a signal is not.
        assertNull(zones.presenceFix(fix))
        context = zones.signalContext(fix, nowMs = 2_000)
        observer.sendSignal("down")

        // Loaded, and the fix is inside one.
        runBlocking { zones.reload { listOf(PrivacyZoneEntity("home", "custom", "Home", true, 520_000_000, 210_000_000, 200, 1, 1)) } }
        assertNull(zones.presenceFix(fix))
        context = zones.signalContext(fix, nowMs = 2_000)
        assertTrue(context.insidePrivacyZone)
        observer.sendSignal("down")

        assertEquals(listOf("down", "down"), frames("signal").map { it.getString("kind") })
        assertTrue(frames("signal").all { it.getDouble("lat") == 52.0 && it.getDouble("lng") == 21.0 })
        assertTrue(frames("presence").isEmpty())
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

    @Test
    fun `a created ride cues for the rider's own ride or one nearby`() {
        val audible = GroupRideObserver::rideCreatedAudible
        assertEquals(true, audible("me", "me", 50.0, 20.0, null))
        assertEquals(false, audible("ola", "me", 50.0, 20.0, null))
        assertEquals(true, audible("ola", "me", 50.1, 20.0, 50.0 to 20.0))
        assertEquals(false, audible("ola", "me", 51.0, 20.0, 50.0 to 20.0))
        assertEquals(false, audible("", null, 51.0, 20.0, null))
    }
}
