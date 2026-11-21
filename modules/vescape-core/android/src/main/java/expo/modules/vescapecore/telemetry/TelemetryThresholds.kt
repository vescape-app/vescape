package expo.modules.vescapecore.telemetry

/**
 * @parity /src/modules/board/constants/telemetryThresholds.ts `TELEMETRY_THRESHOLDS`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryThresholds.swift `TelemetryThresholds`
 */
internal object TelemetryThresholds {
    const val BATTERY_WARNING = 0.3
    const val BATTERY_CRITICAL = 0.1
    const val TEMP_WARNING = 70.0
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

    fun heatLevel(motorTempC: Double?, ctrlTempC: Double?): TelemetryLevel =
        maxOf(tempLevel(motorTempC), tempLevel(ctrlTempC))
}
