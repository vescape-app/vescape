package expo.modules.vescapecore.api

/**
 * Outcome of one Vescape API call. Callers branch on this instead of catching transport
 * exceptions, so every feature client treats a rejected credential, a refused write and a dead
 * network the same way.
 *
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiResult`
 */
sealed interface ApiResult<out T> {
  data class Ok<T>(val value: T) : ApiResult<T>

  /** Credential missing, expired or revoked. Already rejected locally; never retry. */
  data object Unauthorized : ApiResult<Nothing>

  /** Authenticated, but this Account may not touch the resource. */
  data object Forbidden : ApiResult<Nothing>

  data object NotFound : ApiResult<Nothing>

  /** Request the server refused as malformed, carrying its error slug. */
  data class Invalid(val error: String) : ApiResult<Nothing>

  /** The server answered, but not in the shape this client expects. A contract drift, not a fault. */
  data class Malformed(val cause: String) : ApiResult<Nothing>

  /** Offline, timed out, or a server fault. Retryable later. */
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
 * How one call presents itself to the server.
 *
 * `Required` fails without a usable credential instead of sending an anonymous request that would
 * silently behave like a different caller. `Optional` is for public reads that gain per-Account
 * fields when a credential exists. `Bearer` carries a credential the store does not hold yet, which
 * is what provisioning needs.
 *
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
data class ApiResponse(
  val status: Int,
  val body: String,
  /**
   * Lowercased response headers. Only what a caller has to act on crosses this seam today: a `429`
   * carries its delay in `Retry-After`, and guessing one instead would either hammer the server or
   * stall a drain far longer than it asked for.
   */
  val headers: Map<String, String> = emptyMap(),
)

/**
 * The single blocking HTTP seam. Production wires OkHttp; tests wire a fake and never reach the
 * network. Throws for transport failure — status codes are not failures here.
 *
 * @parity /modules/vescape-core/ios/api/ApiResult.swift `ApiTransport`
 */
fun interface ApiTransport {
  fun execute(request: ApiRequest): ApiResponse
}
