package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Scheduler
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** @parity /modules/vescape-core/ios/watch/WatchMapTileSender.swift `maxSendsInFlight` */
internal const val WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT = 4

internal const val WATCH_MAP_TILE_RETRY_MS = 30_000L

/**
 * @parity /modules/vescape-core/ios/watch/WatchMapTileSender.swift `WatchMapTileTransport`
 */
internal interface WatchMapTileTransport {
    suspend fun delivered(): Set<WatchMapTile>

    suspend fun hold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>)

    suspend fun send(tile: WatchMapTile, jpeg: File): Boolean
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchMapTileSender.swift `WatchMapTileSender`
 */
internal class WatchMapTileSender(
    private val scheduler: Scheduler,
    private val scope: CoroutineScope,
    private val nowMs: () -> Long,
    private val fetch: suspend (WatchMapTile) -> File?,
    private val transport: WatchMapTileTransport,
) {
    private val planner = WatchMapTilePlanner()
    private val holds = Channel<Pair<List<WatchMapTile>, Set<WatchMapTile>>>(Channel.UNLIMITED)
    private var holdsDraining = false
    private var active = false
    private var generation = 0L
    private var delivered: MutableSet<WatchMapTile>? = null
    private var loading = false
    private var holdPending = false
    private val inFlight = mutableSetOf<WatchMapTile>()
    private val dropping = mutableMapOf<WatchMapTile, Int>()
    private val droppedDuringLoad = mutableSetOf<WatchMapTile>()
    private val failedAtMs = mutableMapOf<WatchMapTile, Long>()

    fun update(rider: WatchMapRider?) {
        if (rider == null) {
            active = false
            return
        }
        if (!active) {
            active = true
            generation++
            delivered = null
            loading = false
        }
        val held = delivered ?: return load()
        if (planner.update(rider) || holdPending) {
            holdPending = false
            val wanted = planner.wanted.map { it.tile }
            val wantedSet = wanted.toSet()
            val dropped = held.filterTo(HashSet()) { it !in wantedSet }
            held.removeAll(dropped)
            failedAtMs.keys.retainAll(wantedSet)
            publishHold(wanted, dropped)
        }
        pump()
    }

    private fun load() {
        if (loading) return
        loading = true
        droppedDuringLoad.clear()
        val requested = generation
        scope.launch {
            // intentional-suppression: a failed lookup leaves delivered unknown and is retried next tick
            val tiles = runCatching { transport.delivered() }.getOrNull()
            scheduler.post {
                if (requested != generation) return@post
                loading = false
                if (tiles != null) {
                    delivered = (tiles - dropping.keys - droppedDuringLoad).toMutableSet()
                    holdPending = true
                }
            }
        }
    }

    private fun publishHold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>) {
        if (!holdsDraining) {
            holdsDraining = true
            scope.launch {
                for ((w, d) in holds) {
                    // intentional-suppression: a failed drop leaves an extra tile on the wrist until the next plan
                    runCatching { transport.hold(w, d) }
                    scheduler.post { dropped(d) }
                }
            }
        }
        for (tile in dropped) dropping.merge(tile, 1, Int::plus)
        holds.trySend(wanted to dropped)
    }

    private fun dropped(tiles: Set<WatchMapTile>) {
        for (tile in tiles) dropping.computeIfPresent(tile) { _, count -> (count - 1).takeIf { it > 0 } }
        delivered?.removeAll(tiles)
        if (loading) droppedDuringLoad += tiles
        pump()
    }

    private fun pump() {
        val held = delivered ?: return
        if (!active) return
        val now = nowMs()
        for (need in planner.wanted) {
            if (inFlight.size >= WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT) return
            val tile = need.tile
            if (tile in held || tile in inFlight || tile in dropping) continue
            val failedAt = failedAtMs[tile]
            if (failedAt != null && now - failedAt < WATCH_MAP_TILE_RETRY_MS) continue
            inFlight += tile
            scope.launch {
                // intentional-suppression: a failed send is retried after WATCH_MAP_TILE_RETRY_MS
                val sent = runCatching { fetch(tile)?.let { transport.send(tile, it) } == true }.getOrDefault(false)
                scheduler.post { landed(tile, sent) }
            }
        }
    }

    private fun landed(tile: WatchMapTile, sent: Boolean) {
        inFlight -= tile
        val wanted = planner.wanted.map { it.tile }
        when {
            !sent -> failedAtMs[tile] = nowMs()
            tile in wanted -> delivered?.add(tile)
            else -> publishHold(wanted, setOf(tile))
        }
        pump()
    }
}
