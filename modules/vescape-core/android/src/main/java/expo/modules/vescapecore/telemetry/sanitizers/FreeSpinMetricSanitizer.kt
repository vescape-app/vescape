package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_ID
import kotlin.math.abs

/**
 * @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift `FreeSpinState`
 */
internal class FreeSpinMetricSanitizer(carry: FreeSpinCarry) : MetricSampleSanitizer {
  private val boards = carry.boards.toMutableMap()

  val carry: FreeSpinCarry get() = FreeSpinCarry(boards.toMap())

  override fun sanitize(point: BucketTelemetryPoint): MetricSanitizerOutput {
    val (state, freeSpin) = (boards[point.boardId] ?: FreeSpinState()).advance(point)
    boards[point.boardId] = state
    if (!freeSpin) return MetricSanitizerOutput()

    return MetricSanitizerOutput(
      excludedFromAvgSpeed = true,
      excludedFromMaxSpeed = true,
      excludedFromMaxDuty = true,
      exclusions = listOf(
        MetricExclusionSample(
          capturedAtMs = point.capturedAtMs,
          boardId = point.boardId ?: UNKNOWN_TELEMETRY_BOARD_ID,
          reason = EXCLUSION_REASON_FREE_SPIN,
        ),
      ),
    )
  }
}

internal data class FreeSpinCarry(val boards: Map<String?, FreeSpinState> = emptyMap())

internal data class FreeSpinState(
  val previous: BucketTelemetryPoint? = null,
  val latch: FreeSpinLatch? = null,
)

internal data class FreeSpinLatch(
  val startedAtMs: Long,
  val speedBeforeCentiKmh: Int,
  val loadedStreak: Int = 0,
)

private const val LOADED_EFFORT_A_PER_KMH_S = 6.5
private const val SPIN_MIN_ACCEL_KMH_S = 10.0
private const val SPIN_EFFORT_RATIO = 0.35
private const val LOADED_EFFORT_RATIO = 0.7
private const val LOADED_MIN_ACCEL_KMH_S = 2.0
private const val LOADED_STREAK_TO_RELEASE = 3
private const val RETURN_MARGIN_CENTI_KMH = 500
private const val LATCH_TIMEOUT_MS = 15_000L
private const val STUCK_CURRENT_A = 5.0
private const val PAIR_MIN_GAP_MS = 5L
private const val PAIR_MAX_GAP_MS = 1_500L

internal fun FreeSpinState.advance(point: BucketTelemetryPoint): Pair<FreeSpinState, Boolean> {
  val pair = previous?.let { SamplePair.of(it, point) }
  latch?.let { latch ->
    val streak = if (pair?.loaded == true) latch.loadedStreak + 1 else 0
    val returned = abs(point.speedCentiKmh) <= latch.speedBeforeCentiKmh + RETURN_MARGIN_CENTI_KMH
    val stuck = pair != null && abs(pair.currentA) < STUCK_CURRENT_A
    val timedOut = point.capturedAtMs - latch.startedAtMs > LATCH_TIMEOUT_MS && !stuck
    if (!returned && streak < LOADED_STREAK_TO_RELEASE && !timedOut) {
      return FreeSpinState(point, latch.copy(loadedStreak = streak)) to true
    }
  }
  if (pair?.spinUp == true) {
    return FreeSpinState(point, FreeSpinLatch(point.capturedAtMs, abs(previous!!.speedCentiKmh))) to true
  }
  return FreeSpinState(point) to false
}

private class SamplePair private constructor(
  val accelKmhS: Double,
  val currentA: Double,
) {
  val spinUp: Boolean
    get() = accelKmhS >= SPIN_MIN_ACCEL_KMH_S &&
      currentA < SPIN_EFFORT_RATIO * LOADED_EFFORT_A_PER_KMH_S * accelKmhS

  val loaded: Boolean
    get() = abs(accelKmhS) >= LOADED_MIN_ACCEL_KMH_S &&
      accelKmhS * currentA > 0 &&
      abs(currentA) >= LOADED_EFFORT_RATIO * LOADED_EFFORT_A_PER_KMH_S * abs(accelKmhS)

  companion object {
    fun of(previous: BucketTelemetryPoint, point: BucketTelemetryPoint): SamplePair? {
      val gapMs = point.capturedAtMs - previous.capturedAtMs
      if (gapMs < PAIR_MIN_GAP_MS || gapMs > PAIR_MAX_GAP_MS) return null
      val direction = if (point.speedCentiKmh >= 0) 1 else -1
      return SamplePair(
        accelKmhS = (abs(point.speedCentiKmh) - abs(previous.speedCentiKmh)) / 100.0 / (gapMs / 1_000.0),
        currentA = (previous.motorCurrentMa + point.motorCurrentMa) / 2.0 / 1_000.0 * direction,
      )
    }
  }
}
