package expo.modules.vescapecore.telemetry

/**
 * @parity /src/modules/board/constants/telemetryThresholds.ts `TelemetryLevel`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryLevel.swift `TelemetryLevel`
 */
internal enum class TelemetryLevel(val wire: Int) {
    NORMAL(0),
    WARNING(1),
    CRITICAL(2),
    ;

    companion object {
        fun fromWire(value: Int): TelemetryLevel = when (value) {
            WARNING.wire -> WARNING
            CRITICAL.wire -> CRITICAL
            else -> NORMAL
        }
    }
}
