package expo.modules.vescapecore

import android.os.Handler
import expo.modules.vescapecore.appstatus.OnlineCapability
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.TestScheduler
import okhttp3.Request
import okhttp3.Response
import okhttp3.Protocol
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyLong
import expo.modules.vescapecore.auth.DeviceCredential
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.junit.Assert.assertFalse
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

        assertNull(zones.presenceFix(fix))
        assertNotNull(RiderSignals.sendIntent(RiderSignalKind.DOWN, zones.signalContext(fix, nowMs = 2_000)))

        runBlocking { zones.reload { listOf(PrivacyZoneEntity("home", "custom", "Home", true, 520_000_000, 210_000_000, 200, 1, 1)) } }
        assertNull(zones.presenceFix(fix))
        val context = zones.signalContext(fix, nowMs = 2_000)
        assertTrue(context.insidePrivacyZone)
        val frame = (RiderSignals.sendIntent(RiderSignalKind.DOWN, context) as RiderPinIntent.Send).frame()
        assertEquals("down", frame.getString("kind"))
        assertEquals(52.0, frame.getDouble("lat"), 0.0)
        assertEquals(21.0, frame.getDouble("lng"), 0.0)
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
    private class RelayHarness {
        val clock = TestScheduler()
        val handler = mock(Handler::class.java)
        private val tasks = mutableMapOf<Runnable, MutableList<Cancellable>>()
        var blocked = false
        var onlineChanged: (() -> Unit)? = null
        var newNetwork: (() -> Unit)? = null
        var account: String? = "acc"
        var token: String? = "token"
        val links = mutableListOf<Link>()
        val demand = mutableListOf<Boolean>()
        val events = mutableListOf<Pair<String, Map<String, Any?>>>()
        val observer: GroupRideObserver

        class Link(val request: Request, val listener: WebSocketListener) {
            val frames = mutableListOf<JSONObject>()
            var closed = false
            val socket = object : WebSocket {
                override fun request() = request
                override fun queueSize() = 0L
                override fun send(text: String): Boolean { frames += JSONObject(text); return true }
                override fun send(bytes: ByteString) = false
                override fun close(code: Int, reason: String?): Boolean { closed = true; return true }
                override fun cancel() { closed = true }
            }
            fun open() = listener.onOpen(socket, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("open").build())
            fun message(text: String) = listener.onMessage(socket, text)
            fun types() = frames.map { it.getString("type") }
        }

        init {
            doAnswer { call -> clock.post { call.getArgument<Runnable>(0).run() }; true }.`when`(handler).post(any(Runnable::class.java))
            doAnswer { call ->
                val runnable = call.getArgument<Runnable>(0)
                tasks.getOrPut(runnable) { mutableListOf() } += clock.postDelayed(call.getArgument(1)) { runnable.run() }
                true
            }.`when`(handler).postDelayed(any(Runnable::class.java), anyLong())
            doAnswer { call -> tasks.remove(call.getArgument<Runnable>(0))?.forEach { it.cancel() }; null }.`when`(handler).removeCallbacks(any(Runnable::class.java))
            observer = GroupRideObserver(
                handler = handler,
                emit = { name, body -> events += name to body },
                online = object : OnlineCapability {
                    override val onlineBlocked get() = blocked
                    override val appVersion = "1.0.0"
                    override fun refresh() {}
                    override fun addListener(listener: () -> Unit): () -> Unit {
                        onlineChanged = listener
                        return { onlineChanged = null }
                    }
                },
                deviceCredential = { account?.let { id -> token?.let { DeviceCredential("https://example.com", it, id, null) } } },
                onPublicRideDemandChanged = { demand += observerNeedsLink() },
                now = { clock.currentTimeMs },
                watchNetwork = { onNewNetwork ->
                    newNetwork = onNewNetwork
                    { newNetwork = null }
                },
                sockets = WebSocket.Factory { request, listener -> Link(request, listener).also { links += it }.socket },
            )
        }
        private fun observerNeedsLink() = observer.publicRideNeedsLink
        fun flush() = clock.advance(0)
        fun ready(link: Link = links.last(), features: String = "\"public-ride\",\"missed-positions\"") {
            link.open()
            link.message("""{"type":"snapshot","features":[$features]}""")
            flush()
        }
        fun drop(link: Link = links.last()) {
            link.listener.onClosed(link.socket, 1000, "lost")
            flush()
        }
        fun offlineBuffer() {
            observer.loadPublicRide(PublicRideSwitch(true, null), "acc")
            observer.setBoardConnected(true)
            flush()
            observer.start("wss://example.com/ws/group-rides")
            ready()
            links.last().listener.onClosed(links.last().socket, 1000, "offline")
            flush()
            observer.pushPresence(RiderPresence(52.0, 21.0, null, null, null, null, null, null, null, atMs = 10_000))
            observer.setBoardConnected(false)
            flush()
            assertTrue(observer.publicRideNeedsLink)
        }
    }

    @Test
    fun `completed buffer owns reconnect retries without GPS and releases demand only after ack`() {
        val h = RelayHarness()
        h.offlineBuffer()
        val old = h.links.last()
        h.clock.advance(1_000)
        h.ready()
        assertEquals(listOf("missed-positions"), h.links.last().types())
        assertEquals("Bearer token", h.links.last().request.header("Authorization"))
        val firstUpload = h.links.last()
        h.clock.advance(PublicRide.MISSED_RETRY_MS)
        assertTrue(firstUpload.closed)
        assertTrue(h.observer.publicRideNeedsLink)
        h.clock.advance(1_000)
        h.ready()
        val retry = h.links.last()
        assertEquals(listOf("missed-positions"), retry.types())
        old.message("""{"type":"missed-stored"}""")
        firstUpload.message("""{"type":"missed-stored"}""")
        h.flush()
        assertTrue(h.observer.publicRideNeedsLink)
        retry.message("""{"type":"missed-stored"}""")
        h.flush()
        assertFalse(h.observer.publicRideNeedsLink)
        assertEquals(false, h.demand.last())
        val count = h.links.size
        h.clock.advance(PublicRide.MISSED_RETRY_MS * 2)
        assertEquals(count, h.links.size)
        h.observer.stop()
    }

    @Test
    fun `pending upload respects online blocks anonymous upgrades and account switches`() {
        val h = RelayHarness()
        h.offlineBuffer()
        h.blocked = true
        h.onlineChanged?.invoke()
        h.clock.advance(30_000)
        assertEquals(1, h.links.size)
        assertTrue(h.observer.publicRideNeedsLink)
        h.token = null
        h.blocked = false
        h.onlineChanged?.invoke()
        h.ready()
        assertTrue(h.links.last().frames.isEmpty())
        assertTrue(h.observer.publicRideNeedsLink)
        h.token = "restored-token"
        h.observer.setAccount("acc")
        h.flush()
        h.clock.advance(1_000)
        h.ready()
        assertEquals(listOf("missed-positions"), h.links.last().types())
        h.account = "other"
        h.token = "other-token"
        h.observer.setAccount("other")
        h.flush()
        h.clock.advance(1_000)
        h.ready()
        assertTrue(h.links.last().frames.isEmpty())
        assertFalse(h.observer.publicRideNeedsLink)
        h.observer.stop()
    }

    @Test
    fun `replayEvent and resync emit current state only while active`() {
        val h = RelayHarness()
        h.observer.replayEvent("onGroupRideConnection")
        h.observer.replayEvent("onPublicRideStatus")
        h.observer.resync()
        h.flush()
        assertTrue(h.events.isEmpty())

        h.observer.start("wss://example.com/ws/group-rides")
        h.ready()
        h.events.clear()

        h.observer.replayEvent("onGroupRideConnection")
        h.flush()
        assertEquals(listOf("onGroupRideConnection"), h.events.map { it.first })
        assertEquals("connected", h.events.single().second["state"])

        h.events.clear()
        h.observer.replayEvent("onPublicRideStatus")
        h.flush()
        assertEquals(listOf("onPublicRideStatus"), h.events.map { it.first })
        assertEquals(true, h.events.single().second["supported"])

        h.events.clear()
        h.observer.replayEvent("onGroupRideSignalAvailability")
        h.flush()
        assertEquals(listOf("onGroupRideSignalAvailability"), h.events.map { it.first })

        h.events.clear()
        h.observer.replayEvent("onPublicRiders")
        h.flush()
        assertEquals(listOf("onPublicRiders"), h.events.map { it.first })

        h.events.clear()
        h.observer.replayEvent("onPublicPins")
        h.flush()
        assertEquals(listOf("onPublicPins"), h.events.map { it.first })

        h.events.clear()
        h.observer.resync()
        h.flush()
        assertEquals(
            setOf(
                "onGroupRideConnection",
                "onGroupRideSignalAvailability",
                "onPublicRideStatus",
                "onPublicRiders",
                "onPublicPins",
            ),
            h.events.map { it.first }.toSet(),
        )
        assertEquals(true, h.events.last { it.first == "onPublicRideStatus" }.second["supported"])

        h.observer.stop()
        h.events.clear()
        h.observer.replayEvent("onPublicRideStatus")
        h.observer.resync()
        h.flush()
        assertTrue(h.events.isEmpty())
    }

    @Test
    fun `a stored switch loaded after the relay snapshot still goes public`() {
        val h = RelayHarness()
        h.observer.setBoardConnected(true)
        h.observer.start("wss://example.com/ws/group-rides")
        h.ready()
        assertTrue(h.links.last().frames.isEmpty())

        h.observer.loadPublicRide(PublicRideSwitch(true, null), "acc")
        h.flush()

        assertEquals(listOf("public-on"), h.links.last().types())
        assertEquals(true, h.demand.last())
        h.observer.stop()
    }

    @Test
    fun `starting on another server closes the old link`() {
        val h = RelayHarness()
        h.observer.start("wss://example.com/ws/group-rides")
        h.ready()
        val old = h.links.last()

        h.observer.start("wss://other.example.com/ws/group-rides")
        h.flush()

        assertTrue(old.closed)
        assertEquals(2, h.links.size)
        h.observer.stop()
    }

    @Test
    fun `a lost link retries within seconds and at once on a new network or foreground`() {
        val h = RelayHarness()
        h.observer.start("wss://example.com/ws/group-rides")
        h.ready()
        repeat(6) {
            val count = h.links.size
            h.drop()
            h.clock.advance(3_000)
            assertEquals(count + 1, h.links.size)
        }

        h.drop()
        val waiting = h.links.size
        h.newNetwork!!.invoke()
        h.flush()
        assertEquals(waiting + 1, h.links.size)
        h.clock.advance(5_000)
        assertEquals(waiting + 1, h.links.size)

        val pending = h.links.last()
        h.newNetwork!!.invoke()
        h.flush()
        assertTrue(pending.closed)
        assertEquals(waiting + 2, h.links.size)

        h.drop()
        h.observer.resync()
        h.flush()
        assertEquals(waiting + 3, h.links.size)
        h.observer.resync()
        h.flush()
        assertEquals(waiting + 3, h.links.size)

        h.ready()
        h.newNetwork!!.invoke()
        h.observer.resync()
        h.flush()
        assertEquals(waiting + 3, h.links.size)

        h.observer.stop()
        assertNull(h.newNetwork)
    }
}
