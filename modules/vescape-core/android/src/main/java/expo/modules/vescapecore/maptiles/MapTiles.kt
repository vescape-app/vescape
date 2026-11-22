package expo.modules.vescapecore.maptiles

import android.content.Context
import android.util.Log
import expo.modules.vescapecore.serviceconfig.ServiceConfigCoordinator
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
 * @parity /modules/vescape-core/ios/maptiles/MapTiles.swift
 */
class MapTiles internal constructor(
  private val directory: File,
  private val fetch: suspend (url: String) -> ByteArray?,
  private val accessToken: () -> String?,
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val inFlight = ConcurrentHashMap<String, Deferred<File?>>()
  private val downloads = Semaphore(MAX_PARALLEL_DOWNLOADS)

  suspend fun tile(z: Int, x: Int, y: Int): File? {
    if (z !in 0..MAX_ZOOM || x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
    val file = File(directory, "$STYLE/$z/$x/$y.jpg")
    if (file.exists()) return file
    val download = inFlight.computeIfAbsent(file.path) {
      scope.async(start = CoroutineStart.LAZY) {
        try {
          download(file, z, x, y)
        } finally {
          inFlight.remove(file.path)
        }
      }
    }
    download.start()
    return download.await()
  }

  private suspend fun download(file: File, z: Int, x: Int, y: Int): File? = downloads.withPermit {
    if (file.exists()) return@withPermit file
    val token = accessToken() ?: return@withPermit null
    val bytes = fetch("$BASE_URL/$STYLE/tiles/512/$z/$x/$y.jpeg?access_token=$token") ?: return@withPermit null
    file.parentFile?.mkdirs()
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
          accessToken = { ServiceConfigCoordinator.get(app).current.mapboxToken },
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
