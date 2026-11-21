package expo.modules.vescapecore.api

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiResult`
 */
sealed interface ApiResult<out T> {
  data class Ok<T>(val value: T) : ApiResult<T>

  data object Unauthorized : ApiResult<Nothing>

  data object Forbidden : ApiResult<Nothing>

  data object NotFound : ApiResult<Nothing>

  data class Invalid(val error: String) : ApiResult<Nothing>

  data class Malformed(val cause: String) : ApiResult<Nothing>

  data class Unavailable(val cause: String) : ApiResult<Nothing>
}

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `HttpMethod`
 */
enum class HttpMethod(val idempotent: Boolean) {
  GET(true),
  POST(false),
  PATCH(false),
  PUT(true),
  DELETE(true),
}

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `AuthMode`
 */
sealed interface AuthMode {
  data object Required : AuthMode

  data object Optional : AuthMode

  data class Bearer(val token: String) : AuthMode
}

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiRequest`
 */
data class ApiRequest(
  val method: HttpMethod,
  val url: String,
  val headers: Map<String, String>,
  val body: String?,
)

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiResponse`
 */
data class ApiResponse(val status: Int, val body: String)

/**
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiTransport`
 */
fun interface ApiTransport {
  fun execute(request: ApiRequest): ApiResponse
}
