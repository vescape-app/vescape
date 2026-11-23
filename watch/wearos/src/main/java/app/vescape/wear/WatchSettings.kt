package app.vescape.wear

import androidx.compose.runtime.mutableStateOf
import expo.modules.vescapecore.watch.WatchMapGauges

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
 * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
 */
const val SETTINGS_PATH = "/settings"

const val SETTING_BOARD_MOVE_STRENGTH = "boardMoveStrengthPercent"

const val SETTING_NAV_ARROW = "navArrowEnabled"

const val SETTING_TELEMETRY_TRAIL = "telemetryTrailEnabled"

const val SETTING_TELEMETRY_GROUP = "telemetryGroupEnabled"

const val SETTING_TELEMETRY_ROUTE = "telemetryRouteEnabled"

const val SETTING_STREET_MAP = "streetMapEnabled"

const val SETTING_MAP_GAUGES = "mapGaugesPercent"

const val SETTING_DISTANCE_UNIT = "distanceUnit"
const val SETTING_TEMPERATURE_UNIT = "temperatureUnit"
const val SETTING_TIME_FORMAT = "timeFormat"

const val SETTING_TILT_RATE = "tiltRatePercent"

const val DEFAULT_TILT_RATE_PERCENT = 20

data class WatchSettings(
    val distanceUnit: String = "km",
    val temperatureUnit: String = "celsius",
    val timeFormat: String = "24h",
    val navArrowEnabled: Boolean = false,
    val boardMoveStrengthPercent: Int? = null,
    val tiltRatePercent: Int = DEFAULT_TILT_RATE_PERCENT,
    val telemetryTrailEnabled: Boolean = true,
    val telemetryGroupEnabled: Boolean = true,
    val telemetryRouteEnabled: Boolean = true,
    val streetMapEnabled: Boolean = true,
    val mapGaugesPercent: Int = WatchMapGauges.DEFAULT_PERCENT,
) {
    companion object {
        fun decode(payload: Map<String, Any?>): WatchSettings = WatchSettings(
            navArrowEnabled = payload[SETTING_NAV_ARROW] as? Boolean ?: false,
            telemetryTrailEnabled = payload[SETTING_TELEMETRY_TRAIL] as? Boolean ?: true,
            telemetryGroupEnabled = payload[SETTING_TELEMETRY_GROUP] as? Boolean ?: true,
            telemetryRouteEnabled = payload[SETTING_TELEMETRY_ROUTE] as? Boolean ?: true,
            streetMapEnabled = payload[SETTING_STREET_MAP] as? Boolean ?: true,
            mapGaugesPercent = WatchMapGauges.percent(payload[SETTING_MAP_GAUGES]) ?: WatchMapGauges.DEFAULT_PERCENT,
            boardMoveStrengthPercent = payload[SETTING_BOARD_MOVE_STRENGTH] as? Int,
            distanceUnit = if (payload[SETTING_DISTANCE_UNIT] == "mi") "mi" else "km",
            temperatureUnit = if (payload[SETTING_TEMPERATURE_UNIT] == "fahrenheit") "fahrenheit" else "celsius",
            timeFormat = if (payload[SETTING_TIME_FORMAT] == "12h") "12h" else "24h",
            tiltRatePercent = (payload[SETTING_TILT_RATE] as? Int)?.coerceIn(1, 100) ?: DEFAULT_TILT_RATE_PERCENT,
        )
    }
}

object SettingsState {
    val settings = mutableStateOf(WatchSettings())

    fun accept(settings: WatchSettings) {
        this.settings.value = settings
    }
}
