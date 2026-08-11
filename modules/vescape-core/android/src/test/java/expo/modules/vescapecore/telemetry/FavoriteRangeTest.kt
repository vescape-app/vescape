package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FavoriteRangeTest {
  @Test
  fun `favorite range requires valid bridge bounds`() {
    assertNull(favoriteRange(emptyMap()))
    assertNull(favoriteRange(mapOf("startMs" to 2_000, "endMs" to 1_000)))
    assertEquals(
      TelemetryTimeRange(1_000, 2_000),
      favoriteRange(mapOf("startMs" to 1_000, "endMs" to 2_000)),
    )
  }
}
