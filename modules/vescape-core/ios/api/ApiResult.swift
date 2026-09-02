import Foundation

/// Outcome of one Vescape API call. Callers branch on this instead of catching transport errors, so
/// every feature client treats a rejected credential, a refused write and a dead network the same
/// way.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiResult`
enum ApiResult<T> {
  case ok(T)
  /// Credential missing, expired or revoked. Already rejected locally; never retry.
  case unauthorized
  /// Authenticated, but this Account may not touch the resource.
  case forbidden
  case notFound
  /// Request the server refused as malformed, carrying its error slug.
  case invalid(String)
  /// The server answered, but not in the shape this client expects. A contract drift, not a fault.
  case malformed(String)
  /// Offline, timed out, or a server fault. Retryable later.
  case unavailable(String)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `HttpMethod`
enum HttpMethod: String {
  case get = "GET"
  case post = "POST"
  case patch = "PATCH"
  case put = "PUT"
  case delete = "DELETE"

  var idempotent: Bool { self != .post && self != .patch }
}

/// How one call presents itself to the server.
///
/// `required` fails without a usable credential instead of sending an anonymous request that would
/// silently behave like a different caller. `optional` is for public reads that gain per-Account
/// fields when a credential exists. `bearer` carries a credential the store does not hold yet, which
/// is what provisioning needs.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `AuthMode`
enum AuthMode {
  case required
  case optional
  case bearer(String)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiRequest`
struct ApiRequest {
  let method: HttpMethod
  let url: String
  let headers: [String: String]
  let body: String?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiResponse`
struct ApiResponse {
  let status: Int
  let body: String
  /// Lowercased response headers. Only what a caller has to act on crosses this seam today: a `429`
  /// carries its delay in `Retry-After`, and guessing one instead would either hammer the server or
  /// stall a drain far longer than it asked for.
  var headers: [String: String] = [:]
}

/// The single HTTP seam. Production wires `URLSession`; tests wire a fake and never reach the
/// network. Throws for transport failure — status codes are not failures here.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiTransport`
protocol ApiTransport: Sendable {
  func execute(_ request: ApiRequest) async throws -> ApiResponse
}
