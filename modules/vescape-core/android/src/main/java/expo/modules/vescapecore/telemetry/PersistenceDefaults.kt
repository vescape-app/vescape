package expo.modules.vescapecore.telemetry

internal const val METRIC_EXCLUSION_RANGE_MERGE_GAP_MS = 2_000L
internal const val DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH = 12.0
internal const val DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH = 15.0

/** @parity /modules/vescape-core/ios/telemetry/TelemetryDatabase.swift `UNKNOWN_TELEMETRY_BOARD_ID` */
internal const val UNKNOWN_TELEMETRY_BOARD_ID = ""

/**
 * @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
internal const val DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30

val DEFAULT_HISTORY_METRIC_HOT_RANGES: Map<String, Map<String, Double>> = mapOf(
  "speed" to mapOf("start" to 30.0, "end" to 40.0),
  "duty" to mapOf("start" to 60.0, "end" to 80.0),
  "tempMotor" to mapOf("start" to 70.0, "end" to 90.0),
  "tempController" to mapOf("start" to 60.0, "end" to 80.0),
  "motorCurrent" to mapOf("start" to 35.0, "end" to 55.0),
  "batteryCurrent" to mapOf("start" to 25.0, "end" to 45.0),
)
