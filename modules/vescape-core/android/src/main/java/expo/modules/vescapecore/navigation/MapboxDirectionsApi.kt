package expo.modules.vescapecore.navigation

import android.util.Log
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import org.json.JSONObject
import java.util.Locale

/**
 * @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift
 */
class MapboxDirectionsApi(private val api: VescapeApi) : DirectionsRoutes {
  override suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): DirectionsResult {
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
