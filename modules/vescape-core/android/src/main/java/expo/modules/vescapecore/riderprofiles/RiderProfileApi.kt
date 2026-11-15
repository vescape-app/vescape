package expo.modules.vescapecore.riderprofiles

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
 * The signed-in Account's public Rider Profile (nick + nationality), other riders' profiles and the
 * Account's Friends. Server-owned; native holds no copy and only attaches the Device Token.
 *
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift
 * @parity /modules/vescape-core/src/index.ts `RiderProfile`
 */
class RiderProfileApi(private val api: VescapeApi) {
  /** `null` until the Account has picked a nick. */
  suspend fun mine(): Map<String, Any?>? = unwrap(
    api.request(HttpMethod.GET, PATH, auth = AuthMode.Required) { body ->
      JSONObject(body).optJSONObject("profile")?.let(::profile)
    },
  )

  suspend fun save(nick: String, nationality: String?): Map<String, Any?> = unwrap(
    api.request(
      method = HttpMethod.PUT,
      path = PATH,
      body = JSONObject().put("nick", nick).put("nationality", nationality ?: JSONObject.NULL),
      auth = AuthMode.Required,
    ) { profile(JSONObject(it)) },
  )

  /** Profiles whose nick starts with `prefix`, at most 20. */
  suspend fun search(prefix: String): List<Map<String, Any?>> = unwrap(
    api.request(HttpMethod.GET, RIDERS_PATH, query = mapOf("nick" to prefix), auth = AuthMode.Required) { body ->
      JSONObject(body).getJSONArray("items").let { items -> List(items.length()) { profile(items.getJSONObject(it)) } }
    },
  )

  /** `null` when the Account has no Rider Profile. */
  suspend fun rider(accountId: String): Map<String, Any?>? {
    val result = api.request(HttpMethod.GET, "$RIDERS_PATH/$accountId", auth = AuthMode.Required) {
      profile(JSONObject(it))
    }
    return if (result == ApiResult.NotFound) null else unwrap(result)
  }

  /** @parity /modules/vescape-core/src/index.ts `Friends` */
  suspend fun friends(): Map<String, Any?> = unwrap(
    api.request(HttpMethod.GET, FRIENDS_PATH, auth = AuthMode.Required) { body ->
      val json = JSONObject(body)
      val friends = json.getJSONArray("friends")
      mapOf(
        "friends" to List(friends.length()) { index ->
          val friend = friends.getJSONObject(index)
          profile(friend) + mapOf(
            "ridingNow" to friend.optBoolean("ridingNow", false),
            "lastOnlineAt" to if (friend.isNull("lastOnlineAt")) null else friend.optString("lastOnlineAt"),
          )
        },
        "incoming" to requests(json.getJSONArray("incoming")),
        "outgoing" to requests(json.getJSONArray("outgoing")),
      )
    },
  )

  /** `requested`, or `friends` when the other side had already asked. */
  suspend fun requestFriend(accountId: String): String = unwrap(
    api.request(
      method = HttpMethod.POST,
      path = "$FRIENDS_PATH/requests",
      body = JSONObject().put("accountId", accountId),
      auth = AuthMode.Required,
    ) { JSONObject(it).getString("status") },
  )

  suspend fun acceptFriend(accountId: String): Unit = unwrap(
    api.request(HttpMethod.POST, "$FRIENDS_PATH/requests/$accountId/accept", auth = AuthMode.Required) { },
  )

  /** Declines an incoming request or withdraws an outgoing one. */
  suspend fun deleteFriendRequest(accountId: String): Unit = unwrap(
    api.request(HttpMethod.DELETE, "$FRIENDS_PATH/requests/$accountId", auth = AuthMode.Required) { },
  )

  /** Silent: the other side is not told. */
  suspend fun removeFriend(accountId: String): Unit = unwrap(
    api.request(HttpMethod.DELETE, "$FRIENDS_PATH/$accountId", auth = AuthMode.Required) { },
  )

