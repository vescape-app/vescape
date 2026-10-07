package expo.modules.vescapecore.watch

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.tan

/**
 * Which street-map tiles the wrist should hold (#551). Pure: the phone decides from the rider's
 * position, course, speed and the span the wrist draws, and the wrist never reports holdings.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTilePlan.swift
 */

/** The rider as the tile plan needs them, from the same snapshot the Watch Frame is built from. */
internal data class WatchMapRider(
    val position: WatchMapPosition,
    val courseDeg: Double?,
    val speedMps: Double?,
    /** Phone map span; null while the phone map is unmounted, which the wrist draws at the default. */
    val spanM: Double?,
)

/** A tile on the wanted list and the plan step that last needed it. */
internal data class WatchMapTileNeed(val tile: WatchMapTile, val neededAt: Long)

/** Most tiles the wrist holds. Least recently needed tiles behind the rider leave first. */
internal const val WATCH_MAP_TILE_CAP = 200

/** The ring is centred this far ahead at the current speed, or half a span if that is further. */
internal const val WATCH_MAP_LOOKAHEAD_S = 30.0

/** Ring radius in spans, around that centre. */
internal const val WATCH_MAP_RING_SPANS = 1.0

/** A course change larger than this re-plans the ring even inside the same tile. */
internal const val WATCH_MAP_REPLAN_TURN_DEG = 45.0

private const val TILE_PIXELS = 512.0

/**
 * Tiles at [zoom] within [WATCH_MAP_RING_SPANS] spans of a centre ahead of the rider along their
 * course, nearest the rider first. Columns wrap across the antimeridian; rows stop at the poles.
 */
internal fun watchMapTileRing(rider: WatchMapRider, zoom: Int): List<WatchMapTile> {
    val n = 1 shl zoom
    val (riderX, riderY) = tileCoordinates(rider.position, n)
    val tileM = tileMetres(rider.position.latitude, zoom)
    val spanM = WatchMapSpan.clamp(rider.spanM).toDouble()
    val aheadM = if (rider.courseDeg == null) 0.0 else max(spanM / 2, (rider.speedMps ?: 0.0) * WATCH_MAP_LOOKAHEAD_S)
    val course = Math.toRadians(rider.courseDeg ?: 0.0)
    val centreX = riderX + aheadM * sin(course) / tileM
    val centreY = riderY - aheadM * cos(course) / tileM
    val radius = spanM * WATCH_MAP_RING_SPANS / tileM
    val ring = mutableListOf<Pair<WatchMapTile, Double>>()
    for (row in max(0, floor(centreY - radius).toInt())..minOf(n - 1, floor(centreY + radius).toInt())) {
        for (column in floor(centreX - radius).toInt()..floor(centreX + radius).toInt()) {
            val nearestX = centreX.coerceIn(column.toDouble(), column + 1.0)
            val nearestY = centreY.coerceIn(row.toDouble(), row + 1.0)
            if (hypot(nearestX - centreX, nearestY - centreY) > radius) continue
            val tile = WatchMapTile(zoom, Math.floorMod(column, n), row)
            ring += tile to hypot(column + 0.5 - riderX, row + 0.5 - riderY)
        }
    }
    return ring.sortedWith(compareBy({ it.second }, { it.first.key })).map { it.first }.distinct()
}

/**
 * The wanted list after a plan step: [needed] first in its own order, then tiles held from earlier
 * steps at the same zoom levels, most recently needed first and ahead of the rider before behind,
 * then tiles of [previousZoom], the level the last zoom change left, in the same order. All cut at
 * [cap]. Keeping the previous level lets the wrist draw it until the new one arrives; it leaves with
 * the next zoom change or the cap.
 *
 * [needed] is the seam for more tile sources (route ahead): pass them in priority order.
 */
internal fun retainWatchMapTiles(
    needed: List<WatchMapTile>,
    held: List<WatchMapTileNeed>,
    rider: WatchMapRider,
    step: Long,
    cap: Int = WATCH_MAP_TILE_CAP,
    previousZoom: Int? = null,
): List<WatchMapTileNeed> {
    val neededSet = needed.toSet()
    val zooms = neededSet.mapTo(HashSet()) { it.z }
    val order = compareBy<WatchMapTileNeed> { if (it.tile.z in zooms) 0 else 1 }
        .thenByDescending { it.neededAt }
        .thenBy { isBehind(it.tile, rider) }
        .thenBy { riderDistance(it.tile, rider) }
    val older = held
        .filter { (it.tile.z in zooms || it.tile.z == previousZoom) && it.tile !in neededSet }
        .sortedWith(order)
    return (needed.distinct().map { WatchMapTileNeed(it, step) } + older).take(cap)
}

