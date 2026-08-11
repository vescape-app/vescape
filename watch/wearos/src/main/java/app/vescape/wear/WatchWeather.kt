package app.vescape.wear

import androidx.annotation.DrawableRes
import androidx.compose.runtime.mutableStateOf

/**
 * Data Layer path the phone publishes the forecast on. Must match the phone-side
 * `WatchWeatherPusher`. Arrives at most once per forecast refresh and then persists, so it is read
 * on every start rather than waited for.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt
 */
const val WEATHER_PATH = "/weather"

const val WEATHER_TEMP_C = "temperatureC"
const val WEATHER_ICON = "icon"
const val WEATHER_LABEL = "label"
const val WEATHER_PRECIP = "precipitationProbability"
const val WEATHER_HOUR_MINUTES = "hourMinutes"
const val WEATHER_HOUR_TEMPS = "hourTemps"
const val WEATHER_HOUR_ICONS = "hourIcons"
const val WEATHER_HOUR_PRECIPS = "hourPrecips"
const val WEATHER_FETCHED_AT = "fetchedAtMs"

/** One forecast hour, as the wrist renders it. [minuteOfDay] is local to the forecast location. */
data class WatchWeatherHour(
    val minuteOfDay: Int,
    val temperatureC: Int,
    val icon: String,
    val precipitationProbability: Int,
)

/**
 * The forecast on the wrist. Absent until the phone has pushed one — the wrist never fetches, and a
 * phone that has not seen a GPS Fix yet has nothing to send.
 */
data class WatchWeather(
    val temperatureC: Int,
    val icon: String,
    val label: String,
    val precipitationProbability: Int,
    val hourly: List<WatchWeatherHour>,
    val fetchedAtMs: Long,
)

/** Latest forecast pushed from the phone; null until the first push arrives. */
object WeatherState {
    val weather = mutableStateOf<WatchWeather?>(null)

    fun accept(weather: WatchWeather?) {
        this.weather.value = weather
    }
}

/**
 * Condition slug into the ported Phosphor drawable. The phone resolves the slug from the WMO code,
 * so the wrist never classifies weather — an unknown slug from a newer phone draws a plain cloud
 * rather than nothing.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherIcon`
 */
@DrawableRes
fun weatherIconRes(slug: String): Int = when (slug) {
    "sun" -> R.drawable.ic_ph_sun
    "moon" -> R.drawable.ic_ph_moon_stars
    "cloud-sun" -> R.drawable.ic_ph_cloud_sun
    "cloud-moon" -> R.drawable.ic_ph_cloud_moon
    "cloud-fog" -> R.drawable.ic_ph_cloud_fog
    "cloud-rain" -> R.drawable.ic_ph_cloud_rain
    "cloud-snow" -> R.drawable.ic_ph_cloud_snow
    "cloud-lightning" -> R.drawable.ic_ph_cloud_lightning
    else -> R.drawable.ic_ph_cloud
}

/** `HH:MM` for a minute-of-day, matching [WatchClock]'s always-24h readout. */
fun formatHour(minuteOfDay: Int): String =
    String.format("%02d:%02d", (minuteOfDay / 60) % 24, minuteOfDay % 60)
