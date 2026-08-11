package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Test

class TelemetryRangeSubtractionTest {
  private val requested = TelemetryTimeRange(100, 200)

  @Test
  fun `favorite protection expands to every touched bucket`() {
    assertEquals(
      TelemetryTimeRange(60_000, 179_999),
      expandTelemetryRangeToBuckets(
        TelemetryTimeRange(75_000, 120_000),
        bucketSizeMs = 60_000,
      ),
    )
  }

  @Test
  fun `full overlap leaves nothing deletable`() {
    assertEquals(
      emptyList<TelemetryTimeRange>(),
      subtractProtectedTelemetryRanges(requested, listOf(TelemetryTimeRange(50, 250))),
    )
  }

  @Test
  fun `partial overlap carves each edge`() {
    assertEquals(
      listOf(TelemetryTimeRange(151, 200)),
      subtractProtectedTelemetryRanges(requested, listOf(TelemetryTimeRange(50, 150))),
    )
    assertEquals(
      listOf(TelemetryTimeRange(100, 149)),
      subtractProtectedTelemetryRanges(requested, listOf(TelemetryTimeRange(150, 250))),
    )
  }

  @Test
  fun `multiple overlapping favorites merge before subtraction`() {
    assertEquals(
      listOf(TelemetryTimeRange(100, 119), TelemetryTimeRange(181, 200)),
      subtractProtectedTelemetryRanges(
        requested,
        listOf(
          TelemetryTimeRange(120, 160),
          TelemetryTimeRange(140, 180),
        ),
      ),
    )
  }

  @Test
  fun `one favorite stays protected across separate delete requests`() {
    val favorite = listOf(TelemetryTimeRange(120, 180))
    assertEquals(
      listOf(TelemetryTimeRange(100, 119)),
      subtractProtectedTelemetryRanges(TelemetryTimeRange(100, 150), favorite),
    )
    assertEquals(
      listOf(TelemetryTimeRange(181, 200)),
      subtractProtectedTelemetryRanges(TelemetryTimeRange(151, 200), favorite),
    )
  }

  @Test
  fun `adjacent disjoint favorite does not affect deletion`() {
    assertEquals(
      listOf(requested),
      subtractProtectedTelemetryRanges(requested, listOf(TelemetryTimeRange(201, 250))),
    )
  }
}
