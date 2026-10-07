package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Scheduler
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** @parity /modules/vescape-core/ios/watch/WatchMapTileSender.swift `maxSendsInFlight` */
internal const val WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT = 4

/** A tile whose download or send failed waits this long before it is tried again. */
internal const val WATCH_MAP_TILE_RETRY_MS = 30_000L

/**
 * How each platform puts tiles on the wrist and records which ones are there. The wrist never
 * reports its holdings (ADR-0019, ADR-0033), so the phone's own record is the truth.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTileSender.swift `WatchMapTileTransport`
 */
internal interface WatchMapTileTransport {
    /** Tiles of the current style the wrist already holds. */
    suspend fun delivered(): Set<WatchMapTile>

    /** The wrist should hold [wanted]; [dropped] leave it. Calls arrive in plan order. */
    suspend fun hold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>)

    /** Sends one tile's JPEG unchanged. True once the wrist is known to get it. */
    suspend fun send(tile: WatchMapTile, jpeg: File): Boolean
}

/**
 * Phone-owned street map for the wrist (#551): plans the wanted tiles with [WatchMapTilePlanner],
 * downloads them through the shared `MapTiles` cache ([fetch]) and sends the missing ones nearest
 * first, at most [WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT] at a time. State is confined to [scheduler];
 * downloads and transport calls run in [scope], which must not be the scheduler's thread.
 *
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
    /** Hold updates must reach the wrist in plan order; sends may overlap. */
    private val holds = Channel<Pair<List<WatchMapTile>, Set<WatchMapTile>>>(Channel.UNLIMITED)
    private var holdsDraining = false
    private var active = false
    private var generation = 0L
    private var delivered: MutableSet<WatchMapTile>? = null
    private var loading = false
    private var holdPending = false
    private val inFlight = mutableSetOf<WatchMapTile>()
    /** Tiles with a queued drop, by count: a send before the drop drains would be deleted by it. */
    private val dropping = mutableMapOf<WatchMapTile, Int>()
    /** Drops that reached the wrist while [load] ran; its answer may predate them. */
    private val droppedDuringLoad = mutableSetOf<WatchMapTile>()
    private val failedAtMs = mutableMapOf<WatchMapTile, Long>()

    /**
     * One watch tick. A null [rider] pauses sending: the wrist is asleep, in ambient or out of reach,
     * or there is no GPS fix. Sends already in flight finish; nothing new starts.
     */
    fun update(rider: WatchMapRider?) {
        if (rider == null) {
            active = false
            return
        }
        if (!active) {
            // A wrist coming back may have been reinstalled or reset; ask again what it holds.
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
                    // A tile whose drop is queued or landed meanwhile is gone however the query saw it.
                    delivered = (tiles - dropping.keys - droppedDuringLoad).toMutableSet()
                    // Tiles left from an older plan or session leave with the next hold.
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
            // The plan moved on while it was in flight: take it straight back off the wrist.
            else -> publishHold(wanted, setOf(tile))
        }
        pump()
    }
}
