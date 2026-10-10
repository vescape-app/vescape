package expo.modules.vescapecore.telemetry

/**
 * @parity /modules/vescape-core/ios/telemetry/UnitPresentation.swift
 * @parity /src/helpers/units.ts
 */
object UnitPresentation {
    const val METERS_PER_MILE = 1609.344
    fun speedFromKmh(kmh: Double, unitSystem: String): Double =
        if (unitSystem == "imperial") kmh * 1000.0 / METERS_PER_MILE else kmh
    fun speedUnit(unitSystem: String): String = if (unitSystem == "imperial") "mph" else "km/h"
    fun formatSpokenSpeed(kmh: Double, unitSystem: String): String =
        String.format(java.util.Locale.US, "%.0f", speedFromKmh(kmh, unitSystem))
    fun distance(meters: Double, unitSystem: String): String {
        if (!meters.isFinite()) return "—"
        val imperial = unitSystem == "imperial"
        val short = if (imperial) meters / METERS_PER_MILE < 0.1 else meters < 1000
        val value = if (imperial) meters / METERS_PER_MILE * (if (short) 5280 else 1) else meters / (if (short) 1 else 1000)
        val unit = if (imperial) { if (short) "ft" else "mi" } else { if (short) "m" else "km" }
        return String.format(java.util.Locale.US, if (short) "%.0f %s" else "%.1f %s", value, unit)
    }
}
