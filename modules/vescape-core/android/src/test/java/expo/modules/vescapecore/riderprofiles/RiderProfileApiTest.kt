package expo.modules.vescapecore.riderprofiles

import expo.modules.vescapecore.api.ApiRequest
import expo.modules.vescapecore.api.ApiResponse
import expo.modules.vescapecore.api.ApiTransport
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.auth.DeviceCredential
import kotlinx.coroutines.runBlocking
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Test

/** @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApiTests.swift */
class RiderProfileApiTest {
  private val profile = """{"accountId":"rider","nick":"Ada","nationality":null}"""
  private val stats = """{"distanceM":null,"rideCount":3,"rideTimeMs":120000,"topSpeedKmh":28,"avgSpeedKmh":17,"longestRideM":null,"batteryUsedWh":42,"batteryRegenWh":null}"""

  private fun api(body: String, status: Int = 200, inspect: (ApiRequest) -> Unit = {}) = RiderProfileApi(VescapeApi(
    baseUrl = "https://api.vescape.app",
    appVersion = "1",
    credentialProvider = { DeviceCredential("https://api.vescape.app", "token", "viewer", null) },
    transport = object : ApiTransport {
      override fun execute(request: ApiRequest): ApiResponse {
        inspect(request)
        return ApiResponse(status, body)
      }
    },
  ))

  @Test fun `detail keeps totals months and nullable metrics while search stays a profile`() = runBlocking {
    val month = stats.dropLast(1) + """, "month":"2026-01"}"""
    val detail = api(profile.dropLast(1) + """, "stats":{"total":$stats,"months":[$month]}}""").rider("rider")!!
    assertEquals("Ada", detail["nick"])
    val detailStats = detail["stats"] as Map<*, *>
    val total = detailStats["total"] as Map<*, *>
    assertEquals(3, total["rideCount"])
    assertEquals(42.0, total["batteryUsedWh"])
    assertNull(total["distanceM"])
    val months = detailStats["months"] as List<*>
    assertEquals("2026-01", (months.single() as Map<*, *>)["month"])
    val found = api("""{"items":[$profile]}""").search("Ada").single()
    assertFalse(found.containsKey("stats"))
  }

  @Test fun `missing rider and absent stats totals stay nullable`() = runBlocking {
    assertNull(api("", 404).rider("rider"))
    val detail = api(profile.dropLast(1) + """, "stats":{"total":null,"months":[]}}""").rider("rider")!!
    val detailStats = detail["stats"] as Map<*, *>
    assertNull(detailStats["total"])
    assertEquals(emptyList<Any>(), detailStats["months"])
  }

  @Test fun `friend rides pages send limit and cursor`() = runBlocking {
    val cursor = "2026-01-01T00:00:00Z"
    val first = api("""{"rides":[{"startedAt":"$cursor","endedAt":"2026-01-01T00:01:00Z"}],"nextBefore":"$cursor"}""") {
      assertEquals("https://api.vescape.app/api/friends/rider/rides?limit=5", it.url)
    }.friendRides("rider", limit = 5)
    assertEquals(cursor, ((first["rides"] as List<*>).single() as Map<*, *>)["startedAt"])
    assertEquals(cursor, first["nextBefore"])

    val last = api("""{"rides":[],"nextBefore":null}""") {
      assertTrue(URI(it.url).query.split("&").contains("before=$cursor"))
    }.friendRides("rider", limit = 5, before = first["nextBefore"] as? String)
    assertTrue(last.containsKey("nextBefore"))
    assertNull(last["nextBefore"])
  }
}
