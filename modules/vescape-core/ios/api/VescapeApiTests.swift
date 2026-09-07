import XCTest

@testable import VescapeCore

/// Credential attachment, the 401 policy and the retry rule — the parts every feature client
/// inherits without restating.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/api/VescapeApiTest.kt
final class VescapeApiTests: XCTestCase {
  /// Answers each call with the next scripted step, repeating the last one once they run out.
  private final class FakeTransport: ApiTransport, @unchecked Sendable {
    private var steps: [() throws -> ApiResponse]
    private(set) var requests: [ApiRequest] = []

    init(_ steps: (() throws -> ApiResponse)...) { self.steps = steps }

    func execute(_ request: ApiRequest) async throws -> ApiResponse {
      requests.append(request)
      let step = steps.count > 1 ? steps.removeFirst() : steps[0]
      return try step()
    }
  }

  private func ok(_ body: String = "{}") -> () throws -> ApiResponse {
    { ApiResponse(status: 200, body: body) }
  }

  private func status(_ code: Int, _ body: String = "") -> () throws -> ApiResponse {
    { ApiResponse(status: code, body: body) }
  }

  private func offline() -> () throws -> ApiResponse {
    { throw NSError(domain: "test", code: -1009) }
  }

  private let credential = DeviceCredential(
    serverUrl: "https://api.vescape.app",
    token: "device-token",
    accountId: "account-1",
    expiresAt: nil
  )

  private var rejections = 0

  override func setUp() {
    super.setUp()
    rejections = 0
  }

  private func api(
    _ transport: ApiTransport,
    stored: DeviceCredential?,
    baseUrl: String = "https://api.vescape.app"
  ) -> VescapeApi {
    VescapeApi(
      baseUrl: baseUrl,
      appVersion: "0.81.3",
      credentialProvider: { stored },
      onUnauthorized: { [weak self] in self?.rejections += 1 },
      transport: transport,
      retryDelayNanoseconds: 0
    )
  }

  private func text(
    _ api: VescapeApi,
    _ method: HttpMethod = .get,
    path: String = "/map-points",
    query: [String: String] = [:],
    body: [String: Any]? = nil,
    auth: AuthMode = .required
  ) async -> ApiResult<String> {
    await api.request(method, path: path, query: query, body: body, auth: auth) { $0 }
  }

  func testAttachesCredentialAndAppVersion() async {
    let transport = FakeTransport(ok())
    _ = await text(api(transport, stored: credential), query: ["radiusMeters": "5000"])

    let request = try! XCTUnwrap(transport.requests.first)
    XCTAssertEqual(request.url, "https://api.vescape.app/map-points?radiusMeters=5000")
    XCTAssertEqual(request.headers["Authorization"], "Bearer device-token")
    XCTAssertEqual(request.headers["Vescape-App-Version"], "0.81.3")
  }

  func testRefusesRequiredCallWithoutCredential() async {
    let transport = FakeTransport(ok())
    let result = await text(api(transport, stored: nil))

    guard case .unauthorized = result else { return XCTFail("Expected unauthorized, got \(result)") }
    XCTAssertTrue(transport.requests.isEmpty)
  }

  func testSendsOptionalCallAnonymously() async {
    let transport = FakeTransport(ok())
    _ = await text(api(transport, stored: nil), auth: .optional)

    XCTAssertNil(transport.requests.first?.headers["Authorization"])
  }

  func testMatchesCredentialOriginWithTrailingSlash() async {
    let transport = FakeTransport(ok())
    _ = await text(api(transport, stored: credential, baseUrl: "https://api.vescape.app/"))

    XCTAssertEqual(transport.requests.first?.headers["Authorization"], "Bearer device-token")
    XCTAssertEqual(transport.requests.first?.url, "https://api.vescape.app/map-points")
  }

  /// A credential minted against another origin belongs to another environment.
  func testIgnoresCredentialFromAnotherOrigin() async {
    let transport = FakeTransport(ok())
    let result = await text(api(transport, stored: credential, baseUrl: "http://127.0.0.1:3000"))

    guard case .unauthorized = result else { return XCTFail("Expected unauthorized, got \(result)") }
    XCTAssertTrue(transport.requests.isEmpty)
  }

