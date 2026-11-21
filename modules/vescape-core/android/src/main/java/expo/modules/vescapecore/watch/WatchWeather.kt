package expo.modules.vescapecore.watch

import expo.modules.vescapecore.weather.Weather

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt
 * @parity /modules/vescape-core/ios/watch/WatchWeather.swift
 */
internal const val WATCH_WEATHER_PATH = "/weather"

internal const val WATCH_WEATHER_TEMP_C = "temperatureC"

internal const val WATCH_WEATHER_ICON = "icon"

internal const val WATCH_WEATHER_LABEL = "label"

internal const val WATCH_WEATHER_PRECIP = "precipitationProbability"

internal const val WATCH_WEATHER_HOUR_MINUTES = "hourMinutes"
internal const val WATCH_WEATHER_HOUR_TEMPS = "hourTemps"
internal const val WATCH_WEATHER_HOUR_ICONS = "hourIcons"
internal const val WATCH_WEATHER_HOUR_PRECIPS = "hourPrecips"

internal const val WATCH_WEATHER_SUNRISE = "sunriseMinuteOfDay"
internal const val WATCH_WEATHER_SUNSET = "sunsetMinuteOfDay"

internal const val WATCH_WEATHER_LATITUDE = "latitude"
internal const val WATCH_WEATHER_LONGITUDE = "longitude"

internal const val WATCH_WEATHER_FETCHED_AT = "fetchedAtMs"

internal data class WatchWeather(
    val temperatureC: Int,
    val icon: String,
    val label: String,
    val precipitationProbability: Int,
    val hourMinutes: IntArray,
    val hourTemps: IntArray,
    val hourIcons: List<String>,
    val hourPrecips: IntArray,
    val sunriseMinuteOfDay: Int?,
    val sunsetMinuteOfDay: Int?,
    val latitude: Double,
    val longitude: Double,
    val fetchedAtMs: Long,
) {
    override fun equals(other: Any?): Boolean =
        other is WatchWeather &&
            temperatureC == other.temperatureC &&
            icon == other.icon &&
            label == other.label &&
            precipitationProbability == other.precipitationProbability &&
            hourMinutes.contentEquals(other.hourMinutes) &&
            hourTemps.contentEquals(other.hourTemps) &&
            hourIcons == other.hourIcons &&
            hourPrecips.contentEquals(other.hourPrecips) &&
            sunriseMinuteOfDay == other.sunriseMinuteOfDay &&
            sunsetMinuteOfDay == other.sunsetMinuteOfDay &&
            latitude == other.latitude &&
            longitude == other.longitude

    override fun hashCode(): Int {
        var result = temperatureC
        result = 31 * result + icon.hashCode()
        result = 31 * result + label.hashCode()
        result = 31 * result + precipitationProbability
        result = 31 * result + hourMinutes.contentHashCode()
        result = 31 * result + hourTemps.contentHashCode()
        result = 31 * result + hourIcons.hashCode()
        result = 31 * result + hourPrecips.contentHashCode()
        result = 31 * result + (sunriseMinuteOfDay ?: 0)
        result = 31 * result + (sunsetMinuteOfDay ?: 0)
        result = 31 * result + latitude.hashCode()
        result = 31 * result + longitude.hashCode()
        return result
    }
}

internal fun Weather.toWatchWeather(): WatchWeather = WatchWeather(
    temperatureC = temperatureC,
    icon = icon.slug,
    label = label,
    precipitationProbability = precipitationProbability,
    hourMinutes = hourly.map { it.minuteOfDay }.toIntArray(),
    hourTemps = hourly.map { it.temperatureC }.toIntArray(),
    hourIcons = hourly.map { it.icon.slug },
    hourPrecips = hourly.map { it.precipitationProbability }.toIntArray(),
    sunriseMinuteOfDay = sunriseMinuteOfDay,
    sunsetMinuteOfDay = sunsetMinuteOfDay,
    latitude = latitude,
    longitude = longitude,
    fetchedAtMs = fetchedAtMs,
)
