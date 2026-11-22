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
import androidx.annotation.MainThread

private const val DECODE_RETRY_MS = 10_000L

/**
 * @parity /watch/watchos/MapTileLayer.swift `MapTileStore`
 */
@MainThread
internal object MapTileState {
    val held = mutableStateOf<Map<WatchMapTile, () -> ByteArray?>>(emptyMap())
    val decodedVersion = mutableIntStateOf(0)
    private val decoded = WatchMapTileCache<ImageBitmap>()
    private val decoding = HashSet<WatchMapTile>()
    private val failedAtMs = HashMap<WatchMapTile, Long>()
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

    fun replace(tiles: Map<WatchMapTile, () -> ByteArray?>) {
        held.value = tiles
        decoded.retain(tiles.keys)
        failedAtMs.clear()
    }

    private fun forget(tile: WatchMapTile) {
        decoded.remove(tile)
        failedAtMs.remove(tile)
    }

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
    val distanceM: Double = hypot(0.0.coerceIn(westM, eastM), 0.0.coerceIn(southM, northM))
}

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