  func testRejectsStoredCredentialOnceOnAuthenticatedUnauthorized() async {
    let transport = FakeTransport(status(401))
    let result = await text(api(transport, stored: credential))

    guard case .unauthorized = result else { return XCTFail("Expected unauthorized, got \(result)") }
    XCTAssertEqual(rejections, 1)
    XCTAssertEqual(transport.requests.count, 1)
  }

  /// An anonymous read cannot say anything about a credential it never sent.
  func testKeepsCredentialWhenAnonymousCallIsUnauthorized() async {
    let transport = FakeTransport(status(401))
    _ = await text(api(transport, stored: nil), auth: .optional)

    XCTAssertEqual(rejections, 0)
  }

  func testExplicitBearerUnauthorizedDoesNotRejectStoredCredential() async {
    let transport = FakeTransport(status(401))
    let result = await text(api(transport, stored: credential), auth: .bearer("candidate-token"))

    guard case .unauthorized = result else { return XCTFail("Expected unauthorized") }
    XCTAssertEqual(rejections, 0)
  }

  func testCancellationStopsWithoutRetry() async {
    let transport = FakeTransport({ throw CancellationError() })
    let result = await text(api(transport, stored: credential))

    guard case .cancelled = result else { return XCTFail("Expected cancellation") }
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testMapsRefusalStatuses() async {
    let forbidden = await text(api(FakeTransport(status(403)), stored: credential))
    guard case .forbidden = forbidden else { return XCTFail("Expected forbidden") }

    let missing = await text(api(FakeTransport(status(404)), stored: credential))
    guard case .notFound = missing else { return XCTFail("Expected notFound") }

    let refused = await text(
      api(FakeTransport(status(400, #"{"error":"invalid-request"}"#)), stored: credential)
    )
    guard case .invalid(let slug) = refused else { return XCTFail("Expected invalid") }
    XCTAssertEqual(slug, "invalid-request")
  }

  func testReportsUnparsableResponseAsMalformed() async {
    let transport = FakeTransport(ok("not json"))
    let result: ApiResult<String> = await api(transport, stored: credential).request(
      .get,
      path: "/map-points"
    ) { body in
      guard let data = body.data(using: .utf8),
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let id = json["id"] as? String
      else { throw NSError(domain: "test", code: 1) }
      return id
    }

    guard case .malformed = result else { return XCTFail("Expected malformed, got \(result)") }
  }

  func testRetriesIdempotentCallOnce() async {
    let transport = FakeTransport(offline(), ok())
    let result = await text(api(transport, stored: credential))

    guard case .ok(let body) = result else { return XCTFail("Expected ok, got \(result)") }
    XCTAssertEqual(body, "{}")
    XCTAssertEqual(transport.requests.count, 2)
  }

  func testNeverRepeatsCreate() async {
    let transport = FakeTransport(offline())
    let result = await text(api(transport, stored: credential), .post, body: [:])

    guard case .unavailable = result else { return XCTFail("Expected unavailable, got \(result)") }
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testTreatsServerFaultAsRetryableThenUnavailable() async {
    let transport = FakeTransport(status(503))
    let result = await text(api(transport, stored: credential))

    guard case .unavailable(let cause) = result else { return XCTFail("Expected unavailable") }
    XCTAssertEqual(cause, "Server error (503)")
    XCTAssertEqual(transport.requests.count, 2)
  }

  func testSendsJsonBodyWithContentType() async {
    let transport = FakeTransport(ok())
    _ = await text(api(transport, stored: credential), .post, body: ["category": "drop"])

    let request = try! XCTUnwrap(transport.requests.first)
    XCTAssertEqual(request.method, .post)
    XCTAssertEqual(request.headers["Content-Type"], "application/json")
    XCTAssertEqual(request.body, #"{"category":"drop"}"#)
  }
}
