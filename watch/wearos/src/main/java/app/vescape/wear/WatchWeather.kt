package app.vescape.wear

import androidx.annotation.DrawableRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import java.util.Calendar

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt
 * @parity /modules/vescape-core/ios/watch/WatchWeather.swift
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
const val WEATHER_SUNRISE = "sunriseMinuteOfDay"
const val WEATHER_SUNSET = "sunsetMinuteOfDay"
const val WEATHER_LATITUDE = "latitude"
const val WEATHER_LONGITUDE = "longitude"
const val WEATHER_FETCHED_AT = "fetchedAtMs"

data class WatchWeatherHour(
    val minuteOfDay: Int,
    val temperatureC: Int,
    val icon: String,
    val precipitationProbability: Int,
)

data class WatchWeather(
    val temperatureC: Int,
    val icon: String,
    val label: String,
    val precipitationProbability: Int,
    val hourly: List<WatchWeatherHour>,
    val sunriseMinuteOfDay: Int?,
    val sunsetMinuteOfDay: Int?,
    val latitude: Double?,
    val longitude: Double?,
    val fetchedAtMs: Long,
)

/**
 * @parity /modules/vescape-core/ios/watch/WatchWeather.swift `decode`
 */
internal fun decodeWatchWeather(payload: Map<String, Any?>?): WatchWeather? {
    payload ?: return null
    val temperature = payload[WEATHER_TEMP_C] as? Int ?: return null
    val minutes = payload[WEATHER_HOUR_MINUTES] as? List<*> ?: emptyList<Any>()
    val temps = payload[WEATHER_HOUR_TEMPS] as? List<*> ?: emptyList<Any>()
    val icons = payload[WEATHER_HOUR_ICONS] as? Array<*> ?: emptyArray<Any>()
    val precips = payload[WEATHER_HOUR_PRECIPS] as? List<*> ?: emptyList<Any>()
    return WatchWeather(
        temperatureC = temperature,
        icon = payload[WEATHER_ICON] as? String ?: "",
        label = payload[WEATHER_LABEL] as? String ?: "",
        precipitationProbability = payload[WEATHER_PRECIP] as? Int ?: 0,
        hourly = (0 until minOf(minutes.size, temps.size, icons.size, precips.size)).mapNotNull { index ->
            WatchWeatherHour(
                minuteOfDay = minutes[index] as? Int ?: return@mapNotNull null,
                temperatureC = temps[index] as? Int ?: return@mapNotNull null,
                icon = icons[index] as? String ?: return@mapNotNull null,
                precipitationProbability = precips[index] as? Int ?: return@mapNotNull null,
            )
        },
        sunriseMinuteOfDay = payload[WEATHER_SUNRISE] as? Int,
        sunsetMinuteOfDay = payload[WEATHER_SUNSET] as? Int,
        latitude = payload[WEATHER_LATITUDE] as? Double,
        longitude = payload[WEATHER_LONGITUDE] as? Double,
        fetchedAtMs = payload[WEATHER_FETCHED_AT] as? Long ?: 0,
    )
}

object WeatherState {
    val weather = mutableStateOf<WatchWeather?>(null)

    fun accept(weather: WatchWeather?) {
        this.weather.value = weather
    }
}

const val WEATHER_STALE_MS = 3 * 60 * 60 * 1_000L

@Composable
fun freshWeather(): WatchWeather? {
    val weather by WeatherState.weather
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(STALENESS_TICK_MS)
            nowMs = System.currentTimeMillis()
        }
    }

    val forecast = weather ?: return null
    return if (nowMs - forecast.fetchedAtMs > WEATHER_STALE_MS) null else forecast
}

private const val STALENESS_TICK_MS = 60_000L

/**
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

@Composable
fun currentMinuteOfDay(): Int {
    var minuteOfDay by remember { mutableIntStateOf(minuteOfDayNow()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(STALENESS_TICK_MS)
            minuteOfDay = minuteOfDayNow()
        }
    }

    return minuteOfDay
}

fun minuteOfDayNow(): Int = Calendar.getInstance().let {
    it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
}

fun minuteOfDay(epochMs: Long): Int = Calendar.getInstance().let {
    it.timeInMillis = epochMs
    it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchWeather.swift `watchFormatHour`
 * @parity /src/helpers/time.ts `formatTimeOfDay`
 */
fun formatHour(minuteOfDay: Int, timeFormat: String = "24h", seconds: Int? = null): String {
    val wrapped = ((minuteOfDay % 1440) + 1440) % 1440
    val hour = wrapped / 60
    val minute = wrapped % 60
    val clock = if (timeFormat == "12h") {
        String.format(java.util.Locale.ROOT, "%d:%02d", if (hour % 12 == 0) 12 else hour % 12, minute)
    } else String.format(java.util.Locale.ROOT, "%02d:%02d", hour, minute)
    val precise = if (seconds == null) clock else clock + String.format(java.util.Locale.ROOT, ":%02d", seconds)
    return if (timeFormat == "12h") "$precise ${if (hour < 12) "AM" else "PM"}" else precise
}

/** @parity /modules/vescape-core/ios/watch/WatchWeather.swift `watchFormatClock` */
fun formatClock(epochMs: Long, timeFormat: String = "24h", withSeconds: Boolean = false): String =
    Calendar.getInstance().let {
        it.timeInMillis = epochMs
        formatHour(it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE), timeFormat, if (withSeconds) it.get(Calendar.SECOND) else null)
    }
