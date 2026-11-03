package expo.modules.vescapecore.navigation

import android.util.Log
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import org.json.JSONObject
import java.util.Locale

/**
 * The app's only Directions call. It fetches one way-following geometry between two coordinates
 * through the server's Mapbox Directions proxy (`GET /api/maps/directions/:profile/:coordinates`,
 * body verbatim from Mapbox) and returns the decoded points; it holds no state and decides nothing
 * about when a Navigation exists — that is [NavigationController]'s job.
 *
 * The proxy needs a Device Token, so a signed-out rider gets [DirectionsResult.Failed].
 *
 * @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift
 */
class MapboxDirectionsApi(private val api: VescapeApi) : DirectionsRoutes {
  /**
   * Points of the first returned route, or which way this failed. No credential, a transport error,
   * a rate limit, an unconfigured or unreachable upstream and any other non-2xx are all
   * [DirectionsResult.Failed] — the question never got a real answer. A 2xx carrying no route is
   * [DirectionsResult.NoPath]: Mapbox answered, and the answer is that nothing leads there.
   *
   * Nothing is retried here beyond the API boundary's own rule; retrying is the rider's call.
   */
  override suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): DirectionsResult {
    // Mapbox takes coordinates as `longitude,latitude` — the opposite order from `setDirectionPoint`.
    // Fixed 6 decimals: `Double.toString` writes small values as `5.0E-4`, which the server rejects.
    val coordinates = listOf(fromLongitude, fromLatitude, toLongitude, toLatitude)
      .map { String.format(Locale.ROOT, "%.6f", it) }
      .let { (a, b, c, d) -> "$a,$b;$c,$d" }
    val result = api.request(
      method = HttpMethod.GET,
      path = "$PATH/$profile/$coordinates",
      auth = AuthMode.Required,
      parse = ::parse,
    )
    return when (result) {
      is ApiResult.Ok -> result.value
      else -> {
        Log.w(TAG, "Directions call failed: $result")
        DirectionsResult.Failed
      }
    }
  }

  private fun parse(body: String): DirectionsResult {
    val route = JSONObject(body)
      .optJSONArray("routes")
      ?.takeIf { it.length() > 0 }
      ?.getJSONObject(0)
      ?: return DirectionsResult.NoPath
    val geometry = route.optString("geometry").takeIf { it.isNotEmpty() }
      ?: return DirectionsResult.NoPath

    val points = Polyline6.decode(geometry)
    if (points.isEmpty()) return DirectionsResult.NoPath
    // Mapbox reports both for the route it returned; they are the only length and time the app
    // ever shows, so nothing here recomputes them from the geometry.
    return DirectionsResult.Path(
      points = points,
      distanceMeters = route.optDouble("distance", 0.0).takeIf { it.isFinite() } ?: 0.0,
      durationSeconds = route.optDouble("duration", 0.0).takeIf { it.isFinite() } ?: 0.0,
    )
  }

  companion object {
    private const val TAG = "MapboxDirectionsApi"

    /** @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift `path` */
    private const val PATH = "/api/maps/directions"
  }
}
