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
const val WEATHER_SUNRISE = "sunriseMinuteOfDay"
const val WEATHER_SUNSET = "sunsetMinuteOfDay"
const val WEATHER_LATITUDE = "latitude"
const val WEATHER_LONGITUDE = "longitude"
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
    /** Minutes since local midnight; null when the phone had no daily times to send. */
    val sunriseMinuteOfDay: Int?,
    val sunsetMinuteOfDay: Int?,
    /**
     * Where the forecast was taken. Null from a phone too old to send it, which is why the radar
     * page can be empty on a wrist that is otherwise showing weather fine.
     */
    val latitude: Double?,
    val longitude: Double?,
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
 * How long a pushed forecast is worth showing. The Data Layer keeps the last item forever, so a
 * phone that stopped refreshing (app killed, out of range, GPS off) would otherwise leave yesterday's
 * conditions on the wrist looking current. Generous next to the phone's ten-minute refresh: this is
 * the line between "a bit old" and "not weather any more".
 */
const val WEATHER_STALE_MS = 3 * 60 * 60 * 1_000L

/**
 * The pushed forecast while it is still worth believing, else null. Recomposes on its own clock so
 * an aged-out reading disappears without waiting for a push that is never coming.
 */
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
    // A clock that jumped backwards (timezone/NTP correction) must not read as "from the future" and
    // hide a forecast that is fine; only real age hides it.
    return if (nowMs - forecast.fetchedAtMs > WEATHER_STALE_MS) null else forecast
}

/** Coarse: the readout only has to drop within a minute or so of the forecast ageing out. */
private const val STALENESS_TICK_MS = 60_000L

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

/**
 * Local wall-clock minute of day, re-read on the same coarse tick as staleness so a forecast left
 * open on the wrist crosses sunset on its own.
 */
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

/** Minute of day from the device clock, the unit every sun and hour time on the wrist is in. */
fun minuteOfDayNow(): Int = Calendar.getInstance().let {
    it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
}

/** Local minute of day for an instant, the unit every wrist time is formatted from. */
fun minuteOfDay(epochMs: Long): Int = Calendar.getInstance().let {
    it.timeInMillis = epochMs
    it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
}

/** `HH:MM` for a minute-of-day, matching [WatchClock]'s always-24h readout. */
fun formatHour(minuteOfDay: Int): String =
    String.format("%02d:%02d", (minuteOfDay / 60) % 24, minuteOfDay % 60)
