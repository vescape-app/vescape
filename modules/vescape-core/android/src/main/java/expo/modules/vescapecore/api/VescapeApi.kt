package expo.modules.vescapecore.api

import android.content.Context
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.auth.DeviceCredential
import expo.modules.vescapecore.auth.DeviceCredentialStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Authenticated HTTP boundary for every Vescape backend call made from native. Feature clients
 * describe a call; this owns the credential, the headers, the retry rule and the 401 policy, and
 * never learns what the call means.
 *
 * It deliberately holds no Expo or React types: long-lived native work (recording, background
 * drains) must keep talking to the server while the JS runtime is gone.
 *
 * @parity /modules/vescape-core/ios/api/VescapeApi.swift
 */
class VescapeApi(
  baseUrl: String,
  private val appVersion: String,
  private val credentialProvider: () -> DeviceCredential? = { null },
  private val onUnauthorized: () -> Unit = {},
  private val transport: ApiTransport = OkHttpApiTransport,
  private val retryDelayMillis: Long = RETRY_DELAY_MILLIS,
) {
  /** Trailing slash trimmed once, so path joins stay single-slashed and origin compares hold. */
  private val baseUrl = baseUrl.trimEnd('/')

  suspend fun <T> request(
    method: HttpMethod,
    path: String,
    query: Map<String, String> = emptyMap(),
    body: JSONObject? = null,
    auth: AuthMode = AuthMode.Required,
    parse: (String) -> T,
  ): ApiResult<T> = withContext(Dispatchers.IO) {
    val token = token(auth) ?: return@withContext ApiResult.Unauthorized
    val request = ApiRequest(
      method = method,
      url = url(path, query),
      headers = headers(token.ifEmpty { null }, body != null),
      body = body?.toString(),
    )
    send(request, authenticated = token.isNotEmpty(), parse = parse)
  }

  /**
   * One call whose status code is the answer, not an error to classify. The uploader needs `409`,
   * `413` and `429` kept apart — each has a different recovery — so it reads the raw exchange while
   * still going through this class's credential, headers and 401 policy.
   *
   * Never retried here: `POST /api/sync` carries no create key, and the caller's own backoff is what
   * decides when the same batch is offered again.
   *
   * @parity /modules/vescape-core/ios/api/VescapeApi.swift `exchange`
   */
  suspend fun exchange(
    method: HttpMethod,
    path: String,
    rawBody: String?,
    auth: AuthMode = AuthMode.Required,
  ): ApiResponse? = withContext(Dispatchers.IO) {
    val token = token(auth) ?: return@withContext ApiResponse(401, "")
    val request = ApiRequest(
      method = method,
      url = url(path, emptyMap()),
      headers = headers(token.ifEmpty { null }, rawBody != null),
      body = rawBody,
    )
    val response = try {
      transport.execute(request)
    } catch (_: Exception) {
      return@withContext null
    }
    if (response.status == 401 && token.isNotEmpty()) onUnauthorized()
    response
  }

  /**
   * Resolved bearer token, empty when the call goes out anonymously, `null` when a required
   * credential is missing. A credential minted against another origin belongs to another
   * environment, so it counts as missing rather than being sent to this one.
   */
  private fun token(auth: AuthMode): String? = when (auth) {
    is AuthMode.Bearer -> auth.token
    AuthMode.Optional -> storedToken() ?: ""
    AuthMode.Required -> storedToken()
  }

  private fun storedToken(): String? = credentialProvider()
    ?.takeIf { it.serverUrl.trimEnd('/') == baseUrl }
    ?.token

  private fun headers(token: String?, hasBody: Boolean): Map<String, String> = buildMap {
    put(AppStatusCoordinator.APP_VERSION_HEADER, appVersion)
    if (hasBody) put("Content-Type", JSON_CONTENT_TYPE)
    if (token != null) put("Authorization", "Bearer $token")
  }

  private fun url(path: String, query: Map<String, String>): String {
    val suffix = query.entries.joinToString("&") { (key, value) ->
      "${encode(key)}=${encode(value)}"
    }
    return baseUrl + path + if (suffix.isEmpty()) "" else "?$suffix"
  }

  private suspend fun <T> send(
    request: ApiRequest,
    authenticated: Boolean,
    parse: (String) -> T,
  ): ApiResult<T> {
    var retried = false
    while (true) {
      val response = try {
        transport.execute(request)
      } catch (e: Exception) {
        if (canRetry(request, retried)) {
          retried = true
          delay(retryDelayMillis)
          continue
        }
        return ApiResult.Unavailable(e.message ?: e.javaClass.simpleName)
      }

      if (response.status >= 500) {
        if (canRetry(request, retried)) {
          retried = true
          delay(retryDelayMillis)
          continue
        }
        return ApiResult.Unavailable("Server error (${response.status})")
      }

      return outcome(response, authenticated, parse)
    }
  }

  /** Only idempotent calls repeat. No endpoint here takes a create key, so a repeated POST duplicates. */
  private fun canRetry(request: ApiRequest, retried: Boolean) = request.method.idempotent && !retried

  private fun <T> outcome(
    response: ApiResponse,
    authenticated: Boolean,
    parse: (String) -> T,
  ): ApiResult<T> = when {
    response.status == 401 -> {
      // An anonymous read cannot say anything about the stored credential, so it must not reject it.
      if (authenticated) onUnauthorized()
      ApiResult.Unauthorized
    }
    response.status == 403 -> ApiResult.Forbidden
    response.status == 404 -> ApiResult.NotFound
    response.status >= 400 -> ApiResult.Invalid(errorSlug(response.body))
    else -> try {
      ApiResult.Ok(parse(response.body))
    } catch (e: Exception) {
      ApiResult.Malformed(e.message ?: e.javaClass.simpleName)
    }
  }

  private fun errorSlug(body: String): String = try {
    JSONObject(body).optString("error").ifEmpty { INVALID_REQUEST }
  } catch (_: Exception) {
    INVALID_REQUEST
  }

  private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

  companion object {
    private const val INVALID_REQUEST = "invalid-request"
    private const val JSON_CONTENT_TYPE = "application/json"
    private const val RETRY_DELAY_MILLIS = 300L

    /**
     * Client pinned to an origin. Callers pass the baked backend origin
     * ([AppStatusCoordinator.serverBaseUrl]); provisioning passes the origin named by the credential
     * it is about to verify, because nothing is stored yet. Reads stay usable while signed out — the
     * credential is attached only when one exists.
     */
    fun forOrigin(context: Context, serverUrl: String): VescapeApi {
      val app = context.applicationContext
      val store = DeviceCredentialStore(app)
      return VescapeApi(
        baseUrl = serverUrl.trimEnd('/'),
        appVersion = AppStatusCoordinator.get(app).appVersion,
        credentialProvider = { store.read() },
        onUnauthorized = {
          store.reject()
          AppStatusCoordinator.get(app).refresh()
        },
      )
    }
  }
}

/**
 * @parity /modules/vescape-core/ios/api/VescapeApi.swift `UrlSessionApiTransport`
 */
object OkHttpApiTransport : ApiTransport {
  private val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
  private val jsonMediaType = "application/json".toMediaType()

  override fun execute(request: ApiRequest): ApiResponse {
    val builder = Request.Builder().url(request.url)
    request.headers.forEach { (name, value) -> builder.header(name, value) }
    val body = when {
      request.body != null -> request.body.toRequestBody(jsonMediaType)
      request.method == HttpMethod.GET || request.method == HttpMethod.DELETE -> null
      else -> "".toRequestBody(jsonMediaType)
    }
    builder.method(request.method.name, body)
    return client.newCall(builder.build()).execute().use { response ->
      ApiResponse(
        status = response.code,
        body = response.body?.string().orEmpty(),
        headers = response.headers.names().associate { it.lowercase() to response.header(it).orEmpty() },
      )
    }
  }
}
