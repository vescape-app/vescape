package app.vescape.wear

import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import androidx.annotation.WorkerThread

/**
 * @parity /src/modules/weather/store/rainViewerRadarStore.ts
 * @parity /modules/vescape-core/ios/watch/WatchRadar.swift
 */
private const val RAINVIEWER_META_URL = "https://api.rainviewer.com/public/weather-maps.json"

private const val RADAR_IMAGE_PX = 256

private const val RADAR_ZOOM = expo.modules.vescapecore.watch.WATCH_RADAR_TILE_ZOOM

private const val RADAR_COLOR_SCHEME = 2
private const val RADAR_OPTIONS = "1_1"

const val RADAR_REFRESH_MS = 5 * 60 * 1_000L

private const val RADAR_TIMEOUT_MS = 10_000

fun radarFaceRangeM(latitude: Double): Double =
    EQUATOR_M_PER_PX / (1 shl RADAR_ZOOM) * Math.cos(Math.toRadians(latitude)) * (RADAR_IMAGE_PX / 2)

private const val EQUATOR_M_PER_PX = 156_543.03392

data class RadarFrame(val timeSec: Long, val path: String)

// @parity /watch/watchos/RadarLoader.swift `RadarStore`
object RadarState {
    var host by mutableStateOf<String?>(null)
        private set
    var frames by mutableStateOf<List<RadarFrame>>(emptyList())
        private set
    var loading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set

    val images = SnapshotStateMap<Long, ImageBitmap>()

    private var fetchedAtMs = 0L

    var imageCentre by mutableStateOf<Pair<Double, Double>?>(null)
        private set

    fun stale(nowMs: Long, latitude: Double, longitude: Double): Boolean =
        imageCentre != roundedCentre(latitude, longitude) || nowMs - fetchedAtMs > RADAR_REFRESH_MS

    suspend fun load(latitude: Double, longitude: Double) {
        if (loading) return
        loading = true
        failed = false
        try {
            val meta = withContext(Dispatchers.IO) { fetchText(RAINVIEWER_META_URL) }
                ?.let(RainViewer::parseMeta)
            if (meta == null || meta.frames.isEmpty()) {
                failed = true
                WatchDiagnostics.recordRadarFailure()
                return
            }
            host = meta.host
            if (meta.frames != frames) {
                frames = meta.frames
                images.keys.retainAll(meta.frames.map { it.timeSec }.toSet())
            }
            val centre = roundedCentre(latitude, longitude)
            if (centre != imageCentre) images.clear()
            imageCentre = centre
            fetchedAtMs = System.currentTimeMillis()
            for (frame in meta.frames) {
                if (images.containsKey(frame.timeSec)) continue
                val url = RainViewer.frameUrl(meta.host, frame, centre.first, centre.second)
                val image = withContext(Dispatchers.IO) { fetchImage(url) } ?: continue
                images[frame.timeSec] = image
            }
        } finally {
            loading = false
        }
    }

    private fun roundedCentre(latitude: Double, longitude: Double): Pair<Double, Double> =
        Math.round(latitude * 1_000) / 1_000.0 to Math.round(longitude * 1_000) / 1_000.0
}

data class RadarMeta(val host: String, val frames: List<RadarFrame>)

object RainViewer {
    fun parseMeta(json: String): RadarMeta? = try {
        val root = JSONObject(json)
        val host = root.getString("host")
        val past = root.getJSONObject("radar").getJSONArray("past")
        RadarMeta(
            host = host,
            frames = (0 until past.length()).map { index ->
                val frame = past.getJSONObject(index)
                RadarFrame(timeSec = frame.getLong("time"), path = frame.getString("path"))
            },
        )
    } catch (e: Exception) {
        null
    }

    fun frameUrl(host: String, frame: RadarFrame, latitude: Double, longitude: Double): String =
        "$host${frame.path}/$RADAR_IMAGE_PX/$RADAR_ZOOM/$latitude/$longitude/" +
            "$RADAR_COLOR_SCHEME/$RADAR_OPTIONS.png"
}

@WorkerThread
private fun fetchText(url: String): String? = openConnection(url) { it.bufferedReader().readText() }

@WorkerThread
private fun fetchImage(url: String): ImageBitmap? =
    openConnection(url) { BitmapFactory.decodeStream(it)?.asImageBitmap() }

private fun <T> openConnection(url: String, read: (java.io.InputStream) -> T): T? = try {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = RADAR_TIMEOUT_MS
    connection.readTimeout = RADAR_TIMEOUT_MS
    try {
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            null
        } else {
            connection.inputStream.use(read)
        }
    } finally {
        connection.disconnect()
    }
} catch (e: Exception) {
    null
}

@Composable
fun LoadRadar(visible: Boolean, latitude: Double?, longitude: Double?) {
    LaunchedEffect(visible, latitude, longitude) {
        if (!visible || latitude == null || longitude == null) return@LaunchedEffect
        if (!RadarState.stale(System.currentTimeMillis(), latitude, longitude)) return@LaunchedEffect
        RadarState.load(latitude, longitude)
    }
}
