package expo.modules.vescapecore.hardware

/**
 * The numeric half of a board reading: what a raw frame value means, and what may be drawn from
 * it. Labels, units and colors are the app's business and stay in JS; scale, range and
 * chartability are the contract with the firmware and are decided here, once, for both the live
 * numbers and the charts.
 *
 * @parity /src/modules/hardware/lib/sensorReadings.ts `READINGS`
 */
internal data class ReadingSpec(
    /** Raw frame units to display units. Both distance sensors are shown in cm. */
    val scale: Double = 1.0,
    /**
     * Display range. Values are clamped into it, the chart axis is fixed to it, and a sensor that
     * read nothing sits at its top: "no target" means "further than the range", not zero.
     */
    val min: Double? = null,
    val max: Double? = null,
    /** Whether this reading is worth a chart row, or is a number to glance at. */
    val chart: Boolean = false,
)

/** Useful reach for both distance sensors on a board. Anything past this is not a reading. */
private const val DISTANCE_MAX_CM = 40.0

private val SPECS = mapOf(
    "distanceMm" to ReadingSpec(scale = 0.1, min = 0.0, max = DISTANCE_MAX_CM, chart = true),
    "rangeCm" to ReadingSpec(min = 0.0, max = DISTANCE_MAX_CM, chart = true),
    "upMs" to ReadingSpec(scale = 0.001),
)

private val UNKNOWN = ReadingSpec()

/**
 * Readings the app knows a board can take, in the order they are shown.
 *
 * A ranged sensor is declared rather than discovered: "nothing in reach" is a reading, and the
 * firmware leaves the key out of the frame when it gets one. Waiting for a first echo before the
 * row exists means the row appears late, and everything under it jumps when it does.
 */
internal val DECLARED_KEYS: List<String> = SPECS.entries.filter { it.value.max != null }.map { it.key }

internal fun readingSpec(key: String): ReadingSpec = SPECS[key] ?: UNKNOWN

/**
 * A raw frame value in display units, clamped to the key's range, or null when the sensor read
 * nothing and has no ceiling to fall back on.
 */
internal fun readingValue(key: String, raw: Double?): Double? {
    val spec = readingSpec(key)
    if (raw == null) return spec.max
    if (!raw.isFinite()) return null
    val converted = raw * spec.scale
    val min = spec.min
    val max = spec.max
    if (min == null || max == null) return converted
    return converted.coerceIn(min, max)
}
