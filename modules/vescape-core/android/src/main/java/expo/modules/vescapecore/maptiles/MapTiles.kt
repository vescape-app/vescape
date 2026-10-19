package expo.modules.vescapecore.maptiles

import android.content.Context
import android.util.Log
import expo.modules.vescapecore.navigation.MapboxDirectionsApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Raster map tiles of the hosted thumbnail style, rendered by the Mapbox Static Tiles API and kept on
 * disk with no expiry: a map behind a ride thumbnail does not need to track every change on the
 * ground, and every cache hit is one API request saved. The OS may still clear the cache directory
 * under storage pressure; tiles then download again on demand.
 *
 * Concurrent requests for one tile share a single download. A failed download stores nothing, so the
 * next request retries.
 *
 * @parity /modules/vescape-core/ios/maptiles/MapTiles.swift
 */
class MapTiles internal constructor(
  private val directory: File,
  private val fetch: suspend (url: String) -> ByteArray?,
  private val accessToken: String,
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val inFlight = ConcurrentHashMap<String, Deferred<File?>>()
  private val downloads = Semaphore(MAX_PARALLEL_DOWNLOADS)

  /** The tile's cached JPEG, downloading it first if needed. Null for an invalid tile or a failed download. */
  suspend fun tile(z: Int, x: Int, y: Int): File? {
    if (z !in 0..MAX_ZOOM || x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
    val file = File(directory, "$STYLE/$z/$x/$y.jpg")
    if (file.exists()) return file
    // Lazy, so the download cannot finish and unregister itself before it is registered.
    val download = inFlight.computeIfAbsent(file.path) {
      scope.async(start = CoroutineStart.LAZY) {
        try {
          download(file, "$BASE_URL/$STYLE/tiles/512/$z/$x/$y.jpeg?access_token=$accessToken")
        } finally {
          inFlight.remove(file.path)
        }
      }
    }
    download.start()
    return download.await()
  }

  private suspend fun download(file: File, url: String): File? = downloads.withPermit {
    if (file.exists()) return@withPermit file
    if (accessToken.isEmpty()) return@withPermit null
    val bytes = fetch(url) ?: return@withPermit null
    file.parentFile?.mkdirs()
    // Write beside the target, then rename: a reader never sees half a tile.
    val partial = File(file.parentFile, "${file.name}.${UUID.randomUUID()}.partial")
    try {
      partial.writeBytes(bytes)
      if (partial.renameTo(file)) file else null
    } catch (e: Exception) {
      Log.w(TAG, "Cannot store map tile: ${e.message}")
      null
    } finally {
      partial.delete()
    }
  }

  companion object {
    private const val TAG = "MapTiles"
    private const val BASE_URL = "https://api.mapbox.com/styles/v1"

    /**
     * `owner/styleId` of the hosted style (`bun run map:publish-thumbnail-style`). Part of the cache
     * path, so a different style never reads another style's tiles.
     * @parity /modules/vescape-core/ios/maptiles/MapTiles.swift `style`
     */
    const val STYLE = "kacperkozak/cmux9d4th002j01s4fm7tc4mt"

    /** @parity /modules/vescape-core/ios/maptiles/MapTiles.swift `maxZoom` */
    const val MAX_ZOOM = 22

    /** @parity /modules/vescape-core/ios/maptiles/MapTiles.swift `maxParallelDownloads` */
    private const val MAX_PARALLEL_DOWNLOADS = 4
    private const val CALL_TIMEOUT_SECONDS = 15L

    @Volatile private var instance: MapTiles? = null

    fun get(context: Context): MapTiles = instance ?: synchronized(this) {
      instance ?: run {
        val app = context.applicationContext
        val client = OkHttpClient.Builder().callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS).build()
        MapTiles(
          directory = File(app.cacheDir, "map-tiles"),
          fetch = { url -> fetchTile(client, url) },
          accessToken = MapboxDirectionsApi.accessToken(app),
        ).also { instance = it }
      }
    }

    private fun fetchTile(client: OkHttpClient, url: String): ByteArray? = try {
      client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
        if (!response.isSuccessful) {
          Log.w(TAG, "Map tile request failed: HTTP ${response.code}")
          null
        } else {
          response.body?.bytes()
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Map tile request failed: ${e.message}")
      null
    }
  }
}
