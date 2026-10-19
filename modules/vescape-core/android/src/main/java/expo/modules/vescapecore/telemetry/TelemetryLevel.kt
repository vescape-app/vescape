package expo.modules.vescapecore.telemetry

/**
 * How alarming a telemetry reading is. Ordered, so the worse of two levels is their [maxOf].
 * [wire] is its value in the Group Ride Frame; a value this build does not know reads as [NORMAL].
 *
 * Pure Kotlin: `plugins/withWearMirror.ts` copies this file into the Wear OS Mirror beside the Group
 * Ride Frame codec that carries it.
 *
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
