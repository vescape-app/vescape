package expo.modules.vescapecore.telemetry

/**
 * The app's battery and temperature tiers, as native needs them for other Riders on the wrist.
 * Battery is low-is-bad, temperature high-is-bad; a reading exactly on a threshold is still the
 * milder level, and no reading is [TelemetryLevel.NORMAL].
 *
 * Phone-only: the wrist gets the levels already resolved in the Group Ride Frame.
 *
 * @parity /src/modules/board/constants/telemetryThresholds.ts `TELEMETRY_THRESHOLDS`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryThresholds.swift `TelemetryThresholds`
 */
internal object TelemetryThresholds {
    /** Battery SoC as a 0-1 fraction: below this is a warning. */
    const val BATTERY_WARNING = 0.3
    /** Battery SoC as a 0-1 fraction: below this is critical. */
    const val BATTERY_CRITICAL = 0.1
    /** °C: above this is a warning. */
    const val TEMP_WARNING = 70.0
    /** °C: above this is critical. */
    const val TEMP_CRITICAL = 80.0

    /** @parity /src/modules/board/constants/telemetryThresholds.ts `batteryLevel` */
    fun batteryLevel(soc: Double?): TelemetryLevel = when {
        soc == null -> TelemetryLevel.NORMAL
        soc < BATTERY_CRITICAL -> TelemetryLevel.CRITICAL
        soc < BATTERY_WARNING -> TelemetryLevel.WARNING
        else -> TelemetryLevel.NORMAL
    }

    /** @parity /src/modules/board/constants/telemetryThresholds.ts `tempLevel` */
    fun tempLevel(tempC: Double?): TelemetryLevel = when {
        tempC == null -> TelemetryLevel.NORMAL
        tempC > TEMP_CRITICAL -> TelemetryLevel.CRITICAL
        tempC > TEMP_WARNING -> TelemetryLevel.WARNING
        else -> TelemetryLevel.NORMAL
    }

    /** A Rider's heat: the worse of their motor and controller temperature. */
    fun heatLevel(motorTempC: Double?, ctrlTempC: Double?): TelemetryLevel =
        maxOf(tempLevel(motorTempC), tempLevel(ctrlTempC))
}
