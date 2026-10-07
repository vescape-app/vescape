package expo.modules.vescapecore.watch

import expo.modules.vescapecore.geo.GeoMath
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
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
    /** Where the rider is on the Navigation route; null without one. */
    val route: WatchMapRouteProgress? = null,
)

/**
 * A Navigation path as the tile plan walks it: [points] in ridden order and the great-circle metres
 * along it to each, measured as Route Progress measures them. Compared by identity: a new path is a
 * new route.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTilePlan.swift `WatchMapRoute`
 */
internal class WatchMapRoute(val points: List<WatchMapPosition>) {
    private val alongM = DoubleArray(points.size).also { along ->
        for (index in 1 until points.size) {
            val (from, to) = points[index - 1] to points[index]
            along[index] = along[index - 1] + GeoMath.distanceMeters(from.latitude, from.longitude, to.latitude, to.longitude)
        }
    }

    val lengthM: Double get() = alongM.lastOrNull() ?: 0.0

    /**
     * The segment holding the point [remainingM] before the end, and that point, interpolated the way
     * Route Progress projects it. Null for a path with fewer than two points.
     */
    fun pointBefore(remainingM: Double): Pair<Int, WatchMapPosition>? {
        if (points.size < 2) return null
        val target = (lengthM - remainingM).coerceIn(0.0, lengthM)
        var segment = alongM.binarySearch(target).let { if (it >= 0) it else -it - 2 }.coerceIn(0, points.size - 2)
        while (segment < points.size - 2 && alongM[segment + 1] <= target) segment++
        val length = alongM[segment + 1] - alongM[segment]
        val fraction = if (length == 0.0) 0.0 else ((target - alongM[segment]) / length).coerceIn(0.0, 1.0)
        val (from, to) = points[segment] to points[segment + 1]
        // The short way round, so a segment across the antimeridian stays on it.
        val longitudeDelta = ((to.longitude - from.longitude + 540) % 360) - 180
        return segment to WatchMapPosition(
            from.latitude + (to.latitude - from.latitude) * fraction,
            ((from.longitude + longitudeDelta * fraction + 540) % 360) - 180,
        )
    }
}

/** The rider on [route]: [remainingM] along the path to its end, from Route Progress. */
internal data class WatchMapRouteProgress(val route: WatchMapRoute, val remainingM: Double)

/**
 * A tile on the wanted list and the plan step that last needed it. A [route] tile is wanted only for
 * the route ahead, so it leaves as soon as the route stops wanting it (passed, rerouted, cleared).
 */
internal data class WatchMapTileNeed(val tile: WatchMapTile, val neededAt: Long, val route: Boolean = false)

/** Most tiles the wrist holds. Least recently needed tiles behind the rider leave first. */
internal const val WATCH_MAP_TILE_CAP = 200

/** The ring is centred this far ahead at the current speed, or half a span if that is further. */
internal const val WATCH_MAP_LOOKAHEAD_S = 30.0

/** Ring radius in spans, around that centre. */
internal const val WATCH_MAP_RING_SPANS = 1.0

/**
 * Route corridor half-width in spans: every tile within this of the path ahead, which is the face
 * around the rider wherever they are on it.
 */
internal const val WATCH_MAP_ROUTE_CORRIDOR_SPANS = 0.5

/** The path ahead is sampled at most this many tiles apart, well under the corridor radius. */
private const val ROUTE_SAMPLE_TILES = 0.25

/** A course change larger than this re-plans the ring even inside the same tile. */
internal const val WATCH_MAP_REPLAN_TURN_DEG = 45.0

private const val TILE_PIXELS = 512.0

/**
 * Tiles at [zoom] within [WATCH_MAP_RING_SPANS] spans of a centre ahead of the rider along their
 * course, or of the rider themselves without [lookahead], nearest the rider first. Columns wrap
 * across the antimeridian; rows stop at the poles.
 */
