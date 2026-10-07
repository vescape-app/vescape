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
        override suspend fun delivered() = held
        override suspend fun hold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>) { holds += wanted to dropped }
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
        val ring = watchMapTileRing(rider, 15)
        val transport = Transport(held = setOf(ring[1]))
        val sender = sender(transport)
        tick(sender, rider) // Reads what the wrist holds.
        tick(sender, rider)
        assertEquals(ring.filter { it != ring[1] }.take(WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT), transport.sends.map { it.first })
        transport.sends.first().second.complete(true)
        scheduler.runPending()
        assertEquals(WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT + 1, transport.sends.size)
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
        // A zoom change replaces the level, so every z15 tile leaves.
        tick(sender, rider.copy(spanM = 300.0))
        assertEquals(z15, transport.holds.last().second)
        assertTrue(transport.holds.last().first.all { it.z == 16 })
    }
}
