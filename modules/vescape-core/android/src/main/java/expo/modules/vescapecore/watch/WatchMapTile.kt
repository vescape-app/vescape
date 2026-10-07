package expo.modules.vescapecore.watch

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log2
import kotlin.math.sinh

/**
 * Metres of world across the watch face for a phone map span: the phone's own, clamped to what a
 * wrist can draw, or the fallback until the phone has published one. Every heading-up wrist layer
 * takes its zoom from here, and the phone sizes street-map tiles from the same number.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `clampedSpanM`
 */
object WatchMapSpan {
    /**
     * Fallback until the phone publishes its camera span.
     *
     * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
     * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
     */
    const val DEFAULT_M = 600.0
    private const val MIN_M = 150f
    private const val MAX_M = 2_000f

    fun clamp(spanM: Double?): Float = (spanM ?: DEFAULT_M).toFloat().coerceIn(MIN_M, MAX_M)
}

/**
 * One 512 px raster tile of the hosted dark street-map style (`MapTiles.STYLE`), in Web Mercator
 * tile coordinates. Shared by the phone, which plans and sends tiles, and the Wear wrist, which
 * places them under the trail.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapTile`
 */
data class WatchMapTile(val z: Int, val x: Int, val y: Int) {
    /** `z/x/y`: the tile's name in paths and lists. */
    val key: String get() = "$z/$x/$y"

    /** Data Layer path of this tile's item, one item per tile. */
    fun path(style: String): String = "$WATCH_MAP_TILE_PATH/$style/$key"

    /** The tile's top-left corner. */
    val northWest: WatchMapPosition get() = corner(x, y)

    /** The tile's bottom-right corner. Its longitude is 180 for the last column, never -180. */
    val southEast: WatchMapPosition get() = corner(x + 1, y + 1)

    /** The tile one zoom out that this one is a quarter of; null at zoom 0. */
    val parent: WatchMapTile? get() = if (z == 0) null else WatchMapTile(z - 1, x shr 1, y shr 1)

    /** The four tiles one zoom in that make up this one. */
    val children: List<WatchMapTile>
        get() = listOf(0 to 0, 1 to 0, 0 to 1, 1 to 1).map { (dx, dy) -> WatchMapTile(z + 1, 2 * x + dx, 2 * y + dy) }

    private fun corner(tx: Int, ty: Int): WatchMapPosition {
        val n = (1 shl z).toDouble()
        return WatchMapPosition(
            latitude = Math.toDegrees(atan(sinh(PI * (1 - 2 * ty / n)))),
            longitude = tx / n * 360.0 - 180.0,
        )
    }

