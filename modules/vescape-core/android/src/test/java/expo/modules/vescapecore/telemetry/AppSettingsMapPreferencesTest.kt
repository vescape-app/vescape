package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppSettingsMapPreferencesTest {
  @Test
  fun liveHistoryLimitValidationAcceptsAndClampsNumericMinutes() {
    assertEquals(5, validLiveHistoryLimitMinutes(5))
    assertEquals(1, validLiveHistoryLimitMinutes(-1))
    assertEquals(50, validLiveHistoryLimitMinutes(120))
    assertNull(validLiveHistoryLimitMinutes("5"))
  }

  @Test
  fun mapStyleValidationAcceptsSupportedBasemapsOnly() {
    assertEquals("onedark", validMapStyleKey("onedark"))
    assertEquals("outdoors", validMapStyleKey("outdoors"))
    assertEquals("satellite", validMapStyleKey("satellite"))
    assertEquals("mapy", validMapStyleKey("mapy"))
    assertNull(validMapStyleKey("invalid"))
    assertNull(validMapStyleKey(1))
  }

  @Test
  fun navigationValidationAcceptsSupportedModesOnly() {
    assertEquals("northUp", validMapOrientationMode("northUp"))
    assertEquals("gpsHeading", validMapOrientationMode("gpsHeading"))
    assertEquals("phoneHeading", validMapOrientationMode("phoneHeading"))
    assertEquals("freeRotate", validMapOrientationMode("freeRotate"))
    assertNull(validMapOrientationMode("bearing"))
    assertNull(validMapOrientationMode(false))
  }

  @Test
  fun dismissedCommunityMessageIdsKeepsNonEmptyStringsAndDedupes() {
    assertEquals(listOf("a", "b"), validDismissedCommunityMessageIds(listOf("a", "b", "a")))
    assertEquals(listOf("a"), validDismissedCommunityMessageIds(listOf("a", "", 3, null)))
  }

  @Test
  fun dismissedCommunityMessageIdsDefaultsToEmptyForValidButEmptyAndRejectsNonLists() {
    // An empty or all-invalid list normalizes to [] (not null) so it is never flagged as corrupt.
    assertEquals(emptyList<String>(), validDismissedCommunityMessageIds(emptyList<Any?>()))
    assertEquals(emptyList<String>(), validDismissedCommunityMessageIds(listOf("", 1)))
    // A non-list is malformed input (null) and falls back to the default.
    assertNull(validDismissedCommunityMessageIds("a"))
    assertNull(validDismissedCommunityMessageIds(42))
  }
}
