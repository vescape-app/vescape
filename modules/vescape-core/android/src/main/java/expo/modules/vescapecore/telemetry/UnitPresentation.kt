package expo.modules.vescapecore.telemetry

/**
 * @parity /modules/vescape-core/ios/telemetry/UnitPresentation.swift
 * @parity /src/helpers/units.ts
 */
object UnitPresentation {
    const val METERS_PER_MILE = 1609.344
    fun speedFromKmh(kmh: Double, distanceUnit: String): Double =
        if (distanceUnit == "mi") kmh * 1000.0 / METERS_PER_MILE else kmh
    fun speedUnit(distanceUnit: String): String = if (distanceUnit == "mi") "mph" else "km/h"
    fun formatSpokenSpeed(kmh: Double, distanceUnit: String): String =
        String.format(java.util.Locale.US, "%.0f", speedFromKmh(kmh, distanceUnit))
    fun distance(meters: Double, distanceUnit: String): String {
        if (!meters.isFinite()) return "—"
        val miles = distanceUnit == "mi"
        val short = if (miles) meters / METERS_PER_MILE < 0.1 else meters < 1000
        val value = if (miles) meters / METERS_PER_MILE * (if (short) 5280 else 1) else meters / (if (short) 1 else 1000)
        val unit = if (miles) { if (short) "ft" else "mi" } else { if (short) "m" else "km" }
        return String.format(java.util.Locale.US, if (short) "%.0f %s" else "%.1f %s", value, unit)
    }
}