    companion object {
        /** A tile key, or null for anything that is not a valid `z/x/y`. */
        fun parse(key: String): WatchMapTile? {
            val parts = key.split('/')
            if (parts.size != 3) return null
            val z = parts[0].toIntOrNull() ?: return null
            val x = parts[1].toIntOrNull() ?: return null
            val y = parts[2].toIntOrNull() ?: return null
            if (z !in 0..30 || x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
            return WatchMapTile(z, x, y)
        }

        /** The style and tile named by a [path], or null for any other Data Layer path. */
        fun fromPath(path: String): Pair<String, WatchMapTile>? {
            if (!path.startsWith("$WATCH_MAP_TILE_PATH/")) return null
            val rest = path.removePrefix("$WATCH_MAP_TILE_PATH/")
            val split = rest.split('/')
            if (split.size < 4) return null
            val tile = parse(split.takeLast(3).joinToString("/")) ?: return null
            return split.dropLast(3).joinToString("/") to tile
        }
    }
}

/** Watch width the zoom is chosen for. Close to the largest Wear and Apple Watch panels. */
internal const val WATCH_MAP_REFERENCE_WIDTH_PX = 480.0

/** A tile may be drawn at most this much larger than its pixels before the next level is used. */
internal const val WATCH_MAP_MAX_UPSCALE = 1.3

/** A held level survives until the span moves this factor past its boundary, either way. */
internal const val WATCH_MAP_ZOOM_HYSTERESIS = 1.15

/** Metres per pixel of a 512 px tile at zoom 0 on the equator. */
internal const val WATCH_MAP_ZOOM0_METRES_PER_PIXEL = 78_271.517
internal const val WATCH_MAP_MAX_MERCATOR_LATITUDE = 85.051_128

/**
 * The lowest zoom whose tile is drawn at most [WATCH_MAP_MAX_UPSCALE] times its size on a
 * [WATCH_MAP_REFERENCE_WIDTH_PX] face showing [spanM] (clamped exactly as the wrist clamps it).
 * [current] is kept while it stays inside the hysteresis band, so a span near a boundary does not
 * flip levels. The phone plans tiles at this level and the wrist draws at it; the span clamp keeps it
 * well under the style's maximum zoom.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `zoom`
 */
internal fun watchMapTileZoom(spanM: Double?, latitude: Double, current: Int?): Int {
    val metresPerPixel = WatchMapSpan.clamp(spanM) / WATCH_MAP_REFERENCE_WIDTH_PX
    val groundPerPixel = WATCH_MAP_ZOOM0_METRES_PER_PIXEL *
        cos(Math.toRadians(latitude.coerceIn(-WATCH_MAP_MAX_MERCATOR_LATITUDE, WATCH_MAP_MAX_MERCATOR_LATITUDE)))
    fun lowest(upscale: Double) = ceil(log2(groundPerPixel / (upscale * metresPerPixel))).toInt().coerceAtLeast(0)
    if (current != null && current in lowest(WATCH_MAP_MAX_UPSCALE * WATCH_MAP_ZOOM_HYSTERESIS)..lowest(WATCH_MAP_MAX_UPSCALE / WATCH_MAP_ZOOM_HYSTERESIS)) {
        return current
    }
    return lowest(WATCH_MAP_MAX_UPSCALE)
}

/**
 * The cells the wrist can fill at [zoom]: every tile at that level that a held tile at [zoom], one
 * zoom out or one zoom in covers. Cells nothing covers stay background, so they are never listed.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `cells`
 */
internal fun watchMapTileCells(held: Collection<WatchMapTile>, zoom: Int): Set<WatchMapTile> {
    val cells = HashSet<WatchMapTile>()
    for (tile in held) {
        when (tile.z) {
            zoom -> cells += tile
            zoom - 1 -> cells += tile.children
            zoom + 1 -> tile.parent?.let { cells += it }
        }
    }
    return cells
}

/**
 * What the wrist draws over [cells] (tiles at its zoom across the face, nearest first), bottom-up.
 * Per cell: its own tile when [ready]; else the one-zoom-out tile, whose matching quarter shows
 * through, scaled up; else the ready tiles one zoom in, the level a zoom-out just left; else nothing,
 * so the background shows. One-out tiles come first so a neighbour's own tile covers the rest of them.
 * [ready] is asked in that order, so it may start decoding what it is asked about.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `drawList`
 */
internal fun watchMapTileDrawList(cells: List<WatchMapTile>, ready: (WatchMapTile) -> Boolean): List<WatchMapTile> {
    val drawn = LinkedHashSet<WatchMapTile>()
    for (cell in cells) {
        when {
            ready(cell) -> drawn += cell
            cell.parent?.let(ready) == true -> drawn += cell.parent!!
            else -> drawn += cell.children.filter(ready)
        }
    }
    return drawn.sortedBy { it.z }
}

/**
 * Prefix of every street-map tile item: `/map-tile/<style>/<z>/<x>/<y>`, the JPEG as an Asset
 * under [WATCH_MAP_TILE_ASSET]. The set of these items is the set of tiles the wrist holds.
 */
const val WATCH_MAP_TILE_PATH = "/map-tile"
const val WATCH_MAP_TILE_ASSET = "tile"
