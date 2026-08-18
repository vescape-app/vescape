package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BoardLinkPersistenceTest {
  private fun roundTrip(link: Map<String, Any?>): Map<*, *>? {
    val board = mapOf(
      "id" to "b1",
      "name" to "Board",
      "createdAt" to 0L,
      "link" to link,
    )
    val (settings, _) = board.toBoardSettingEntities("b1")
    return board.toBoardEntity().toMap(settings)["link"] as? Map<*, *>
  }

  @Test
  fun hasBmsSurvivesRoundTrip() {
    val link = roundTrip(mapOf("bleId" to "AA:BB", "transport" to 84, "linkVersion" to 4, "hasBms" to true))

    assertNotNull(link)
    assertEquals("AA:BB", link?.get("bleId"))
    assertEquals(4, link?.get("linkVersion"))
    assertEquals(true, link?.get("hasBms"))
  }

  @Test
  fun hasBmsFalseSurvivesRoundTrip() {
    val link = roundTrip(mapOf("bleId" to "AA:BB", "transport" to 84, "linkVersion" to 4, "hasBms" to false))

    assertEquals(false, link?.get("hasBms"))
  }

  @Test
  fun legacyLinkWithoutHasBmsSurvivesRoundTrip() {
    val link = roundTrip(mapOf("bleId" to "AA:BB", "transport" to 84))

    assertNotNull(link)
    assertNull(link?.get("hasBms"))
  }

  @Test
  fun v3IdentityFieldsSurviveRoundTrip() {
    val link = roundTrip(mapOf(
      "bleId" to "AA:BB",
      "transport" to "direct",
      "linkVersion" to 4,
      "hasBms" to true,
      "vescFirmwareVersion" to "FW 6.05",
      "refloatVersion" to "2.1.0",
      "refloatBaseVersion" to "1.4.0",
      "futureField" to "ignored",
    ))

    assertEquals(4, link?.get("linkVersion"))
    assertEquals("direct", link?.get("transport"))
    assertEquals(true, link?.get("hasBms"))
    assertEquals("FW 6.05", link?.get("vescFirmwareVersion"))
    assertEquals("2.1.0", link?.get("refloatVersion"))
    assertEquals("1.4.0", link?.get("refloatBaseVersion"))
    assertNull(link?.get("futureField"))
  }

  @Test
  fun malformedLinkIsIgnored() {
    assertNull(roundTrip(mapOf("bleId" to "", "transport" to 84)))
    assertNull(roundTrip(mapOf("bleId" to "AA:BB", "transport" to 999)))
  }
}
