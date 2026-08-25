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
    assertNull(link?.get("linkVersion"))
  }

  // A link stored by an older app version must keep reading as legacy. Defaulting an absent or
  // outdated stored version to the current one would launder a stale link into a trusted one and
  // silently skip the re-probe.
  @Test
  fun storedOutdatedLinkVersionReadsAsLegacy() {
    val board = mapOf("id" to "b1", "name" to "Board", "createdAt" to 0L)
    val stored = listOf(
      BoardSettingEntity("b1", "transport", "\"84\"", 0L),
      BoardSettingEntity("b1", "linkVersion", "3", 0L),
      BoardSettingEntity("b1", "hasBms", "true", 0L),
    )
    val link = board.toBoardEntity().copy(bleId = "AA:BB").toMap(stored)["link"] as? Map<*, *>

    assertNotNull(link)
    assertNull(link?.get("linkVersion"))
  }

  @Test
  fun storedLinkWithoutVersionReadsAsLegacy() {
    val board = mapOf("id" to "b1", "name" to "Board", "createdAt" to 0L)
    val stored = listOf(
      BoardSettingEntity("b1", "transport", "\"84\"", 0L),
      BoardSettingEntity("b1", "hasBms", "true", 0L),
    )
    val link = board.toBoardEntity().copy(bleId = "AA:BB").toMap(stored)["link"] as? Map<*, *>

    assertNotNull(link)
    assertNull(link?.get("linkVersion"))
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
