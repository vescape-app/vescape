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

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 500)

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

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 300)

    assertFalse(result.samples[0].excludedFromAvgSpeed)
    assertTrue(result.samples[1].excludedFromAvgSpeed)
  }

  @Test
  fun producesExclusionRangesForExcludedSamples() {
    val points = listOf(
      point(capturedAtMs = 1000L, boardId = "board-1", speedCentiKmh = 100),
      point(capturedAtMs = 2000L, boardId = "board-1", speedCentiKmh = 500),
    )

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 300)

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

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 300)

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

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 300)

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

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[0].excludedFromAvgSpeed)
    assertFalse(result.samples[1].excludedFromAvgSpeed)
  }

  @Test
  fun handlesEmptyInput() {
    val result = sanitizeTelemetrySamples(emptyList())

    assertTrue(result.samples.isEmpty())
    assertTrue(result.exclusions.isEmpty())
  }

  @Test
  fun nullDeviceIdUsesUnknownPlaceholder() {
    val points = listOf(
      point(boardId = null, speedCentiKmh = 100),
    )

    val result = sanitizeTelemetrySamples(points, movingSpeedThresholdCentiKmh = 300)

    assertEquals(UNKNOWN_TELEMETRY_BOARD_ID, result.exclusions.single().boardId)
  }

  // --- Free-spin detection tests ---

  @Test
  fun freeSpinDetectedWhenLowGpsAndHighBoardSpeed() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1600,
        gpsSpeedCentiMps = 100, // 3.6 km/h < 7 km/h cutoff
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[0].excludedFromMaxSpeed)
    assertTrue(result.samples[0].excludedFromMaxDuty)
  }

  @Test
  fun noFreeSpinWhenLowGpsButBoardBelowCap() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1500, // exactly at cap, not above
        gpsSpeedCentiMps = 100, // 3.6 km/h
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertFalse(result.samples[0].excludedFromMaxSpeed)
    assertFalse(result.samples[0].excludedFromMaxDuty)
  }

  @Test
  fun freeSpinDetectedWhenDeltaExceedsThreshold() {
    // GPS speed = 25 km/h (694 centi m/s), board = 38 km/h -> delta = 13 > 12
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 3800,
        gpsSpeedCentiMps = 694, // ~25 km/h
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[0].excludedFromMaxSpeed)
    assertTrue(result.samples[0].excludedFromMaxDuty)
  }

  @Test
  fun noFreeSpinWhenDeltaAtThreshold() {
    // GPS speed = 694 centi m/s -> 2498 centi km/h; board = 3698 -> delta = 1200, not > 1200
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 3698,
        gpsSpeedCentiMps = 694,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertFalse(result.samples[0].excludedFromMaxSpeed)
    assertFalse(result.samples[0].excludedFromMaxDuty)
  }

  @Test
  fun noFreeSpinWhenNoGpsAvailable() {
    val points = listOf(
      point(speedCentiKmh = 5000),
    )

    val result = sanitizeTelemetrySamples(points)

    assertFalse(result.samples[0].excludedFromMaxSpeed)
    assertFalse(result.samples[0].excludedFromMaxDuty)
  }

  @Test
  fun noFreeSpinWhenGpsImprecise() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 5000,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
        gpsAccuracyCm = 2001, // above precision threshold
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertFalse(result.samples[0].excludedFromMaxSpeed)
  }

  @Test
  fun freeSpinUsesNearbyGpsWhenSampleHasNone() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1000,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
      point(speedCentiKmh = 5000, capturedAtMs = 3000L), // no own GPS
      pointWithGps(
        speedCentiKmh = 1000,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 5000L,
        gpsTimestampMs = 5000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[1].excludedFromMaxSpeed)
    assertTrue(result.samples[1].excludedFromMaxDuty)
  }

  @Test
  fun noFreeSpinWhenNearestGpsTooOld() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1000,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
      point(speedCentiKmh = 5000, capturedAtMs = 12_000L), // 11s gap, exceeds 10s max age
    )

    val result = sanitizeTelemetrySamples(points)

    assertFalse(result.samples[1].excludedFromMaxSpeed)
  }

  @Test
  fun freeSpinAtEdgeOfMaxAge() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1000,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
      point(speedCentiKmh = 5000, capturedAtMs = 11_000L), // exactly 10s gap
    )

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[1].excludedFromMaxSpeed)
  }

  @Test
  fun freeSpinProducesSingleReasonRange() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 5000,
        dutyPermille = 800,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
        boardId = "board-1",
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    val exclusion = result.exclusions.single()
    assertEquals(EXCLUSION_REASON_FREE_SPIN, exclusion.reason)
    assertEquals(1000L, exclusion.startMs)
    assertEquals(1000L, exclusion.endMs)
    assertEquals("board-1", exclusion.boardId)
    assertEquals(1, exclusion.sampleCount)
  }

  @Test
  fun lowGpsCutoffBoundary() {
    // GPS at exactly 7 km/h (194 centi m/s -> 194*36/10 = 698 centi km/h ~ 6.98 km/h)
    // 194 * 36 / 10 = 698 which is < 700, so LOW GPS path
    // Board at 16 km/h (1600) > 15 km/h cap -> excluded
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 1600,
        gpsSpeedCentiMps = 194, // 6.98 km/h < 7 -> low GPS path
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )
    val result = sanitizeTelemetrySamples(points)
    assertTrue(result.samples[0].excludedFromMaxSpeed)

    // GPS at exactly 7 km/h boundary (195 centi m/s -> 195*36/10 = 702 centi km/h >= 700)
    // Uses delta path: board 16 - gps 7.02 = 8.98 km/h delta < 12 -> not excluded
    val points2 = listOf(
      pointWithGps(
        speedCentiKmh = 1600,
        gpsSpeedCentiMps = 195,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
    )
    val result2 = sanitizeTelemetrySamples(points2)
    assertFalse(result2.samples[0].excludedFromMaxSpeed)
  }

  @Test
  fun dutyCoupledToSpeedExclusion() {
    val points = listOf(
      pointWithGps(
        speedCentiKmh = 5000,
        dutyPermille = 950,
        gpsSpeedCentiMps = 100,
        capturedAtMs = 1000L,
        gpsTimestampMs = 1000L,
      ),
      pointWithGps(
        speedCentiKmh = 2500,
        dutyPermille = 950,
        gpsSpeedCentiMps = 694, // 25 km/h, delta only 0 -> not free spin
        capturedAtMs = 2000L,
        gpsTimestampMs = 2000L,
      ),
    )

    val result = sanitizeTelemetrySamples(points)

    assertTrue(result.samples[0].excludedFromMaxDuty)
    assertFalse(result.samples[1].excludedFromMaxDuty)
  }

  private fun point(
    capturedAtMs: Long = 0L,
    boardId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = boardId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = dutyPermille,
    odometerCm = null,
  )

  private fun pointWithGps(
    capturedAtMs: Long = 0L,
    boardId: String? = "board-1",
    speedCentiKmh: Int = 0,
    dutyPermille: Int = 0,
    gpsSpeedCentiMps: Int,
    gpsTimestampMs: Long,
    gpsAccuracyCm: Int = 500,
  ) = BucketTelemetryPoint(
    capturedAtMs = capturedAtMs,
    boardId = boardId,
    speedCentiKmh = speedCentiKmh,
    batteryVoltageMv = 70_000,
    motorCurrentMa = 0,
    batteryCurrentMa = 0,
    dutyPermille = dutyPermille,
    odometerCm = null,
    gpsSpeedCentiMps = gpsSpeedCentiMps,
    gpsTimestampMs = gpsTimestampMs,
    gpsAccuracyCm = gpsAccuracyCm,
  )
}
