package expo.modules.vescapecore.maps

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator

/**
 * Place search and reverse geocoding through the server's Mapbox proxy. The server keeps the Mapbox
 * secret and answers with Mapbox's body verbatim, so this hands the raw JSON to JS, which owns the
 * parsing. Native only owns the call because native owns the Device Token.
 *
 * @parity /modules/vescape-core/ios/maps/MapSearchApi.swift
 */
class MapSearchApi(private val api: VescapeApi) {
  /** Mapbox Search Box forward body. `proximity` is `longitude,latitude`. */
  suspend fun search(query: String, limit: Int, proximity: String?): String = unwrap(
    api.request(
      method = HttpMethod.GET,
      path = "$PATH/search",
      query = buildMap {
        put("q", query)
        put("limit", limit.toString())
        if (proximity != null) put("proximity", proximity)
      },
      auth = AuthMode.Required,
    ) { it },
  )

  /** Mapbox Geocoding v5 reverse body (the server asks for one feature). */
  suspend fun reverse(latitude: Double, longitude: Double): String = unwrap(
    api.request(
      method = HttpMethod.GET,
      path = "$PATH/reverse",
      query = mapOf("longitude" to longitude.toString(), "latitude" to latitude.toString()),
      auth = AuthMode.Required,
    ) { it },
  )

  private fun unwrap(result: ApiResult<String>): String = when (result) {
    is ApiResult.Ok -> result.value
    ApiResult.Unauthorized -> throw MapSearchApiException(SIGN_IN_REQUIRED, "Sign-in required")
    is ApiResult.Invalid -> throw MapSearchApiException(UNAVAILABLE, result.error)
    is ApiResult.Unavailable -> throw MapSearchApiException(UNAVAILABLE, result.cause)
    else -> throw MapSearchApiException(UNAVAILABLE, result.toString())
  }

  companion object {
    private const val PATH = "/api/maps"

    /**
     * Failure codes crossing the bridge.
     * @parity /modules/vescape-core/ios/maps/MapSearchApi.swift `MapSearchApiError`
     */
    const val SIGN_IN_REQUIRED = "MAP_SEARCH_SIGN_IN_REQUIRED"
    const val UNAVAILABLE = "MAP_SEARCH_UNAVAILABLE"

    @Volatile private var instance: MapSearchApi? = null

    fun get(context: Context): MapSearchApi {
      val app = context.applicationContext
      return instance ?: synchronized(this) {
        instance ?: MapSearchApi(
          VescapeApi.forOrigin(app, AppStatusCoordinator.serverBaseUrl(app)),
        ).also { instance = it }
      }
    }
  }
}

/** Carries the code JS branches on; Expo turns it into a rejected promise with that code. */
class MapSearchApiException(code: String, message: String) : CodedException(code, message, null)
