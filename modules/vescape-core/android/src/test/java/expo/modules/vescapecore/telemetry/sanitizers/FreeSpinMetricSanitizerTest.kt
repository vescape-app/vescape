package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.SanitizationResult
import expo.modules.vescapecore.telemetry.sanitizeTelemetrySamples
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/FreeSpinTests.swift */
class FreeSpinMetricSanitizerTest {
  /** A wheel in the air: 20 → 40 km/h in half a second on a few amps. */
  private val spinUp = listOf(sample(0, 20.0, 10.0), sample(500, 40.0, 5.0))

  @Test
  fun spinUpOnLittleCurrentIsExcludedFromEverySpeedMetric() {
    val result = sanitize(spinUp)

    assertEquals(listOf(false, true), result.freeSpin())
    val spin = result.samples[1]
    assertTrue(spin.excludedFromAvgSpeed && spin.excludedFromMaxSpeed && spin.excludedFromMaxDuty)
    val range = result.exclusions.single { it.reason == EXCLUSION_REASON_FREE_SPIN }
    assertEquals(500L, range.startMs)
  }

  @Test
  fun theSameClimbWithARiderOnBoardIsKept() {
    val result = sanitize(listOf(sample(0, 20.0, 100.0), sample(500, 40.0, 120.0)))

    assertEquals(listOf(false, false), result.freeSpin())
  }

  @Test
  fun spinUpWhileRidingBackwardsIsExcluded() {
    val result = sanitize(listOf(sample(0, -20.0, -10.0), sample(500, -40.0, -5.0)))

    assertEquals(listOf(false, true), result.freeSpin())
  }

  @Test
  fun samplesTooFarApartAreNotReadAsAClimb() {
    val result = sanitize(listOf(sample(0, 20.0, 5.0), sample(1_600, 45.0, 5.0)))

    assertEquals(listOf(false, false), result.freeSpin())
  }

  @Test
  fun steadySpinningAfterASpinUpStaysExcludedUntilThreeLoadedSamples() {
    val result = sanitize(
      spinUp + listOf(
        sample(1_000, 40.0, 10.0),
        sample(1_500, 40.0, 10.0),
        // Landed: braking that takes a rider's worth of current.
        sample(2_000, 38.0, -60.0),
        sample(2_500, 36.0, -60.0),
        sample(3_000, 34.0, -60.0),
        sample(3_500, 34.0, 10.0),
      ),
    )

    assertEquals(listOf(false, true, true, true, true, true, false, false), result.freeSpin())
  }

  @Test
  fun oneLoadedLookingSampleDoesNotEndTheSpin() {
    val result = sanitize(
      spinUp + listOf(
        sample(1_000, 38.0, -60.0),
        sample(1_500, 38.0, 10.0),
        sample(2_000, 36.0, -60.0),
      ),
    )

    assertEquals(listOf(false, true, true, true, true), result.freeSpin())
  }

  @Test
  fun spinEndsWhenSpeedReturnsToWhereItStarted() {
    val result = sanitize(spinUp + listOf(sample(1_000, 30.0, 0.0), sample(1_500, 24.0, 0.0)))

    assertEquals(listOf(false, true, true, false), result.freeSpin())
  }

  @Test
  fun spinTimesOutAfterFifteenSecondsWhileTheMotorWorks() {
    val result = sanitize(spinUp + (1..17).map { sample(500L + it * 1_000L, 40.0, 10.0) })

    assertTrue(result.freeSpin().subList(1, 16).all { it })
    assertEquals(listOf(false, false), result.freeSpin().takeLast(2))
  }

  @Test
  fun wheelHeldAtTheSpeedLimitInTheAirStaysExcludedPastTheTimeout() {
    val result = sanitize(spinUp + (1..30).map { sample(500L + it * 1_000L, 40.0, 1.0) })

    assertTrue(result.freeSpin().drop(1).all { it })
  }

  @Test
  fun aSpinCrossingTwoBatchesStaysExcluded() {
    val first = sanitize(spinUp)
    val second = sanitizeTelemetrySamples(
      listOf(sample(1_000, 40.0, 10.0), sample(1_500, 40.0, 10.0)),
      freeSpinCarry = first.freeSpinCarry,
    )

    assertEquals(listOf(true, true), second.freeSpin())
  }

  @Test
  fun boardsAreReadSeparately() {
    val result = sanitize(
      listOf(
        sample(0, 20.0, 10.0, board = "a"),
        sample(250, 0.0, 0.0, board = "b"),
        sample(500, 40.0, 5.0, board = "a"),
        sample(750, 0.0, 0.0, board = "b"),
      ),
    )

    assertEquals(listOf(false, false, true, false), result.freeSpin())
  }

  private fun sanitize(samples: List<BucketTelemetryPoint>) = sanitizeTelemetrySamples(samples)

  private fun SanitizationResult.freeSpin() = samples.map { it.excludedFromMaxSpeed }

  private fun sample(atMs: Long, speedKmh: Double, motorCurrentA: Double, board: String = "board-1") =
    BucketTelemetryPoint(
      capturedAtMs = atMs,
      boardId = board,
      speedCentiKmh = (speedKmh * 100).toInt(),
      batteryVoltageMv = 80_000,
      motorCurrentMa = (motorCurrentA * 1_000).toInt(),
      batteryCurrentMa = 0,
      dutyPermille = 500,
      odometerCm = null,
    )
}
