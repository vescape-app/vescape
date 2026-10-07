package expo.modules.vescapecore.watch

import kotlin.math.PI
import kotlin.math.atan
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

/**
 * Prefix of every street-map tile item: `/map-tile/<style>/<z>/<x>/<y>`, the JPEG as an Asset
 * under [WATCH_MAP_TILE_ASSET]. The set of these items is the set of tiles the wrist holds.
 */
const val WATCH_MAP_TILE_PATH = "/map-tile"
const val WATCH_MAP_TILE_ASSET = "tile"
