package app.vescape.wear

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

// @parity /modules/vescape-core/ios/watch/WatchTiltStick.swift

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `REMOTE_TILT_CENTER`
 */
const val TILT_CENTER = 128
private const val TILT_HALF_RANGE = 255 - TILT_CENTER

fun tiltPercent(value: Int): Float = (value - TILT_CENTER) * 100f / TILT_HALF_RANGE

fun tiltValue(percent: Float): Int =
    (TILT_CENTER + percent.coerceIn(-100f, 100f) / 100f * TILT_HALF_RANGE).roundToInt().coerceIn(0, 255)

fun stickRatePercentPerSecond(deflectionPx: Float, deadzonePx: Float, fullPx: Float, ratePercent: Int): Float {
    val magnitude = abs(deflectionPx)
    if (magnitude <= deadzonePx) return 0f
    val fraction = ((magnitude - deadzonePx) / (fullPx - deadzonePx)).coerceIn(0f, 1f)
    return sign(deflectionPx) * ratePercent * fraction * fraction
}

fun integrateTilt(percent: Float, ratePercentPerSecond: Float, elapsedMs: Long): Float =
    (percent + ratePercentPerSecond * elapsedMs.coerceIn(0L, MAX_STEP_MS) / 1000f).coerceIn(-100f, 100f)

private const val MAX_STEP_MS = 50L

fun formatTilt(percent: Float): String {
    val rounded = percent.roundToInt()
    return if (rounded > 0) "+$rounded%" else "$rounded%"
}
