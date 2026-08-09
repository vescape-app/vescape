package expo.modules.vescapecore.navigation

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * The app's only call to the Mapbox Directions API. It fetches one way-following geometry between
 * two coordinates and returns the decoded points; it holds no state and decides nothing about when
 * a Navigation exists — that is [NavigationController]'s job.
 *
 * This does not go through `VescapeApi`: that boundary owns the Vescape backend's origin, Device
 * Credential and 401 policy, none of which apply to a third-party host authenticated by a baked
 * token.
 *
 * @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift
 */
class MapboxDirectionsApi(private val accessToken: String) : DirectionsRoutes {
  private val client = OkHttpClient.Builder().callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS).build()

  /**
   * Points of the first returned route, or which way this failed. A missing token, a transport
   * error and a non-2xx response are all [DirectionsResult.Failed] — the question never got a real
   * answer. A 2xx carrying no route is [DirectionsResult.NoPath]: Mapbox answered, and the answer is
   * that nothing leads there.
   *
   * Nothing is retried here; retrying is the rider's call.
   */
  override suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): DirectionsResult = withContext(Dispatchers.IO) {
    if (accessToken.isEmpty()) {
      Log.w(TAG, "No Mapbox access token baked in; skipping Directions call")
      return@withContext DirectionsResult.Failed
    }

    // Mapbox takes coordinates as `longitude,latitude` — the opposite order from `setDirectionPoint`.
    val coordinates = "$fromLongitude,$fromLatitude;$toLongitude,$toLatitude"
    val url = "$BASE_URL/$profile/$coordinates" +
      "?geometries=polyline6&overview=full&access_token=${encode(accessToken)}"

    try {
      client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
        val body = response.body?.string()
        if (!response.isSuccessful || body == null) {
          Log.w(TAG, "Directions call failed: HTTP ${response.code}")
          return@withContext DirectionsResult.Failed
        }
        val geometry = JSONObject(body)
          .optJSONArray("routes")
          ?.takeIf { it.length() > 0 }
          ?.getJSONObject(0)
          ?.optString("geometry")
          ?.takeIf { it.isNotEmpty() }
          ?: return@withContext DirectionsResult.NoPath

        Polyline6.decode(geometry)
          .takeIf { it.isNotEmpty() }
          ?.let(DirectionsResult::Path)
          ?: DirectionsResult.NoPath
      }
    } catch (e: Exception) {
      Log.w(TAG, "Directions call failed: ${e.message}")
      DirectionsResult.Failed
    }
  }

  private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

  companion object {
    private const val TAG = "MapboxDirectionsApi"
    private const val BASE_URL = "https://api.mapbox.com/directions/v5/mapbox"
    private const val CALL_TIMEOUT_SECONDS = 15L

    /**
     * Manifest metadata holding the Mapbox access token, injected at prebuild time so native never
     * depends on the JS runtime having started.
     * @parity /plugins/withMapboxToken.ts `ANDROID_METADATA_NAME`
     * @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift `accessTokenInfoKey`
     */
    const val ACCESS_TOKEN_METADATA = "app.vescape.MAPBOX_ACCESS_TOKEN"

    /** Baked Mapbox access token, empty when prebuild ran without one. */
    fun accessToken(context: Context): String = try {
      context.packageManager
        .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        .metaData
        ?.getString(ACCESS_TOKEN_METADATA)
        .orEmpty()
    } catch (e: Exception) {
      Log.w(TAG, "Cannot read baked Mapbox token: ${e.message}")
      ""
    }
  }
}
