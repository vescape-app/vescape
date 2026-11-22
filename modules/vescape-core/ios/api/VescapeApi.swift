import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/VescapeApi.kt
final class VescapeApi {
  private let baseUrl: String
  private let appVersion: String
  private let credentialProvider: () throws -> DeviceCredential?
  private let onUnauthorized: () throws -> Void
  private let transport: ApiTransport
  private let retryDelayNanoseconds: UInt64

  private static let invalidRequest = "invalid-request"
  private static let jsonContentType = "application/json"
  private static let retryDelayNanosecondsDefault: UInt64 = 300_000_000

  init(
    baseUrl: String,
    appVersion: String,
    credentialProvider: @escaping () throws -> DeviceCredential? = { nil },
    onUnauthorized: @escaping () throws -> Void = {},
    transport: ApiTransport = UrlSessionApiTransport(),
    retryDelayNanoseconds: UInt64 = VescapeApi.retryDelayNanosecondsDefault
  ) {
    self.baseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
    self.appVersion = appVersion
    self.credentialProvider = credentialProvider
    self.onUnauthorized = onUnauthorized
    self.transport = transport
    self.retryDelayNanoseconds = retryDelayNanoseconds
  }

  func request<T>(
    _ method: HttpMethod,
    path: String,
    query: [String: String] = [:],
    body: [String: Any]? = nil,
    auth: AuthMode = .required,
    parse: (String) throws -> T
  ) async -> ApiResult<T> {
    let token: String
    do { guard let resolved = try self.token(for: auth) else { return .unauthorized }; token = resolved }
    catch {
      if Self.isCancellation(error) { return .cancelled }
      UnexpectedNativeError.report(operation: "device_credential_read", category: "secure_store_read", error: error)
      return .unavailable("Device credential is unavailable")
    }
    let encodedBody = body.flatMap { serialize($0) }
    if body != nil && encodedBody == nil { return .malformed("Request body is not JSON") }
    let request = ApiRequest(
      method: method,
      url: url(path: path, query: query),
      headers: headers(token: token.isEmpty ? nil : token, hasBody: encodedBody != nil),
      body: encodedBody
    )
    return await send(
      request,
      rejectsStoredCredential: auth.rejectsStoredCredential && !token.isEmpty,
      parse: parse
    )
  }

  private func token(for auth: AuthMode) throws -> String? {
    switch auth {
    case .bearer(let token): return token
    case .optional: return try storedToken() ?? ""
    case .required: return try storedToken()
    }
  }

  private func storedToken() throws -> String? {
    guard let credential = try credentialProvider() else { return nil }
    let origin = credential.serverUrl.hasSuffix("/")
      ? String(credential.serverUrl.dropLast())
      : credential.serverUrl
    return origin == baseUrl ? credential.token : nil
  }

  private func headers(token: String?, hasBody: Bool) -> [String: String] {
    var headers = [AppStatusCoordinator.appVersionHeader: appVersion]
    if hasBody { headers["Content-Type"] = Self.jsonContentType }
    if let token { headers["Authorization"] = "Bearer \(token)" }
    return headers
  }

  private func url(path: String, query: [String: String]) -> String {
    guard !query.isEmpty else { return baseUrl + path }
    var components = URLComponents()
    components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    let encoded = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B") ?? ""
    return baseUrl + path + "?" + encoded
  }

  private func send<T>(
    _ request: ApiRequest,
    rejectsStoredCredential: Bool,
    parse: (String) throws -> T
  ) async -> ApiResult<T> {
    var retried = false
    while true {
      do {
        let response = try await transport.execute(request)
        if response.status >= 500 {
          if canRetry(request, retried: retried) {
            retried = true
            do { try await Task.sleep(nanoseconds: retryDelayNanoseconds) }
            catch where Self.isCancellation(error) { return .cancelled }
            catch { return .unavailable(error.localizedDescription) }
            continue
          }
          return .unavailable("Server error (\(response.status))")
        }
        return outcome(response, rejectsStoredCredential: rejectsStoredCredential, parse: parse)
      } catch {
        if Self.isCancellation(error) { return .cancelled }
        if canRetry(request, retried: retried) {
          retried = true
          do { try await Task.sleep(nanoseconds: retryDelayNanoseconds) }
          catch where Self.isCancellation(error) { return .cancelled }
          catch { return .unavailable(error.localizedDescription) }
          continue
        }
        return .unavailable(error.localizedDescription)
      }
    }
  }

  private func canRetry(_ request: ApiRequest, retried: Bool) -> Bool {
    request.method.idempotent && !retried
  }

  private func outcome<T>(
    _ response: ApiResponse,
    rejectsStoredCredential: Bool,
    parse: (String) throws -> T
  ) -> ApiResult<T> {
    switch response.status {
    case 401:
      if rejectsStoredCredential {
        do { try onUnauthorized() }
        catch {
          if Self.isCancellation(error) { return .cancelled }
          UnexpectedNativeError.report(operation: "device_credential_reject", category: "secure_store_delete", error: error)
          return .unavailable("Device credential could not be rejected")
        }
      }
      return .unauthorized
    case 403: return .forbidden
    case 404: return .notFound
    case 200..<300:
      do {
        return .ok(try parse(response.body))
      } catch {
        if Self.isCancellation(error) { return .cancelled }
        return .malformed(error.localizedDescription)
      }
    default: return .invalid(errorSlug(response.body))
    }
  }

  private func errorSlug(_ body: String) -> String {
    guard let data = body.data(using: .utf8),
          // intentional-suppression: caller maps malformed request encoding to an explicit API error
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let error = json["error"] as? String,
          !error.isEmpty
    else { return Self.invalidRequest }
    return error
  }

  private func serialize(_ body: [String: Any]) -> String? {
    // intentional-suppression: caller maps malformed request encoding to an explicit API error
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func isCancellation(_ error: Error) -> Bool {
    if Task.isCancelled || error is CancellationError { return true }
    return (error as? URLError)?.code == .cancelled
  }

  static func forOrigin(_ serverUrl: String) -> VescapeApi {
    let store = DeviceCredentialStore.shared
    return VescapeApi(
      baseUrl: serverUrl,
      appVersion: AppStatusCoordinator.installedMarketingVersion(),
      credentialProvider: { try store.read() },
      onUnauthorized: {
        try store.reject()
        Task { @MainActor in AppStatusCoordinator.shared.refresh() }
      }
    )
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/api/VescapeApi.kt `OkHttpApiTransport`
struct UrlSessionApiTransport: ApiTransport {
  private let timeout: TimeInterval = 10

  func execute(_ request: ApiRequest) async throws -> ApiResponse {
    guard let url = URL(string: request.url) else {
      throw NSError(domain: "VescapeApi", code: -1)
    }
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = request.method.rawValue
    urlRequest.timeoutInterval = timeout
    request.headers.forEach { urlRequest.setValue($0.value, forHTTPHeaderField: $0.key) }
    urlRequest.httpBody = request.body?.data(using: .utf8)
    let (data, response) = try await URLSession.shared.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else {
      throw NSError(domain: "VescapeApi", code: -2)
    }
    return ApiResponse(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
  }
}
