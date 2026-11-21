package expo.modules.vescapecore.mappoints

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import org.json.JSONArray
import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift
 * @parity /modules/vescape-core/src/index.ts `MapPoint`
 */
class MapPointApi(private val api: VescapeApi) {
  suspend fun nearby(
    latitude: Double,
    longitude: Double,
    radiusMeters: Int,
  ): Map<String, Any?> = unwrap(
    api.request(
      method = HttpMethod.GET,
      path = PATH,
      query = mapOf(
        "latitude" to latitude.toString(),
        "longitude" to longitude.toString(),
        "radiusMeters" to radiusMeters.toString(),
      ),
      auth = AuthMode.Optional,
    ) { body ->
      val json = JSONObject(body)
      val items = json.optJSONArray("items") ?: JSONArray()
      mapOf(
        "items" to (0 until items.length()).map { mapPoint(items.getJSONObject(it)) },
        "truncated" to json.optBoolean("truncated"),
      )
    },
  )

  suspend fun create(values: Map<String, Any?>): Map<String, Any?> = unwrap(
    api.request(HttpMethod.POST, PATH, body = payload(values), auth = AuthMode.Required) {
      mapPoint(JSONObject(it))
    },
  )

  suspend fun update(id: String, patch: Map<String, Any?>): Map<String, Any?> = unwrap(
    api.request(HttpMethod.PATCH, "$PATH/$id", body = payload(patch), auth = AuthMode.Required) {
      mapPoint(JSONObject(it))
    },
  )

  suspend fun delete(id: String) {
    unwrap(api.request(HttpMethod.DELETE, "$PATH/$id", auth = AuthMode.Required) { })
  }

  suspend fun setReaction(id: String, reaction: String?) {
    val path = "$PATH/$id/reaction"
    val result = if (reaction == null) {
      api.request(HttpMethod.DELETE, path, auth = AuthMode.Required) { }
    } else {
      api.request(
        method = HttpMethod.PUT,
        path = path,
        body = JSONObject().put("reaction", reaction),
        auth = AuthMode.Required,
      ) { }
    }
    unwrap(result)
  }

  private fun payload(values: Map<String, Any?>): JSONObject {
    val body = JSONObject()
    WRITABLE_FIELDS.filter { values.containsKey(it) }.forEach { field ->
      body.put(field, values[field] ?: JSONObject.NULL)
    }
    return body
  }

  private fun mapPoint(json: JSONObject): Map<String, Any?> = mapOf(
    "id" to json.getString("id"),
    "category" to json.getString("category"),
    "latitude" to json.getDouble("latitude"),
    "longitude" to json.getDouble("longitude"),
    "name" to json.optStringOrNull("name"),
    "description" to json.optStringOrNull("description"),
    "score" to json.getInt("score"),
    "myReaction" to json.optStringOrNull("myReaction"),
    "ownedByMe" to json.getBoolean("ownedByMe"),
    "distanceMeters" to json.getInt("distanceMeters"),
    "createdAt" to json.getString("createdAt"),
    "updatedAt" to json.getString("updatedAt"),
  )

  private fun JSONObject.optStringOrNull(name: String): String? =
    if (isNull(name)) null else optString(name).ifEmpty { null }

  private fun <T> unwrap(result: ApiResult<T>): T = when (result) {
    is ApiResult.Ok -> result.value
    ApiResult.Unauthorized -> throw MapPointApiException(SIGN_IN_REQUIRED, "Sign-in required")
    ApiResult.Forbidden -> throw MapPointApiException(NOT_YOURS, "Map Point belongs to someone else")
    ApiResult.NotFound -> throw MapPointApiException(GONE, "Map Point no longer exists")
    is ApiResult.Invalid -> throw MapPointApiException(REFUSED, result.error)
    is ApiResult.Malformed -> throw MapPointApiException(REFUSED, result.cause)
    is ApiResult.Unavailable -> throw MapPointApiException(UNREACHABLE, result.cause)
  }

  companion object {
    private const val PATH = "/map-points"
    private val WRITABLE_FIELDS = listOf("category", "latitude", "longitude", "name", "description")

    /**
     * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift `MapPointApiError`
     * @parity /modules/vescape-core/src/index.ts `MapPointErrorCode`
     */
    const val SIGN_IN_REQUIRED = "MAP_POINT_SIGN_IN_REQUIRED"
    const val NOT_YOURS = "MAP_POINT_NOT_YOURS"
    const val GONE = "MAP_POINT_GONE"
    const val REFUSED = "MAP_POINT_REFUSED"
    const val UNREACHABLE = "MAP_POINT_UNREACHABLE"

    @Volatile private var instance: MapPointApi? = null

    fun get(context: Context): MapPointApi {
      val app = context.applicationContext
      return instance ?: synchronized(this) {
        instance ?: MapPointApi(
          VescapeApi.forOrigin(app, AppStatusCoordinator.serverBaseUrl(app)),
        ).also { instance = it }
      }
    }
  }
}

class MapPointApiException(code: String, message: String) : CodedException(code, message, null)