  /**
   * The Crew Rides the Account rode in between `from` and `to` (ISO, at most 24 h apart), with the
   * other riders' tracks cut to that range. Read on demand; nothing is stored.
   *
   * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `rodeWith`
   * @parity /modules/vescape-core/src/index.ts `RodeWithCrewRide`
   */
  suspend fun rodeWith(from: String, to: String): List<Map<String, Any?>> = unwrap(
    api.request(
      HttpMethod.GET,
      RODE_WITH_PATH,
      query = mapOf("from" to from, "to" to to),
      auth = AuthMode.Required,
    ) { body ->
      val crewRides = JSONObject(body).getJSONArray("crewRides")
      List(crewRides.length()) { index ->
        val crewRide = crewRides.getJSONObject(index)
        val riders = crewRide.getJSONArray("riders")
        mapOf(
          "startedAt" to crewRide.getString("startedAt"),
          "endedAt" to crewRide.getString("endedAt"),
          "riders" to List(riders.length()) { rodeWithRider(riders.getJSONObject(it)) },
        )
      }
    },
  )

  private fun rodeWithRider(json: JSONObject): Map<String, Any?> {
    val track = json.getJSONArray("track")
    return profile(json) + mapOf(
      "startedAt" to json.getString("startedAt"),
      "endedAt" to json.getString("endedAt"),
      "track" to List(track.length()) { index ->
        val point = track.getJSONObject(index)
        mapOf("at" to point.getDouble("at"), "lat" to point.getDouble("lat"), "lng" to point.getDouble("lng"))
      },
    )
  }

  private fun requests(items: JSONArray): List<Map<String, Any?>> = List(items.length()) { index ->
    val item = items.getJSONObject(index)
    profile(item) + ("requestedAt" to item.optString("requestedAt"))
  }

  private fun profile(json: JSONObject): Map<String, Any?> = mapOf(
    "accountId" to json.getString("accountId"),
    "nick" to json.getString("nick"),
    "nationality" to if (json.isNull("nationality")) null else json.optString("nationality").ifEmpty { null },
  )

  private fun <T> unwrap(result: ApiResult<T>): T = when (result) {
    is ApiResult.Ok -> result.value
    ApiResult.Unauthorized -> throw RiderProfileApiException(SIGN_IN_REQUIRED, "Sign-in required")
    ApiResult.Forbidden, ApiResult.NotFound -> throw RiderProfileApiException(REFUSED, "Rider Profile refused")
    is ApiResult.Invalid -> throw RiderProfileApiException(
      if (result.error == NICK_TAKEN_SLUG) NICK_TAKEN else REFUSED,
      result.error,
    )
    is ApiResult.Malformed -> throw RiderProfileApiException(REFUSED, result.cause)
    is ApiResult.Unavailable -> throw RiderProfileApiException(UNREACHABLE, result.cause)
  }

  companion object {
    private const val PATH = "/api/rider-profile"
    private const val RIDERS_PATH = "/api/riders"
    private const val FRIENDS_PATH = "/api/friends"
    private const val RODE_WITH_PATH = "/api/rides/rode-with"
    private const val NICK_TAKEN_SLUG = "nick-taken"

    /**
     * Failure codes crossing the bridge.
     * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `RiderProfileApiError`
     * @parity /modules/vescape-core/src/index.ts `RiderProfileErrorCode`
     */
    const val SIGN_IN_REQUIRED = "RIDER_PROFILE_SIGN_IN_REQUIRED"
    const val NICK_TAKEN = "RIDER_PROFILE_NICK_TAKEN"
    const val REFUSED = "RIDER_PROFILE_REFUSED"
    const val UNREACHABLE = "RIDER_PROFILE_UNREACHABLE"

    @Volatile private var instance: RiderProfileApi? = null

    fun get(context: Context): RiderProfileApi {
      val app = context.applicationContext
      return instance ?: synchronized(this) {
        instance ?: RiderProfileApi(
          VescapeApi.forOrigin(app, AppStatusCoordinator.serverBaseUrl(app)),
        ).also { instance = it }
      }
    }
  }
}

/** Carries the code JS branches on; Expo turns it into a rejected promise with that code. */
class RiderProfileApiException(code: String, message: String) : CodedException(code, message, null)
