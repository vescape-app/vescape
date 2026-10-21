package app.vescape.wear

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

// @parity /modules/vescape-core/ios/watch/WatchTiltStick.swift

/**
 * Remote Tilt neutral on the Refloat 0..255 scale.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `REMOTE_TILT_CENTER`
 */
const val TILT_CENTER = 128
private const val TILT_HALF_RANGE = 255 - TILT_CENTER

/** Signed percent of full tilt, the same scale the phone pad labels: +100 is 255, 0 is neutral. */
fun tiltPercent(value: Int): Float = (value - TILT_CENTER) * 100f / TILT_HALF_RANGE

/** The wire value for [percent], clamped to the range the stick can reach. */
fun tiltValue(percent: Float): Int =
    (TILT_CENTER + percent.coerceIn(-100f, 100f) / 100f * TILT_HALF_RANGE).roundToInt().coerceIn(0, 255)

/**
 * A drone-style rate stick: deflection sets how fast tilt changes, not what it is. Letting go stops
 * the change and leaves the value where it is.
 *
 * Nothing moves inside [deadzonePx], so a thumb resting on the glass does not creep. Past it the
 * rate rises with the square of the deflection — fine trims near the middle, the full [ratePercent]
 * per second at [fullPx] and beyond.
 */
fun stickRatePercentPerSecond(deflectionPx: Float, deadzonePx: Float, fullPx: Float, ratePercent: Int): Float {
    val magnitude = abs(deflectionPx)
    if (magnitude <= deadzonePx) return 0f
    val fraction = ((magnitude - deadzonePx) / (fullPx - deadzonePx)).coerceIn(0f, 1f)
    return sign(deflectionPx) * ratePercent * fraction * fraction
}

/**
 * Advance [percent] by [ratePercentPerSecond] over [elapsedMs], held inside full tilt either way.
 *
 * One step never covers more than [MAX_STEP_MS]: a frame clock that stalls under a held thumb (a GC
 * pause, a paused activity) must not turn into one full-range jump sent as an absolute lock.
 */
fun integrateTilt(percent: Float, ratePercentPerSecond: Float, elapsedMs: Long): Float =
    (percent + ratePercentPerSecond * elapsedMs.coerceIn(0L, MAX_STEP_MS) / 1000f).coerceIn(-100f, 100f)

private const val MAX_STEP_MS = 50L

/** Signed whole percent as the Tilt page and the gauges badge print it: `+12%`, `0%`, `-4%`. */
fun formatTilt(percent: Float): String {
    val rounded = percent.roundToInt()
    return if (rounded > 0) "+$rounded%" else "$rounded%"
}
