package expo.modules.vescapecore.telemetry.sanitizers

import expo.modules.vescapecore.telemetry.BucketTelemetryPoint
import expo.modules.vescapecore.telemetry.EXCLUSION_REASON_FREE_SPIN
import expo.modules.vescapecore.telemetry.UNKNOWN_TELEMETRY_BOARD_ID
import kotlin.math.abs

/**
 * Free spin from Board telemetry alone: speeding up a loaded wheel takes a rider's worth of motor
 * current, a wheel in the air spins up on almost none. A fast climb on little current starts a
 * spin, and a latch keeps excluding the steady spinning after it, which looks like cruising.
 *
 * Every value is fixed: per-Board calibration changed no Max Speed on the test rides (#629).
 *
 * @parity /modules/vescape-core/ios/telemetry/MetricSanitizer.swift `FreeSpinState`
 */
internal class FreeSpinMetricSanitizer(carry: FreeSpinCarry) : MetricSampleSanitizer {
  private val boards = carry.boards.toMutableMap()

  /** Each Board's state after the last sample, for the batch that continues this one. */
  val carry: FreeSpinCarry get() = FreeSpinCarry(boards.toMap())

  override fun sanitize(point: BucketTelemetryPoint): MetricSanitizerOutput {
    val (state, freeSpin) = (boards[point.boardId] ?: FreeSpinState()).advance(point)
    boards[point.boardId] = state
    if (!freeSpin) return MetricSanitizerOutput()

    // A spinning wheel is not riding, so it counts toward no speed metric (ADR 0017).
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

/**
 * Each Board's free-spin state where one sanitized batch ends. A batch that continues the same
 * samples (the next recording flush, the next rebuilt hour) starts from it, so a spin crossing the
 * edge stays excluded.
 */
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

/** Motor current a loaded Board needs per km/h/s of acceleration; measured 5.3–8.6 across Boards. */
private const val LOADED_EFFORT_A_PER_KMH_S = 6.5
/** Faster than a rider accelerates; a steep downhill gives about 3–4 km/h/s. */
private const val SPIN_MIN_ACCEL_KMH_S = 10.0
/** A spin-up draws less than this share of the loaded effort. */
private const val SPIN_EFFORT_RATIO = 0.35
/** A speed change drawing at least this share of the loaded effort carries a rider. */
private const val LOADED_EFFORT_RATIO = 0.7
private const val LOADED_MIN_ACCEL_KMH_S = 2.0
/** One loaded-looking sample is not enough: Refloat's balancing spikes current mid-spin. */
private const val LOADED_STREAK_TO_RELEASE = 3
private const val RETURN_MARGIN_CENTI_KMH = 500
private const val LATCH_TIMEOUT_MS = 15_000L
/** A wheel held at the firmware speed limit in the air draws almost nothing; keep the latch on. */
private const val STUCK_CURRENT_A = 5.0
private const val PAIR_MIN_GAP_MS = 5L
private const val PAIR_MAX_GAP_MS = 1_500L

/** Advance one Board's state by [point]; the flag is whether [point] is free spin. */
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

/** Two consecutive samples close enough to read an acceleration from; null when they are not. */
private class SamplePair private constructor(
  /** Change in absolute speed, km/h per second. */
  val accelKmhS: Double,
  /** Mean motor current, A, positive when pushing in the direction of travel. */
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
