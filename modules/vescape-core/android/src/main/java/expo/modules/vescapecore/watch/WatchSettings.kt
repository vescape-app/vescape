package expo.modules.vescapecore.watch

import expo.modules.vescapecore.database.AppSettings

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt
 * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
 */
internal const val WATCH_SETTINGS_PATH = "/settings"

internal const val WATCH_SETTING_BOARD_MOVE_STRENGTH = "boardMoveStrengthPercent"

internal const val WATCH_SETTING_NAV_ARROW = "navArrowEnabled"

internal const val WATCH_SETTING_TELEMETRY_TRAIL = "telemetryTrailEnabled"

internal const val WATCH_SETTING_TELEMETRY_GROUP = "telemetryGroupEnabled"

internal const val WATCH_SETTING_TELEMETRY_ROUTE = "telemetryRouteEnabled"

internal const val WATCH_SETTING_STREET_MAP = "streetMapEnabled"

internal const val WATCH_SETTING_MAP_GAUGES = "mapGaugesPercent"

internal const val WATCH_SETTING_DISTANCE_UNIT = "distanceUnit"
internal const val WATCH_SETTING_TEMPERATURE_UNIT = "temperatureUnit"
internal const val WATCH_SETTING_TIME_FORMAT = "timeFormat"

internal const val WATCH_SETTING_TILT_RATE = "tiltRatePercent"

/**
 * @parity /modules/vescape-core/ios/watch/WatchSettings.swift `watchSourceSettingKeys`
 */
internal val WATCH_SOURCE_SETTING_KEYS = setOf(
    "boardMoveStrengthPercent",
    "wearNavArrowEnabled",
    "wearTelemetryTrailEnabled",
    "wearTelemetryGroupEnabled",
    "wearTelemetryRouteEnabled",
    "wearStreetMapEnabled",
    "wearMapGaugesPercent",
    "distanceUnit",
    "temperatureUnit",
    "timeFormat",
    "wearTiltRatePercent",
    "wearPushRateHz",
)

internal data class WatchSettings(
    val boardMoveStrengthPercent: Int,
    val navArrowEnabled: Boolean,
    val distanceUnit: String = "km",
    val temperatureUnit: String = "celsius",
    val timeFormat: String = "24h",
    val tiltRatePercent: Int = 20,
    val telemetryTrailEnabled: Boolean = true,
    val telemetryGroupEnabled: Boolean = true,
    val telemetryRouteEnabled: Boolean = true,
    val streetMapEnabled: Boolean = true,
    val mapGaugesPercent: Int = WatchMapGauges.DEFAULT_PERCENT,
)

internal fun AppSettings.toWatchSettings(): WatchSettings = WatchSettings(
    boardMoveStrengthPercent = boardMoveStrengthPercent,
    navArrowEnabled = wearNavArrowEnabled,
    telemetryTrailEnabled = wearTelemetryTrailEnabled,
    telemetryGroupEnabled = wearTelemetryGroupEnabled,
    telemetryRouteEnabled = wearTelemetryRouteEnabled,
    streetMapEnabled = wearStreetMapEnabled,
    mapGaugesPercent = wearMapGaugesPercent,
    distanceUnit = distanceUnit,
    temperatureUnit = temperatureUnit,
    timeFormat = timeFormat,
    tiltRatePercent = wearTiltRatePercent,
)
