package expo.modules.vescapecore.serviceconfig

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.appstatus.AppStatusTransport
import expo.modules.vescapecore.appstatus.OkHttpAppStatusTransport
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

private const val TAG = "ServiceConfig"

/**
 * Third-party service tokens the server hands out (`GET /api/service-config`). A `null` token means
 * that service is not configured, and the feature that needs it stays off.
 *
 * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `ServiceConfig`
 * @parity /modules/vescape-core/src/index.ts `ServiceConfig`
 */
data class ServiceConfig(val mapboxToken: String?, val mapyToken: String?) {
  fun toMap(): Map<String, Any?> = mapOf("mapboxToken" to mapboxToken, "mapyToken" to mapyToken)

  companion object {
    /** `{ "tokens": { "mapbox"?, "mapy"? } }`; `null` when the body is not that shape. */
    fun parse(body: String): ServiceConfig? = try {
      val tokens = JSONObject(body).optJSONObject("tokens")
      tokens?.let { ServiceConfig(it.token("mapbox"), it.token("mapy")) }
    } catch (_: Exception) {
      null
    }

    private fun JSONObject.token(key: String): String? =
      (opt(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }
  }
}

/** Where the last successful service-config body lives across launches. */
interface ServiceConfigPersistence {
  fun read(): String?
  fun write(body: String)
}

private class SharedPreferencesServiceConfigPersistence(context: Context) : ServiceConfigPersistence {
  private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  override fun read(): String? = preferences.getString(BODY_KEY, null)

  override fun write(body: String) {
    preferences.edit().putString(BODY_KEY, body).apply()
  }

  private companion object {
    const val PREFERENCES = "vescape_service_config"
    const val BODY_KEY = "body"
  }
}

/**
 * Process-owned Service Config truth. Resolution order:
 * 1. the last successful server answer, persisted so a cold start offline keeps working;
 * 2. the build-time seed baked by `plugins/withServiceTokens.ts`, until the server has answered once.
 *
 * Refreshed on launch and every foreground beside App Status. A failed refresh keeps what is known;
 * a successful one replaces it whole, so a token the server stops returning is dropped.
 *
 * Main-thread affine, like [AppStatusCoordinator]: the transport posts results back there.
 *
 * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `ServiceConfigCoordinator`
 */
class ServiceConfigCoordinator internal constructor(
  private val installedVersion: String,
  private val baseUrl: String,
  private val transport: AppStatusTransport,
  private val persistence: ServiceConfigPersistence,
  seed: ServiceConfig,
) {
  @Volatile
  var current: ServiceConfig = persistence.read()?.let(ServiceConfig::parse) ?: seed
    private set

  private val listeners = CopyOnWriteArrayList<(ServiceConfig) -> Unit>()
  private var refreshing = false

  /** Observe changes; returns a remover. Invoked on the main thread. */
  fun addChangeListener(listener: (ServiceConfig) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  /** Fetch now; a refresh asked for while one is in flight is answered by that one. */
  fun refresh() {
    if (refreshing) return
    refreshing = true
    transport.fetch("$baseUrl$SERVICE_CONFIG_PATH", installedVersion, null, ::onFetched)
  }

  private fun onFetched(body: String?) {
    refreshing = false
    val config = body?.let(ServiceConfig::parse) ?: return
    persistence.write(body)
    if (config == current) return
    current = config
    listeners.forEach { it(config) }
  }

  companion object {
    /**
     * Public Service Config route on the Vescape server.
     * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `serviceConfigPath`
     */
    const val SERVICE_CONFIG_PATH = "/api/service-config"

    /**
     * Manifest meta-data holding the build-time seed tokens.
     * @parity /plugins/withServiceTokens.ts `ANDROID_METADATA`
     * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `mapboxSeedInfoKey`
     */
    const val MAPBOX_SEED_METADATA = "app.vescape.MAPBOX_ACCESS_TOKEN"
    const val MAPY_SEED_METADATA = "app.vescape.MAPY_API_KEY"

    @Volatile
    private var instance: ServiceConfigCoordinator? = null

    /** Process singleton — the resolved tokens must outlive JS runtime reloads. */
    fun get(context: Context): ServiceConfigCoordinator =
      instance ?: synchronized(this) {
        instance ?: run {
          val app = context.applicationContext
          ServiceConfigCoordinator(
            installedVersion = AppStatusCoordinator.get(app).appVersion,
            baseUrl = AppStatusCoordinator.serverBaseUrl(app),
            transport = OkHttpAppStatusTransport(Handler(Looper.getMainLooper())),
            persistence = SharedPreferencesServiceConfigPersistence(app),
            seed = seed(app),
          ).also { instance = it }
        }
      }

    private fun seed(context: Context): ServiceConfig = try {
      val metaData = context.packageManager
        .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        .metaData
      fun baked(key: String) = metaData?.getString(key)?.trim()?.takeIf { it.isNotEmpty() }
      ServiceConfig(baked(MAPBOX_SEED_METADATA), baked(MAPY_SEED_METADATA))
    } catch (e: Exception) {
      Log.w(TAG, "Cannot read baked service tokens: ${e.message}")
      ServiceConfig(null, null)
    }
  }
}
