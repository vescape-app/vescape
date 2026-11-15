package expo.modules.vescapecore.riderprofiles

import expo.modules.vescapecore.api.ApiRequest
import expo.modules.vescapecore.api.ApiResponse
import expo.modules.vescapecore.api.ApiTransport
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.auth.DeviceCredential
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Test

/** @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApiTests.swift */
class RiderProfileApiTest {
  private val profile = """{"accountId":"rider","nick":"Ada","nationality":null}"""
  private val stats = """{"distanceM":null,"rideCount":3,"rideTimeMs":120000,"topSpeedKmh":28,"avgSpeedKmh":17,"longestRideM":null,"batteryUsedWh":42,"batteryRegenWh":null}"""

  private fun api(body: String, status: Int = 200) = RiderProfileApi(VescapeApi(
    baseUrl = "https://api.vescape.app",
    appVersion = "1",
    credentialProvider = { DeviceCredential("https://api.vescape.app", "token", "viewer", null) },
    transport = object : ApiTransport {
      override fun execute(request: ApiRequest) = ApiResponse(status, body)
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
}
