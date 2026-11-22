package expo.modules.vescapecore.appstatus

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.vescapecore.auth.DeviceCredentialStore
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import androidx.annotation.WorkerThread
import androidx.annotation.AnyThread
import androidx.annotation.MainThread

private const val TAG = "AppStatusCoordinator"

fun interface AppStatusTransport {
  fun fetch(url: String, appVersion: String, deviceToken: String?, onResult: (String?) -> Unit)
}

/**
 * @platform-diff Android-only: Group Ride networking is the sole Online Capability consumer and has
 * no iOS peer, so the iOS [AppStatusCoordinator] keeps a single `onChange` sink with none of this.
 */
/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `OnlineCapability`
 */
interface OnlineCapability {
  val onlineBlocked: Boolean

  val appVersion: String

  fun refresh()

  fun addListener(listener: () -> Unit): () -> Unit
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift
 */
@MainThread
class AppStatusCoordinator internal constructor(
  private val installedVersion: String,
  private val baseUrl: String,
  private val transport: AppStatusTransport,
  private val credentialStore: DeviceCredentialStore? = null,
  private val deviceTokenProvider: () -> String? = {
    try { credentialStore?.read()?.token }
    catch (error: Exception) {
      UnexpectedNativeError.report("device_credential_read", "secure_store_read", error)
      null
    }
  },
) : OnlineCapability {
  @get:AnyThread
  @Volatile
  var current: AppStatus? = null
    private set

  private val listeners = CopyOnWriteArrayList<(AppStatus?) -> Unit>()

  override val onlineBlocked: Boolean
    get() = current?.version?.status?.blocksOnline ?: false

  override val appVersion: String get() = installedVersion

  fun addChangeListener(listener: (AppStatus?) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  override fun addListener(listener: () -> Unit): () -> Unit = addChangeListener { listener() }

  private var refreshing = false

  override fun refresh() {
    if (refreshing || installedVersion.isEmpty()) return
    refreshing = true
    transport.fetch(
      "$baseUrl$APP_STATUS_PATH",
      installedVersion,
      deviceTokenProvider(),
      ::onFetched,
    )
  }

  private fun onFetched(body: String?) {
    refreshing = false
    val status = body?.let(::parseAppStatus)
    if (status == null) {
      return
    }
    current = status
    body?.let(::applyDeviceTokenState)
    listeners.forEach { it(status) }
  }

  private fun applyDeviceTokenState(body: String) {
    val store = credentialStore ?: return
    // intentional-suppression: owning store exposes the failure to the active UI
    val token = runCatching { org.json.JSONObject(body).optJSONObject("deviceToken") }.getOrNull()
      ?: return
    when (token.optString("state")) {
      "valid" -> token.optString("expiresAt").takeIf { it.isNotEmpty() }?.let {
        try { store.updateExpiry(it) }
        catch (error: Exception) { UnexpectedNativeError.report("device_credential_expiry_write", "secure_store_write", error) }
      }
      "expired", "revoked" -> try { store.reject() }
      catch (error: Exception) { UnexpectedNativeError.report("device_credential_reject", "secure_store_delete", error) }
    }
  }

  companion object {
    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `appStatusPath`
     */
    const val APP_STATUS_PATH = "/api/app-status"

    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `appVersionHeader`
     * @parity /src/modules/profile/lib/deviceAuth.ts `APP_VERSION_HEADER`
     */
    const val APP_VERSION_HEADER = "Vescape-App-Version"

    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `productionServerBaseUrl`
     * @parity /src/config/server.ts `SERVER_URL`
     */
    const val PRODUCTION_SERVER_BASE_URL = "https://api.vescape.app"

    /**
     * @parity /plugins/withServerOrigin.ts `ANDROID_METADATA_NAME`
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `serverBaseUrlInfoKey`
     */
    const val SERVER_BASE_URL_METADATA = "app.vescape.SERVER_BASE_URL"

    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `iosDownloadUrl`
     */
    fun androidDownloadUrl(): String = "$PRODUCTION_SERVER_BASE_URL/download/android"

    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `serverBaseUrl`
     */
    fun serverBaseUrl(context: Context): String {
      val app = context.applicationContext
      return try {
        val metaData = app.packageManager
          .getApplicationInfo(app.packageName, PackageManager.GET_META_DATA)
          .metaData
        val baked = metaData?.getString(SERVER_BASE_URL_METADATA)?.trimEnd('/')
        if (baked.isNullOrEmpty()) PRODUCTION_SERVER_BASE_URL else baked
      } catch (e: Exception) {
        Log.w(TAG, "Cannot read baked server origin: ${e.message}")
        PRODUCTION_SERVER_BASE_URL
      }
    }

    @Volatile
    private var instance: AppStatusCoordinator? = null

    @AnyThread

    fun get(context: Context): AppStatusCoordinator =
      instance ?: synchronized(this) {
        instance ?: AppStatusCoordinator(
          installedVersion = installedMarketingVersion(context),
          baseUrl = serverBaseUrl(context),
          transport = OkHttpAppStatusTransport(Handler(Looper.getMainLooper())),
          credentialStore = DeviceCredentialStore(context),
        ).also { instance = it }
      }

    /**
     * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `installedMarketingVersion`
     */
    private fun installedMarketingVersion(context: Context): String {
      val app = context.applicationContext
      return try {
        app.packageManager.getPackageInfo(app.packageName, 0).versionName.orEmpty()
      } catch (e: Exception) {
        Log.w(TAG, "Cannot read installed marketing version: ${e.message}")
        ""
      }
    }
  }
}

internal class OkHttpAppStatusTransport(private val handler: Handler) : AppStatusTransport {
  private val client = OkHttpClient.Builder()
    .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    .build()

  override fun fetch(
    url: String,
    appVersion: String,
    deviceToken: String?,
    onResult: (String?) -> Unit,
  ) {
    val request = try {
      Request.Builder()
        .url(url)
        .header(AppStatusCoordinator.APP_VERSION_HEADER, appVersion)
        .apply {
          if (deviceToken != null) header("Authorization", "Bearer $deviceToken")
        }
        .build()
    } catch (_: IllegalArgumentException) {
      handler.post { onResult(null) }
      return
    }
    client.newCall(request).enqueue(object : Callback {
      @WorkerThread
      override fun onFailure(call: Call, e: IOException) {
        handler.post { onResult(null) }
      }

      @WorkerThread
      override fun onResponse(call: Call, response: Response) {
        val body = response.use { if (it.isSuccessful) it.body?.string() else null }
        handler.post { onResult(body) }
      }
    })
  }

  private companion object {
    const val CALL_TIMEOUT_SECONDS = 10L
  }
}
