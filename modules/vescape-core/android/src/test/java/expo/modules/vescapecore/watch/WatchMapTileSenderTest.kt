package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Issue #551: delivery order, the in-flight limit, sleep and drops, against a scripted transport. */
class WatchMapTileSenderTest {
    private class Transport(var held: Set<WatchMapTile> = emptySet()) : WatchMapTileTransport {
        val sends = mutableListOf<Pair<WatchMapTile, CompletableDeferred<Boolean>>>()
        val holds = mutableListOf<Pair<List<WatchMapTile>, Set<WatchMapTile>>>()
        /** While set and open, a hold has not reached the wrist yet. */
        var holdGate: CompletableDeferred<Unit>? = null
        override suspend fun delivered() = held
        override suspend fun hold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>) {
            holds += wanted to dropped
            holdGate?.await()
        }
        override suspend fun send(tile: WatchMapTile, jpeg: File): Boolean =
            CompletableDeferred<Boolean>().also { sends += tile to it }.await()
    }

    private val scheduler = TestScheduler()
    private val rider = WatchMapRider(WatchMapPosition(51.13185, 16.98653), 90.0, 5.0, null)

    private fun sender(transport: Transport) = WatchMapTileSender(
        scheduler, CoroutineScope(Dispatchers.Unconfined), { scheduler.currentTimeMs },
        fetch = { File("tile.jpg") }, transport = transport,
    )

    private fun tick(sender: WatchMapTileSender, rider: WatchMapRider?) {
        sender.update(rider)
        scheduler.runPending()
    }

    @Test fun `sends nearest first, four at a time, and only what the wrist lacks`() {
        val ring = watchMapTileNeeded(rider, 15)
        val transport = Transport(held = setOf(ring[1]))
        val sender = sender(transport)
        tick(sender, rider) // Reads what the wrist holds.
        tick(sender, rider)
        assertEquals(ring.filter { it != ring[1] }.take(WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT), transport.sends.map { it.first })
        transport.sends.first().second.complete(true)
        scheduler.runPending()
        assertEquals(WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT + 1, transport.sends.size)
    }

    private fun completeSends(transport: Transport) {
        while (transport.sends.any { !it.second.isCompleted }) {
            transport.sends.filter { !it.second.isCompleted }.forEach { it.second.complete(true) }
            scheduler.runPending()
        }
    }

    @Test fun `ring tiles go out before route tiles`() {
        val route = WatchMapRoute((0..30).map { WatchMapPosition(51.13185, 16.98653 + it * 0.01) })
        val onRoute = rider.copy(route = WatchMapRouteProgress(route, route.lengthM))
        val ring = watchMapTileNeeded(onRoute, 15)
        val transport = Transport()
        val sender = sender(transport)
        tick(sender, onRoute)
        tick(sender, onRoute)
        // Complete every send as it starts; the order they started in is the order they were wanted.
        completeSends(transport)
        val sent = transport.sends.map { it.first }
        assertEquals(ring, sent.take(ring.size))
        assertTrue(sent.size > ring.size)
        assertEquals(sent.size, sent.toSet().size)
    }

    @Test fun `nothing new starts while the wrist sleeps`() {
        val transport = Transport()
        val sender = sender(transport)
        tick(sender, rider)
        tick(sender, rider)
        val started = transport.sends.size
        tick(sender, null)
        transport.sends.first().second.complete(true)
        scheduler.runPending()
        assertEquals(started, transport.sends.size)
        tick(sender, rider) // Waking re-reads the wrist, then resumes.
        tick(sender, rider)
        assertTrue(transport.sends.size > started)
    }

    @Test fun `tiles leaving the plan are dropped from the wrist`() {
        val z15 = watchMapTileRing(rider, 15).toSet()
        val transport = Transport(held = z15 + WatchMapTile(15, 0, 0))
        val sender = sender(transport)
        tick(sender, rider)
        tick(sender, rider)
        // Left over from an earlier session.
        assertEquals(setOf(WatchMapTile(15, 0, 0)), transport.holds.single().second)
        // Zooming in keeps z15 as the one-out level.
        tick(sender, rider.copy(spanM = 300.0))
        assertEquals(emptySet<WatchMapTile>(), transport.holds.last().second)
        // Two levels out, z15 is neither planned nor the level just left, so every z15 tile leaves.
        tick(sender, rider.copy(spanM = 1_400.0))
        assertEquals(z15, transport.holds.last().second)
        assertTrue(transport.holds.last().first.none { it.z == 15 })
    }

    @Test fun `a tile wanted again before its drop reaches the wrist is sent after the drop`() {
        val zoomedIn = rider.copy(spanM = 300.0)
        val z16 = watchMapTileRing(zoomedIn, 16).toSet()
        val transport = Transport(held = z16)
        val sender = sender(transport)
        tick(sender, zoomedIn)
        tick(sender, zoomedIn)
        // Out to z14, z16 stays as the level just left; back in to z15 it leaves.
        tick(sender, rider.copy(spanM = 1_400.0))
        completeSends(transport)
        val gate = CompletableDeferred<Unit>()
        transport.holdGate = gate
        tick(sender, rider)
        assertTrue(transport.holds.last().second.containsAll(z16))
        completeSends(transport)
        // Wanted again while that drop is still queued.
        tick(sender, zoomedIn)
        completeSends(transport)
        assertTrue(transport.sends.none { it.first in z16 })
        // Sent before the drop drained, the drop would delete it while the phone counts it delivered.
        gate.complete(Unit)
        scheduler.runPending()
        assertTrue(transport.sends.any { it.first in z16 })
    }

    @Test fun `a wake reload does not count a tile whose drop is still queued as delivered`() {
        val zoomedIn = rider.copy(spanM = 300.0)
        val z16 = watchMapTileRing(zoomedIn, 16).toSet()
        val transport = Transport(held = z16)
        val sender = sender(transport)
        tick(sender, zoomedIn)
        tick(sender, zoomedIn)
        tick(sender, rider.copy(spanM = 1_400.0))
        completeSends(transport)
        val gate = CompletableDeferred<Unit>()
        transport.holdGate = gate
        tick(sender, rider)
        assertTrue(transport.holds.last().second.containsAll(z16))
        completeSends(transport)
        // Asleep and awake again before the drop lands: the reload still finds z16 on the wrist.
        tick(sender, null)
        tick(sender, zoomedIn)
        tick(sender, zoomedIn)
        completeSends(transport)
        assertTrue(transport.sends.none { it.first in z16 })
        gate.complete(Unit)
        scheduler.runPending()
        completeSends(transport)
        assertTrue(transport.sends.map { it.first }.containsAll(z16))
    }
}
