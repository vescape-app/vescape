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

/**
 * Rain radar imagery for the wrist, fetched by the watch itself from RainViewer.
 *
 * The one wrist surface that is not a mirror of phone state (ADR-0019 covers *board* data, which
 * this is not): radar frames are public imagery, too heavy to push over the Data Layer per refresh
 * and worthless when stale, so the watch asks for them directly over whatever network it has. The
 * phone still owns *where* the rider is — the frames are centred on the forecast location it pushed
 * on [WEATHER_PATH], so the watch never touches location services.
 *
 * A watch with no network simply shows nothing here; every other page is unaffected.
 *
 * @parity /src/modules/weather/store/rainViewerRadarStore.ts
 */
private const val RAINVIEWER_META_URL = "https://api.rainviewer.com/public/weather-maps.json"

/**
 * Frames are square PNGs centred on a coordinate rather than slippy-map tiles: one request per
 * frame instead of a grid of them, which is what makes fetching this on a watch reasonable.
 *
 * `{host}{path}/{size}/{zoom}/{lat}/{lon}/{colorScheme}/{smooth}_{snow}.png`
 */
private const val RADAR_IMAGE_PX = 256

/** Roughly a 100 km square around the rider: far enough ahead to see weather coming. */
private const val RADAR_ZOOM = 6

/** Universal Blue, smoothed, snow shown — the same rendering the phone map overlays. */
private const val RADAR_COLOR_SCHEME = 2
private const val RADAR_OPTIONS = "1_1"

/** RainViewer publishes a new frame every ten minutes; half that is a cheap way to never miss one. */
const val RADAR_REFRESH_MS = 5 * 60 * 1_000L

private const val RADAR_TIMEOUT_MS = 10_000

/**
 * Ground metres from the rider to the edge of the radar image, which is what turns a pixel radius
 * into a distance. Web-Mercator: a pixel covers less ground the further from the equator it is, so
 * the same image is a smaller area in Oslo than in Madrid and the range rings have to follow.
 */
fun radarFaceRangeM(latitude: Double): Double =
    EQUATOR_M_PER_PX / (1 shl RADAR_ZOOM) * Math.cos(Math.toRadians(latitude)) * (RADAR_IMAGE_PX / 2)

/** Ground metres per pixel at zoom 0 on the equator, the constant every Web-Mercator scale is off. */
private const val EQUATOR_M_PER_PX = 156_543.03392

/** One radar frame: when it was observed, and the provider path that renders it. */
data class RadarFrame(val timeSec: Long, val path: String)

/**
 * The radar as the wrist has it: the frame list, plus the images that have arrived so far. Frames
 * appear one by one rather than all at once, so the page animates over what it has instead of
 * waiting on the slowest fetch.
 */
object RadarState {
    var host by mutableStateOf<String?>(null)
        private set
    var frames by mutableStateOf<List<RadarFrame>>(emptyList())
        private set
    var loading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set

    /** Decoded frames, keyed by observation time. Cleared whenever the frame list moves on. */
    val images = SnapshotStateMap<Long, ImageBitmap>()

    private var fetchedAtMs = 0L

    /** Where [images] were centred, so a rider who has moved re-fetches instead of showing elsewhere. */
    private var centre: Pair<Double, Double>? = null

    fun stale(nowMs: Long, latitude: Double, longitude: Double): Boolean =
        centre != roundedCentre(latitude, longitude) || nowMs - fetchedAtMs > RADAR_REFRESH_MS

    /**
     * Fetch the frame list, then the images, oldest first. Suspends on IO; safe to cancel at any
     * point — a half-loaded animation is still worth showing, and the next visit resumes it.
     */
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
            centre = roundedCentre(latitude, longitude)
            fetchedAtMs = System.currentTimeMillis()
            for (frame in meta.frames) {
                if (images.containsKey(frame.timeSec)) continue
                val url = RainViewer.frameUrl(meta.host, frame, latitude, longitude)
                val image = withContext(Dispatchers.IO) { fetchImage(url) } ?: continue
                images[frame.timeSec] = image
            }
        } finally {
            loading = false
        }
    }

    /**
     * A frame is centred to about a hundred metres, so only real movement re-fetches: a GPS fix
     * jittering in place would otherwise throw the whole animation away every forecast refresh.
     */
    private fun roundedCentre(latitude: Double, longitude: Double): Pair<Double, Double> =
        Math.round(latitude * 1_000) / 1_000.0 to Math.round(longitude * 1_000) / 1_000.0
}

/** Parsed provider metadata: where the imagery lives and which frames exist right now. */
data class RadarMeta(val host: String, val frames: List<RadarFrame>)

/** Pure URL and payload handling, kept out of the fetch so it can be tested off-device. */
object RainViewer {
    /** Past frames only, matching the phone map: nowcast frames are a forecast, not an observation. */
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

private fun fetchText(url: String): String? = openConnection(url) { it.bufferedReader().readText() }

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
    // Silent on purpose: the caller reports the one failure that matters, on the main thread
    // [WatchDiagnostics] belongs to. A single missing frame just shortens the animation.
    null
}

/**
 * Keeps [RadarState] loaded while the radar page is on screen. Off the page nothing is fetched: the
 * imagery is the most expensive thing the wrist does, and it is only ever looked at here.
 */
@Composable
fun LoadRadar(visible: Boolean, latitude: Double?, longitude: Double?) {
    LaunchedEffect(visible, latitude, longitude) {
        if (!visible || latitude == null || longitude == null) return@LaunchedEffect
        if (!RadarState.stale(System.currentTimeMillis(), latitude, longitude)) return@LaunchedEffect
        RadarState.load(latitude, longitude)
    }
}