internal fun watchMapTileRing(rider: WatchMapRider, zoom: Int, lookahead: Boolean = true): List<WatchMapTile> {
    val n = 1 shl zoom
    val (riderX, riderY) = tileCoordinates(rider.position, n)
    val tileM = tileMetres(rider.position.latitude, zoom)
    val spanM = WatchMapSpan.clamp(rider.spanM).toDouble()
    val aheadM = if (!lookahead || rider.courseDeg == null) 0.0 else max(spanM / 2, (rider.speedMps ?: 0.0) * WATCH_MAP_LOOKAHEAD_S)
    val course = Math.toRadians(rider.courseDeg ?: 0.0)
    val centreX = riderX + aheadM * sin(course) / tileM
    val centreY = riderY - aheadM * cos(course) / tileM
    val radius = spanM * WATCH_MAP_RING_SPANS / tileM
    return tilesWithin(centreX, centreY, radius, zoom) { column, row -> hypot(column + 0.5 - riderX, row + 0.5 - riderY) }
}

/**
 * Tiles at [zoom] within [WATCH_MAP_ROUTE_CORRIDOR_SPANS] spans of the route ahead of the rider, from
 * their Route Progress to the end, nearest along the path first, at most [limit]. Empty without a
 * route. The path is walked in tile space, so the antimeridian is crossed the short way round.
 */
internal fun watchMapRouteTiles(rider: WatchMapRider, zoom: Int, limit: Int = WATCH_MAP_TILE_CAP): List<WatchMapTile> {
    val progress = rider.route ?: return emptyList()
    val points = progress.route.points
    val (segment, start) = progress.route.pointBefore(progress.remainingM) ?: return emptyList()
    val n = 1 shl zoom
    val radius = WatchMapSpan.clamp(rider.spanM) * WATCH_MAP_ROUTE_CORRIDOR_SPANS / tileMetres(start.latitude, zoom)
    val tiles = LinkedHashSet<WatchMapTile>()
    var (x, y) = tileCoordinates(start, n)
    fun visit(sampleX: Double, sampleY: Double) {
        for (tile in tilesWithin(sampleX, sampleY, radius, zoom) { column, row -> hypot(column + 0.5 - sampleX, row + 0.5 - sampleY) }) {
            if (tiles.size >= limit) return
            tiles += tile
        }
    }
    visit(x, y)
    for (index in segment + 1 until points.size) {
        if (tiles.size >= limit) break
        val (nextX, nextY) = tileCoordinates(points[index], n)
        val dx = ((nextX - x) % n + n + n / 2.0) % n - n / 2.0
        val dy = nextY - y
        val samples = ceil(hypot(dx, dy) / ROUTE_SAMPLE_TILES).toInt()
        for (sample in 1..samples) visit(x + dx * sample / samples, y + dy * sample / samples)
        x += dx
        y = nextY
    }
    return tiles.toList()
}

/**
 * Tiles at [zoom] whose square comes within [radius] tiles of a centre, ordered by [rank] of their
 * unwrapped column and row. Columns wrap across the antimeridian; rows stop at the poles.
 */
private fun tilesWithin(
    centreX: Double,
    centreY: Double,
    radius: Double,
    zoom: Int,
    rank: (column: Int, row: Int) -> Double,
): List<WatchMapTile> {
    val n = 1 shl zoom
    val found = mutableListOf<Pair<WatchMapTile, Double>>()
    for (row in max(0, floor(centreY - radius).toInt())..minOf(n - 1, floor(centreY + radius).toInt())) {
        for (column in floor(centreX - radius).toInt()..floor(centreX + radius).toInt()) {
            val nearestX = centreX.coerceIn(column.toDouble(), column + 1.0)
            val nearestY = centreY.coerceIn(row.toDouble(), row + 1.0)
            if (hypot(nearestX - centreX, nearestY - centreY) > radius) continue
            found += WatchMapTile(zoom, Math.floorMod(column, n), row) to rank(column, row)
        }
    }
    return found.sortedWith(compareBy({ it.second }, { it.first.key })).map { it.first }.distinct()
}

