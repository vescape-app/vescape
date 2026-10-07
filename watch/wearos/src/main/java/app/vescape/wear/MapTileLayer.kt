package app.vescape.wear

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalConfiguration
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WATCH_MAP_DECODED_TILES
import expo.modules.vescapecore.watch.WatchMapTile
import expo.modules.vescapecore.watch.WatchMapTileCache
import expo.modules.vescapecore.watch.WatchMapTileFrame
import expo.modules.vescapecore.watch.watchMapTileCells
import expo.modules.vescapecore.watch.watchMapTileZoom
import kotlin.math.hypot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A tile that failed to read or decode waits this long before it is tried again. */
private const val DECODE_RETRY_MS = 10_000L

/**
 * Street-map tiles held on the wrist and a small decoded cache ([WatchMapTileCache]). The phone
 * decides what is held (one Data Layer item per tile); this only mirrors that set and decodes on
 * demand, off the main thread, as RGB_565 — the map is drawn dimmed under the gauges, and half the
 * memory of ARGB matters more than gradient fidelity. Main-thread state.
 *
 * Each held tile carries how to read its JPEG, so a source other than the Data Layer can seed it.
 *
 * @parity /watch/watchos/MapTileLayer.swift `MapTileStore`
 */
internal object MapTileState {
    val held = mutableStateOf<Map<WatchMapTile, () -> ByteArray?>>(emptyMap())
    /** Bumped when a decode lands, so the layer redraws without recomposing. */
    val decodedVersion = mutableIntStateOf(0)
    private val decoded = WatchMapTileCache<ImageBitmap>()
    private val decoding = HashSet<WatchMapTile>()
    private val failedAtMs = HashMap<WatchMapTile, Long>()
    /** The level the face draws at, held with the phone planner's hysteresis. */
    var zoom: Int? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun put(tile: WatchMapTile, load: () -> ByteArray?) {
        held.value += tile to load
        forget(tile)
    }

    fun remove(tile: WatchMapTile) {
        held.value -= tile
        forget(tile)
    }

    /** A complete set on start: what synced while the app was stopped. */
    fun replace(tiles: Map<WatchMapTile, () -> ByteArray?>) {
        held.value = tiles
        decoded.retain(tiles.keys)
        failedAtMs.clear()
    }

    private fun forget(tile: WatchMapTile) {
        decoded.remove(tile)
        failedAtMs.remove(tile)
    }

    /** Lays out a frame and starts decoding what it waits on. Safe to call from a draw scope. */
    fun frame(cells: List<WatchMapTile>): WatchMapTileFrame {
        val frame = decoded.frame(cells, held.value.keys)
        val now = SystemClock.elapsedRealtime()
        for (tile in frame.missing) {
            val failedAt = failedAtMs[tile]
            if (failedAt != null && now - failedAt < DECODE_RETRY_MS) continue
            decode(tile)
        }
        return frame
    }

    fun image(tile: WatchMapTile): ImageBitmap? = decoded[tile]

    private fun decode(tile: WatchMapTile) {
        val load = held.value[tile] ?: return
        if (!decoding.add(tile)) return
        scope.launch {
            val image = withContext(Dispatchers.IO) {
                // intentional-suppression: an unreadable asset draws as background and is retried after DECODE_RETRY_MS
                runCatching {
                    load()?.let { bytes ->
                        val options = BitmapFactory.Options().apply { inPreferredConfig = android.graphics.Bitmap.Config.RGB_565 }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
                    }
                }.getOrNull()
            }
            decoding.remove(tile)
            // A resend replaced the loader mid-decode: these are the old bytes. Redraw to read the new.
            if (held.value[tile] !== load) {
                decodedVersion.intValue++
                return@launch
            }
            if (image == null) {
                failedAtMs[tile] = SystemClock.elapsedRealtime()
                return@launch
            }
            decoded.put(tile, image)
            decodedVersion.intValue++
        }
    }
}

/**
 * The dark street map under the trail and route, at the level [watchMapTileZoom] picks for the eased
 * span. Each cell shows its own tile, else the matching quarter of the one-zoom-out tile, else the
 * one-zoom-in tiles a zoom-out left ([WatchMapTileCache.frame]), so a zoom change never blanks the face.
 * Each tile's corners are placed as local metres from the rider's absolute position, then drawn with
 * the same span, course and position motion as the trail, so the streets stay under the line through
 * a zoom or a turn. Within 2 km the tile is flat enough to draw as one transformed image.
 *
 * @parity /watch/watchos/MapTileLayer.swift `MapTileLayer`
 */
@Composable
internal fun MapTileLayer(mapView: WatchMapView) {
    val isRound = LocalConfiguration.current.isScreenRound
    val held = MapTileState.held.value
    if (held.isEmpty()) return
    Canvas(Modifier.fillMaxSize()) {
        MapTileState.decodedVersion.intValue
        val anchor = mapView.motion.position ?: return@Canvas
        val offset = mapView.positionOffset
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        // Anything further from the rider than the face diagonal is off screen at any course.
        val reachM = hypot(size.width, size.height) / scale
        val zoom = watchMapTileZoom(mapView.spanM.toDouble(), anchor.latitude, MapTileState.zoom)
        MapTileState.zoom = zoom
        val cells = watchMapTileCells(held.keys, zoom)
            .mapNotNull { placeTile(it, anchor, offset.eastM, offset.northM) }
            .filter { it.distanceM <= reachM }
            .sortedBy { it.distanceM }
            .take(WATCH_MAP_DECODED_TILES)
            .map { it.tile }
        val frame = MapTileState.frame(cells)
        clipPath(mapFaceClip(isRound)) {
            rotate(-mapView.courseDeg, center) {
                for (tile in frame.draw) {
                    val image = MapTileState.image(tile) ?: continue
                    val placed = placeTile(tile, anchor, offset.eastM, offset.northM) ?: continue
                    val left = center.x + placed.westM.toFloat() * scale
                    val top = center.y - placed.northM.toFloat() * scale
                    val width = (placed.eastM - placed.westM).toFloat() * scale
                    val height = (placed.northM - placed.southM).toFloat() * scale
                    // Half a pixel of overlap hides the seam filtering leaves between neighbours.
                    translate(left - 0.5f, top - 0.5f) {
                        scale((width + 1f) / image.width, (height + 1f) / image.height, pivot = Offset.Zero) {
                            drawImage(image)
                        }
                    }
                }
            }
        }
    }
}

private class PlacedTile(val tile: WatchMapTile, val westM: Double, val northM: Double, val eastM: Double, val southM: Double) {
    /** Nearest point of the tile to the rider. */
    val distanceM: Double = hypot(0.0.coerceIn(westM, eastM), 0.0.coerceIn(southM, northM))
}

/**
 * Tile edges as metres east/north of the rider, including the camera's pending motion. Null for a
 * tile half a world away, whose edges wrap to opposite sides.
 */
private fun placeTile(tile: WatchMapTile, anchor: WatchMapPosition, offsetEastM: Double, offsetNorthM: Double): PlacedTile? {
    val northWest = tile.northWest.offsetFrom(anchor)
    val southEast = tile.southEast.offsetFrom(anchor)
    if (southEast.eastM <= northWest.eastM) return null
    return PlacedTile(
        tile,
        westM = northWest.eastM + offsetEastM,
        northM = northWest.northM + offsetNorthM,
        eastM = southEast.eastM + offsetEastM,
        southM = southEast.northM + offsetNorthM,
    )
}
