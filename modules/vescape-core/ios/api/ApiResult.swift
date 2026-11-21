import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiResult`
enum ApiResult<T> {
  case ok(T)
  case unauthorized
  case forbidden
  case notFound
  case invalid(String)
  case malformed(String)
  case unavailable(String)
  case cancelled
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `AuthMode`
enum AuthMode {
  case required
  case optional
  case bearer(String)
}

extension AuthMode {
  var rejectsStoredCredential: Bool {
    if case .required = self { return true }
    return false
  }
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
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/ApiResult.kt `ApiTransport`
protocol ApiTransport: Sendable {
  func execute(_ request: ApiRequest) async throws -> ApiResponse
}
