package expo.modules.vescapecore.api

import expo.modules.vescapecore.auth.DeviceCredential
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch

/**
 * Credential attachment, the 401 policy and the retry rule — the parts every feature client
 * inherits without restating.
 *
 * @parity /modules/vescape-core/ios/api/VescapeApiTests.swift
 */
class VescapeApiTest {
  /** Answers each call with the next scripted step, repeating the last one once they run out. */
  private class FakeTransport(vararg steps: () -> ApiResponse) : ApiTransport {
    private val steps = steps.toMutableList()
    val requests = mutableListOf<ApiRequest>()

    override fun execute(request: ApiRequest): ApiResponse {
      requests.add(request)
      return (if (steps.size > 1) steps.removeAt(0) else steps.first()).invoke()
    }
  }

  private fun ok(body: String = "{}"): () -> ApiResponse = { ApiResponse(200, body) }
  private fun status(code: Int, body: String = ""): () -> ApiResponse = { ApiResponse(code, body) }
  private fun offline(): () -> ApiResponse = { throw IOException("No route to host") }

  private val credential = DeviceCredential(
    serverUrl = "https://api.vescape.app",
    token = "device-token",
    accountId = "account-1",
    expiresAt = null,
  )

  private var rejections = 0

  private fun api(
    transport: ApiTransport,
    stored: DeviceCredential? = credential,
    baseUrl: String = "https://api.vescape.app",
  ) = VescapeApi(
    baseUrl = baseUrl,
    appVersion = "0.81.3",
    credentialProvider = { stored },
    onUnauthorized = { rejections++ },
    transport = transport,
    retryDelayMillis = 0,
  )

  private fun VescapeApi.text(
    method: HttpMethod = HttpMethod.GET,
    path: String = "/map-points",
    query: Map<String, String> = emptyMap(),
    body: JSONObject? = null,
    auth: AuthMode = AuthMode.Required,
  ) = runBlocking { request(method, path, query, body, auth) { it } }

  @Test
  fun `attaches the credential and the app version to an authenticated call`() {
    val transport = FakeTransport(ok())
    api(transport).text(query = mapOf("radiusMeters" to "5000"))

    val request = transport.requests.single()
    assertEquals("https://api.vescape.app/map-points?radiusMeters=5000", request.url)
    assertEquals("Bearer device-token", request.headers["Authorization"])
    assertEquals("0.81.3", request.headers["Vescape-App-Version"])
  }

  @Test
  fun `refuses a required call with no stored credential without reaching the network`() {
    val transport = FakeTransport(ok())
    val result = api(transport, stored = null).text()

    assertEquals(ApiResult.Unauthorized, result)
    assertTrue(transport.requests.isEmpty())
  }

  @Test
  fun `sends an optional call anonymously when no credential is stored`() {
    val transport = FakeTransport(ok())
    api(transport, stored = null).text(auth = AuthMode.Optional)

    assertNull(transport.requests.single().headers["Authorization"])
  }

  @Test
  fun `matches the credential origin whatever the trailing slash`() {
    val transport = FakeTransport(ok())
    api(transport, baseUrl = "https://api.vescape.app/").text()

    assertEquals("Bearer device-token", transport.requests.single().headers["Authorization"])
    assertEquals("https://api.vescape.app/map-points", transport.requests.single().url)
  }

  /** A credential minted against another origin belongs to another environment. */
  @Test
  fun `ignores a credential stored for a different origin`() {
    val transport = FakeTransport(ok())
    val result = api(transport, baseUrl = "http://10.0.2.2:3000").text()

    assertEquals(ApiResult.Unauthorized, result)
    assertTrue(transport.requests.isEmpty())
  }

  @Test
  fun `rejects the stored credential once on an authenticated 401`() {
    val transport = FakeTransport(status(401))
    val result = api(transport).text()

    assertEquals(ApiResult.Unauthorized, result)
    assertEquals(1, rejections)
    assertEquals(1, transport.requests.size)
  }

  /** An anonymous read cannot say anything about a credential it never sent. */
  @Test
  fun `keeps the stored credential when an anonymous call answers 401`() {
    val transport = FakeTransport(status(401))
    api(transport, stored = null).text(auth = AuthMode.Optional)

    assertEquals(0, rejections)
  }

  @Test
  fun `explicit bearer unauthorized does not reject the stored credential`() {
    val result = api(FakeTransport(status(401))).text(auth = AuthMode.Bearer("candidate-token"))

    assertEquals(ApiResult.Unauthorized, result)
    assertEquals(0, rejections)
  }

  @Test(expected = CancellationException::class)
  fun `cancellation stops without retry`() {
    val transport = FakeTransport({ throw CancellationException("cancelled") })

    api(transport).text()
  }

  @Test fun `cancellation while transport is pending ignores a later unauthorized response`() = runBlocking {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val transport = object : ApiTransport {
      override fun execute(request: ApiRequest): ApiResponse {
        entered.countDown()
        release.await()
        return ApiResponse(401, "")
      }
    }
    val call = async(Dispatchers.Default) { api(transport).request(HttpMethod.GET, "/map-points") { it } }
    entered.await()
    call.cancel()
    release.countDown()

    assertThrows(CancellationException::class.java) { runBlocking { call.await() } }
    assertEquals(0, rejections)
  }

  @Test
  fun `maps refusal statuses to their own outcomes`() {
    assertEquals(ApiResult.Forbidden, api(FakeTransport(status(403))).text())
    assertEquals(ApiResult.NotFound, api(FakeTransport(status(404))).text())
    assertEquals(
      ApiResult.Invalid("invalid-request"),
      api(FakeTransport(status(400, """{"error":"invalid-request"}"""))).text(),
    )
  }

  @Test
  fun `reports a response it cannot parse as malformed`() {
    val transport = FakeTransport(ok("not json"))
    val result = runBlocking {
      api(transport).request(HttpMethod.GET, "/map-points") { JSONObject(it).getString("id") }
    }

    assertTrue(result is ApiResult.Malformed)
  }

  @Test
  fun `retries an idempotent call once before giving up`() {
    val transport = FakeTransport(offline(), ok())
    val result = api(transport).text()

    assertEquals(ApiResult.Ok("{}"), result)
    assertEquals(2, transport.requests.size)
  }

  @Test
  fun `never repeats a create`() {
    val transport = FakeTransport(offline())
    val result = api(transport).text(method = HttpMethod.POST, body = JSONObject())

    assertTrue(result is ApiResult.Unavailable)
    assertEquals(1, transport.requests.size)
  }

  @Test
  fun `treats a server fault as retryable and then unavailable`() {
    val transport = FakeTransport(status(503))
    val result = api(transport).text()

    assertEquals(ApiResult.Unavailable("Server error (503)"), result)
    assertEquals(2, transport.requests.size)
  }

  @Test
  fun `sends a JSON body with its content type`() {
    val transport = FakeTransport(ok())
    api(transport).text(method = HttpMethod.POST, body = JSONObject().put("category", "drop"))

    val request = transport.requests.single()
    assertEquals(HttpMethod.POST, request.method)
    assertEquals("application/json", request.headers["Content-Type"])
    assertEquals("""{"category":"drop"}""", request.body)
  }
}
