package expo.modules.vescapecore.watch

import expo.modules.vescapecore.weather.Weather

/**
 * Data Layer path carrying the forecast to the wrist. Cold data like the route and the settings: it
 * changes every ten minutes at most, never per tick, so it rides the Data Layer and survives a
 * disconnect instead of being dropped like an undelivered message.
 *
 * Key-value `DataMap` for the same reason [WATCH_SETTINGS_PATH] is one — an older wrist ignores keys
 * it does not know, a newer wrist falls back to its own default for keys an older phone never sends.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt
 */
internal const val WATCH_WEATHER_PATH = "/weather"

/** Current temperature, whole degrees Celsius. */
internal const val WATCH_WEATHER_TEMP_C = "temperatureC"

/** Condition pictogram slug, resolved by native so the wrist never classifies a WMO code. */
internal const val WATCH_WEATHER_ICON = "icon"

/** One-line condition label, already phrased for a wrist-width readout. */
internal const val WATCH_WEATHER_LABEL = "label"

/** Chance of precipitation right now, percent. */
internal const val WATCH_WEATHER_PRECIP = "precipitationProbability"

/** Forecast hours, packed as parallel arrays so the DataMap stays a flat key-value bag. */
internal const val WATCH_WEATHER_HOUR_MINUTES = "hourMinutes"
internal const val WATCH_WEATHER_HOUR_TEMPS = "hourTemps"
internal const val WATCH_WEATHER_HOUR_ICONS = "hourIcons"
internal const val WATCH_WEATHER_HOUR_PRECIPS = "hourPrecips"

/** When the forecast was fetched, so the wrist can age out a reading the phone stopped refreshing. */
internal const val WATCH_WEATHER_FETCHED_AT = "fetchedAtMs"

/**
 * The wrist-relevant slice of a [Weather]. Equality decides whether a push is worth a round trip, so
 * it deliberately excludes nothing the wrist renders — two forecasts that look identical on the
 * wrist are the same push.
 */
internal data class WatchWeather(
    val temperatureC: Int,
    val icon: String,
    val label: String,
    val precipitationProbability: Int,
    val hourMinutes: IntArray,
    val hourTemps: IntArray,
    val hourIcons: List<String>,
    val hourPrecips: IntArray,
    val fetchedAtMs: Long,
) {
    // Arrays make the generated equals() identity-based, which would push an identical forecast on
    // every refresh; the wrist would redraw the same numbers for nothing.
    override fun equals(other: Any?): Boolean =
        other is WatchWeather &&
            temperatureC == other.temperatureC &&
            icon == other.icon &&
            label == other.label &&
            precipitationProbability == other.precipitationProbability &&
            hourMinutes.contentEquals(other.hourMinutes) &&
            hourTemps.contentEquals(other.hourTemps) &&
            hourIcons == other.hourIcons &&
            hourPrecips.contentEquals(other.hourPrecips)

    override fun hashCode(): Int {
        var result = temperatureC
        result = 31 * result + icon.hashCode()
        result = 31 * result + label.hashCode()
        result = 31 * result + precipitationProbability
        result = 31 * result + hourMinutes.contentHashCode()
        result = 31 * result + hourTemps.contentHashCode()
        result = 31 * result + hourIcons.hashCode()
        result = 31 * result + hourPrecips.contentHashCode()
        return result
    }
}

/**
 * Everything the wrist mirrors from the forecast. Adding a field means adding a key constant above,
 * a `putX` in [WatchWeatherPusher], and a read on the wrist.
 */
internal fun Weather.toWatchWeather(): WatchWeather = WatchWeather(
    temperatureC = temperatureC,
    icon = icon.slug,
    label = label,
    precipitationProbability = precipitationProbability,
    hourMinutes = hourly.map { it.minuteOfDay }.toIntArray(),
    hourTemps = hourly.map { it.temperatureC }.toIntArray(),
    hourIcons = hourly.map { it.icon.slug },
    hourPrecips = hourly.map { it.precipitationProbability }.toIntArray(),
    fetchedAtMs = fetchedAtMs,
)