/**
 * Tiles one plan step needs at [zoom]: the ring one zoom out first, about four tiles that cover the
 * face on their own once scaled up, then the ring at [zoom] itself.
 */
internal fun watchMapTileNeeded(rider: WatchMapRider, zoom: Int): List<WatchMapTile> =
    (if (zoom > 0) watchMapTileRing(rider, zoom - 1) else emptyList()) + watchMapTileRing(rider, zoom)

/**
 * The stateful half: re-plans only when the rider enters a new tile, the zoom changes, or the course
 * turns by more than [WATCH_MAP_REPLAN_TURN_DEG]. Everything it decides is in the pure functions above.
 */
internal class WatchMapTilePlanner(private val cap: Int = WATCH_MAP_TILE_CAP) {
    private var zoom: Int? = null
    private var previousZoom: Int? = null
    private var riderTile: WatchMapTile? = null
    private var plannedCourseDeg: Double? = null
    private var step = 0L

    var wanted: List<WatchMapTileNeed> = emptyList()
        private set

    /** True when [wanted] changed. */
    fun update(rider: WatchMapRider): Boolean {
        val nextZoom = watchMapTileZoom(rider.spanM, rider.position.latitude, zoom)
        val (x, y) = tileCoordinates(rider.position, 1 shl nextZoom)
        val tile = WatchMapTile(nextZoom, floor(x).toInt(), floor(y).toInt())
        val course = rider.courseDeg
        val turned = course != null &&
            (plannedCourseDeg?.let { abs(shortestTurnDeg(it, course)) > WATCH_MAP_REPLAN_TURN_DEG } ?: true)
        if (nextZoom == zoom && tile == riderTile && !turned) return false
        if (zoom != null && nextZoom != zoom) previousZoom = zoom
        zoom = nextZoom
        riderTile = tile
        if (course != null) plannedCourseDeg = course
        step++
        wanted = retainWatchMapTiles(watchMapTileNeeded(rider, nextZoom), wanted, rider, step, cap, previousZoom)
        return true
    }
}

/** Fractional Web Mercator tile coordinates of [position] on an [n]×[n] grid. */
private fun tileCoordinates(position: WatchMapPosition, n: Int): Pair<Double, Double> {
    val latitude = Math.toRadians(position.latitude.coerceIn(-WATCH_MAP_MAX_MERCATOR_LATITUDE, WATCH_MAP_MAX_MERCATOR_LATITUDE))
    val x = (position.longitude + 180.0) / 360.0 * n
    val y = (1 - ln(tan(latitude) + 1 / cos(latitude)) / PI) / 2 * n
    return x.coerceIn(0.0, n.toDouble().minus(1e-9)) to y.coerceIn(0.0, n.toDouble().minus(1e-9))
}

private fun tileMetres(latitude: Double, zoom: Int): Double =
    TILE_PIXELS * WATCH_MAP_ZOOM0_METRES_PER_PIXEL * cos(Math.toRadians(latitude.coerceIn(-WATCH_MAP_MAX_MERCATOR_LATITUDE, WATCH_MAP_MAX_MERCATOR_LATITUDE))) / (1 shl zoom)

/** Tile centre minus rider, in tiles, with columns wrapped to the short way round. */
private fun riderDelta(tile: WatchMapTile, rider: WatchMapRider): Pair<Double, Double> {
    val n = 1 shl tile.z
    val (x, y) = tileCoordinates(rider.position, n)
    val dx = ((tile.x + 0.5 - x) % n + n + n / 2.0) % n - n / 2.0
    return dx to tile.y + 0.5 - y
}

private fun riderDistance(tile: WatchMapTile, rider: WatchMapRider): Double =
    riderDelta(tile, rider).let { (dx, dy) -> hypot(dx, dy) }

private fun isBehind(tile: WatchMapTile, rider: WatchMapRider): Boolean {
    val course = Math.toRadians(rider.courseDeg ?: return false)
    val (dx, dy) = riderDelta(tile, rider)
    return dx * sin(course) - dy * cos(course) < 0
}

private fun shortestTurnDeg(from: Double, to: Double): Double = (((to - from + 180) % 360) + 360) % 360 - 180