/**
 * The wanted list after a plan step: [needed] first in its own order, then the [route] tiles it does
 * not already hold, then tiles held from earlier steps at the same zoom levels, most recently needed
 * first and ahead of the rider before behind, then tiles of [previousZoom], the level the last zoom
 * change left, in the same order. All cut at [cap]. Keeping the previous level lets the wrist draw it
 * until the new one arrives; it leaves with the next zoom change or the cap. Route tiles from an
 * earlier step that [route] no longer lists leave at once.
 *
 * [needed] is the seam for more tile sources: pass them in priority order.
 */
internal fun retainWatchMapTiles(
    needed: List<WatchMapTile>,
    held: List<WatchMapTileNeed>,
    rider: WatchMapRider,
    step: Long,
    cap: Int = WATCH_MAP_TILE_CAP,
    previousZoom: Int? = null,
    route: List<WatchMapTile> = emptyList(),
): List<WatchMapTileNeed> {
    val neededSet = needed.toSet()
    val routeOnly = route.filter { it !in neededSet }.distinct()
    val routeSet = routeOnly.toSet()
    val zooms = neededSet.mapTo(HashSet()) { it.z }
    val order = compareBy<WatchMapTileNeed> { if (it.tile.z in zooms) 0 else 1 }
        .thenByDescending { it.neededAt }
        .thenBy { isBehind(it.tile, rider) }
        .thenBy { riderDistance(it.tile, rider) }
    val older = held
        .filter { !it.route && (it.tile.z in zooms || it.tile.z == previousZoom) && it.tile !in neededSet && it.tile !in routeSet }
        .sortedWith(order)
    val fresh = needed.distinct().map { WatchMapTileNeed(it, step) } + routeOnly.map { WatchMapTileNeed(it, step, route = true) }
    return (fresh + older).take(cap)
}

/**
 * Tiles one plan step needs at [zoom]: the face around the rider first, then the ring ahead, so speed
 * never pushes the current view out of the plan. Each as the ring one zoom out first, about four
 * tiles that cover the face on their own once scaled up, then the ring at [zoom] itself.
 */
internal fun watchMapTileNeeded(rider: WatchMapRider, zoom: Int): List<WatchMapTile> {
    fun levels(lookahead: Boolean) =
        (if (zoom > 0) watchMapTileRing(rider, zoom - 1, lookahead) else emptyList()) + watchMapTileRing(rider, zoom, lookahead)
    return (levels(lookahead = false) + levels(lookahead = true)).distinct()
}

/**
 * The stateful half: re-plans only when the rider enters a new tile, the zoom changes, the course
 * turns by more than [WATCH_MAP_REPLAN_TURN_DEG], or the route or the tile of their progress along it
 * changes. Everything it decides is in the pure functions above.
 */
internal class WatchMapTilePlanner(private val cap: Int = WATCH_MAP_TILE_CAP) {
    private var zoom: Int? = null
    private var previousZoom: Int? = null
    private var riderTile: WatchMapTile? = null
    private var plannedCourseDeg: Double? = null
    /** The route last planned and the tile its progress point was on; identity compares the route. */
    private var plannedRoute: Pair<WatchMapRoute, WatchMapTile>? = null
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
        val route = rider.route?.let { progress ->
            progress.route.pointBefore(progress.remainingM)?.let { (_, point) ->
                val (px, py) = tileCoordinates(point, 1 shl nextZoom)
                progress.route to WatchMapTile(nextZoom, floor(px).toInt(), floor(py).toInt())
            }
        }
        val routeMoved = route?.first !== plannedRoute?.first || route?.second != plannedRoute?.second
        if (nextZoom == zoom && tile == riderTile && !turned && !routeMoved) return false
        if (zoom != null && nextZoom != zoom) previousZoom = zoom
        zoom = nextZoom
        riderTile = tile
        plannedRoute = route
        if (course != null) plannedCourseDeg = course
        step++
        wanted = retainWatchMapTiles(
            watchMapTileNeeded(rider, nextZoom), wanted, rider, step, cap, previousZoom,
            route = watchMapRouteTiles(rider, nextZoom, cap),
        )
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
