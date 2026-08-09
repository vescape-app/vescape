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
   * Points of the first returned route as `(latitude, longitude)`, or `null` when the token is
   * missing, the call fails, or Mapbox returns no route. A `null` simply yields no Navigation:
   * failure UI is a later slice, and this slice never retries.
   */
  override suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): List<Pair<Double, Double>>? = withContext(Dispatchers.IO) {
    if (accessToken.isEmpty()) {
      Log.w(TAG, "No Mapbox access token baked in; skipping Directions call")
      return@withContext null
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
          return@withContext null
        }
        val geometry = JSONObject(body)
          .optJSONArray("routes")
          ?.takeIf { it.length() > 0 }
          ?.getJSONObject(0)
          ?.optString("geometry")
          ?.takeIf { it.isNotEmpty() }
          ?: return@withContext null

        Polyline6.decode(geometry).takeIf { it.isNotEmpty() }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Directions call failed: ${e.message}")
      null
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
