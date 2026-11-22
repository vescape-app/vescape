package expo.modules.vescapecore.watch

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log2
import kotlin.math.sinh

/**
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `clampedSpanM`
 */
/**
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapGauges`
 */
object WatchMapGauges {
    val STEPS = listOf(0, 30, 45, 60, 75, 90)
    const val DEFAULT_PERCENT = 60

    fun percent(value: Any?): Int? {
        val number = value as? Number ?: return null
        return number.toInt().takeIf { it in STEPS && it.toDouble() == number.toDouble() }
    }
}

object WatchMapSpan {
    /**
     * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
     * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
     */
    const val DEFAULT_M = 600.0
    private const val MIN_M = 150f
    private const val MAX_M = 2_000f

    fun clamp(spanM: Double?): Float = (spanM ?: DEFAULT_M).toFloat().coerceIn(MIN_M, MAX_M)
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapTile`
 */
data class WatchMapTile(val z: Int, val x: Int, val y: Int) {
    val key: String get() = "$z/$x/$y"

    fun path(style: String): String = "$WATCH_MAP_TILE_PATH/$style/$key"

    val northWest: WatchMapPosition get() = corner(x, y)

    val southEast: WatchMapPosition get() = corner(x + 1, y + 1)

    val parent: WatchMapTile? get() = if (z == 0) null else WatchMapTile(z - 1, x shr 1, y shr 1)

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
        fun parse(key: String): WatchMapTile? {
            val parts = key.split('/')
            if (parts.size != 3) return null
            val z = parts[0].toIntOrNull() ?: return null
            val x = parts[1].toIntOrNull() ?: return null
            val y = parts[2].toIntOrNull() ?: return null
            if (z !in 0..30 || x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
            return WatchMapTile(z, x, y)
        }

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

internal const val WATCH_MAP_REFERENCE_WIDTH_PX = 480.0

internal const val WATCH_MAP_MAX_UPSCALE = 1.3

internal const val WATCH_MAP_ZOOM_HYSTERESIS = 1.15

internal const val WATCH_MAP_ZOOM0_METRES_PER_PIXEL = 78_271.517
internal const val WATCH_MAP_MAX_MERCATOR_LATITUDE = 85.051_128

/**
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
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `watchMapDecodedTiles`
 */
internal const val WATCH_MAP_DECODED_TILES = 12

internal class WatchMapTileFrame(val draw: List<WatchMapTile>, val missing: List<WatchMapTile>)

/**
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapTileCache`
 */
internal class WatchMapTileCache<Image : Any> {
    private val decoded = LinkedHashMap<WatchMapTile, Image>(WATCH_MAP_DECODED_TILES, 0.75f, true)
    private var pinned: Set<WatchMapTile> = emptySet()

    operator fun get(tile: WatchMapTile): Image? = decoded[tile]

    fun put(tile: WatchMapTile, image: Image) {
        decoded[tile] = image
        val iterator = decoded.keys.iterator()
        while (decoded.size > WATCH_MAP_DECODED_TILES && iterator.hasNext()) {
            if (iterator.next() !in pinned) iterator.remove()
        }
    }

    fun remove(tile: WatchMapTile) {
        decoded.remove(tile)
    }

    fun retain(tiles: Set<WatchMapTile>) {
        decoded.keys.retainAll(tiles)
    }

    fun frame(cells: List<WatchMapTile>, held: Set<WatchMapTile>): WatchMapTileFrame {
        val draw = LinkedHashSet<WatchMapTile>()
        val wanted = LinkedHashSet<WatchMapTile>()
        for (cell in cells) {
            val parent = cell.parent
            when {
                cell in held -> wanted += cell
                parent != null && parent in held -> wanted += parent
                else -> wanted += cell.children.filter { it in held }
            }
            when {
                cell in decoded -> draw += cell
                parent != null && parent in decoded -> draw += parent
                else -> draw += cell.children.filter { it in decoded }
            }
        }
        pinned = draw + wanted
        return WatchMapTileFrame(draw.sortedBy { it.z }, wanted.filter { it !in decoded })
    }
}

const val WATCH_MAP_TILE_PATH = "/map-tile"
const val WATCH_MAP_TILE_ASSET = "tile"
