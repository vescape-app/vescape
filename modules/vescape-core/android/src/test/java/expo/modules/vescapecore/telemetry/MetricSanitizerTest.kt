package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MetricSanitizerTest {
  @Test
  fun excludesSamplesBelowSpeedThreshold() {
    val points = listOf(
      point(speedCentiKmh = 200),
      point(speedCentiKmh = 500),
      point(speedCentiKmh = 1_200),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 500)

    assertTrue(result.samples[0].excludedFromAvgSpeed)
    assertFalse(result.samples[1].excludedFromAvgSpeed)
    assertFalse(result.samples[2].excludedFromAvgSpeed)
  }

  @Test
  fun usesAbsoluteSpeedForThresholdComparison() {
    val points = listOf(
      point(speedCentiKmh = -600),
      point(speedCentiKmh = -200),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 300)

    assertFalse(result.samples[0].excludedFromAvgSpeed)
    assertTrue(result.samples[1].excludedFromAvgSpeed)
  }

  @Test
  fun producesExclusionRangesForExcludedSamples() {
    val points = listOf(
      point(capturedAtMs = 1000L, boardId = "board-1", speedCentiKmh = 100),
      point(capturedAtMs = 2000L, boardId = "board-1", speedCentiKmh = 500),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 300)

    assertEquals(1, result.exclusions.size)
    val exclusion = result.exclusions.single()
    assertEquals(1000L, exclusion.startMs)
    assertEquals(1000L, exclusion.endMs)
    assertEquals("board-1", exclusion.boardId)
    assertEquals(EXCLUSION_REASON_LOW_SPEED, exclusion.reason)
    assertEquals(1, exclusion.sampleCount)
  }

  @Test
  fun noExclusionsWhenAllSamplesAboveThreshold() {
    val points = listOf(
      point(speedCentiKmh = 500),
      point(speedCentiKmh = 1_000),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 300)

    assertTrue(result.exclusions.isEmpty())
    assertFalse(result.samples[0].excludedFromAvgSpeed)
    assertFalse(result.samples[1].excludedFromAvgSpeed)
  }

  @Test
  fun allExcludedWhenAllBelowThreshold() {
    val points = listOf(
      point(speedCentiKmh = 100),
      point(speedCentiKmh = 200),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 300)

    assertEquals(1, result.exclusions.size)
    assertEquals(2, result.exclusions.single().sampleCount)
    assertTrue(result.samples.all { it.excludedFromAvgSpeed })
  }

  @Test
  fun usesDefaultThresholdWhenNotSpecified() {
    val points = listOf(
      point(speedCentiKmh = 250),
      point(speedCentiKmh = 350),
    )

    val result = sanitize(points)

    assertTrue(result.samples[0].excludedFromAvgSpeed)
    assertFalse(result.samples[1].excludedFromAvgSpeed)
  }

  @Test
  fun handlesEmptyInput() {
    val result = sanitize(emptyList())

    assertTrue(result.samples.isEmpty())
    assertTrue(result.exclusions.isEmpty())
  }

  @Test
  fun nullDeviceIdUsesUnknownPlaceholder() {
    val points = listOf(
      point(boardId = null, speedCentiKmh = 100),
    )

    val result = sanitize(points, movingSpeedThresholdCentiKmh = 300)

    assertEquals(UNKNOWN_TELEMETRY_BOARD_ID, result.exclusions.single().boardId)
  }

  private fun sanitize(
    points: List<BucketTelemetryPoint>,
    movingSpeedThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
  ): SanitizationResult = sanitizeTelemetrySamples(points, MetricSanitizerConfig(movingSpeedThresholdCentiKmh))

  private fun point(
    capturedAtMs: Long = 0L,
    boardId: String? = "board-1",
    speedCentiKmh: Int = 0,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = boardId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = 0,
    odometerCm = null,
  )
}
