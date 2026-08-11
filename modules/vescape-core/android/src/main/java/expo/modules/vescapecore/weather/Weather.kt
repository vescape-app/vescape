package expo.modules.vescapecore.weather

import org.json.JSONObject

/**
 * The condition pictogram a forecast resolves to. Native owns the classification so the phone, the
 * wrist and iOS cannot drift apart on what a WMO code looks like; every renderer only maps a slug
 * to its own artwork and palette.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `WeatherIcon`
 * @parity /modules/vescape-core/src/index.ts `WeatherIconSlug`
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `weatherIconRes`
 */
enum class WeatherIcon(val slug: String) {
    SUN("sun"),
    MOON("moon"),
    CLOUD_SUN("cloud-sun"),
    CLOUD_MOON("cloud-moon"),
    CLOUD("cloud"),
    CLOUD_FOG("cloud-fog"),
    CLOUD_RAIN("cloud-rain"),
    CLOUD_SNOW("cloud-snow"),
    CLOUD_LIGHTNING("cloud-lightning"),
}

/**
 * WMO weather code into a pictogram. Only the clear and lightly-clouded codes have a night form;
 * rain looks the same at every hour.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `weatherIcon`
 */
fun weatherIcon(code: Int, night: Boolean): WeatherIcon = when {
    code == 0 -> if (night) WeatherIcon.MOON else WeatherIcon.SUN
    code <= 2 -> if (night) WeatherIcon.CLOUD_MOON else WeatherIcon.CLOUD_SUN
    code == 3 -> WeatherIcon.CLOUD
    code == 45 || code == 48 -> WeatherIcon.CLOUD_FOG
    code in 51..57 -> WeatherIcon.CLOUD_RAIN
    code in 61..67 || code in 80..82 -> WeatherIcon.CLOUD_RAIN
    code in setOf(71, 73, 75, 77, 85, 86) -> WeatherIcon.CLOUD_SNOW
    code in setOf(95, 96, 99) -> WeatherIcon.CLOUD_LIGHTNING
    else -> WeatherIcon.CLOUD
}

/**
 * Human label for a WMO code. One line, wrist-width, and deliberately coarser than the WMO table:
 * a rider needs "Rain", not "moderate intensity rain showers".
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `weatherLabel`
 */
fun weatherLabel(code: Int): String = when {
    code == 0 -> "Clear sky"
    code <= 2 -> "Partly cloudy"
    code == 3 -> "Overcast"
    code == 45 || code == 48 -> "Fog"
    code in 51..57 -> "Drizzle"
    code in 61..67 || code in 80..82 -> "Rain"
    code in setOf(71, 73, 75, 77, 85, 86) -> "Snow"
    code in setOf(95, 96, 99) -> "Thunderstorm"
    else -> "Cloudy"
}

/**
 * One forecast hour. Times are local to the forecast location (Open-Meteo is asked for the device
 * timezone), carried as minutes since local midnight so no renderer has to parse an ISO string.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `WeatherHour`
 * @parity /modules/vescape-core/src/index.ts `WeatherHour`
 */
data class WeatherHour(
    val minuteOfDay: Int,
    val temperatureC: Int,
    val weatherCode: Int,
    val icon: WeatherIcon,
    val precipitationProbability: Int,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "minuteOfDay" to minuteOfDay,
        "temperatureC" to temperatureC,
        "weatherCode" to weatherCode,
        "icon" to icon.slug,
        "precipitationProbability" to precipitationProbability,
    )
}

/**
 * The weather where the rider is. Native truth: fetched, cached and aged natively so the wrist and
 * the recording pipeline keep seeing it while the JS runtime is gone.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `Weather`
 * @parity /modules/vescape-core/src/index.ts `Weather`
 */
data class Weather(
    val temperatureC: Int,
    val weatherCode: Int,
    val icon: WeatherIcon,
    val precipitationProbability: Int,
    val hourly: List<WeatherHour>,
    /** Minutes since local midnight, or null when the forecast omitted the day's sun times. */
    val sunriseMinuteOfDay: Int?,
    val sunsetMinuteOfDay: Int?,
    val latitude: Double,
    val longitude: Double,
    val fetchedAtMs: Long,
) {
    val label: String get() = weatherLabel(weatherCode)

    fun toMap(): Map<String, Any?> = mapOf(
        "temperatureC" to temperatureC,
        "weatherCode" to weatherCode,
        "icon" to icon.slug,
        "label" to label,
        "precipitationProbability" to precipitationProbability,
        "hourly" to hourly.map { it.toMap() },
        "sunriseMinuteOfDay" to sunriseMinuteOfDay,
        "sunsetMinuteOfDay" to sunsetMinuteOfDay,
        "latitude" to latitude,
        "longitude" to longitude,
        "fetchedAtMs" to fetchedAtMs,
    )
}

/** Minutes since local midnight in an Open-Meteo `YYYY-MM-DDTHH:MM` stamp, or null if unparseable. */
internal fun minuteOfDay(isoLocalTime: String): Int? {
    val time = isoLocalTime.substringAfter('T', "")
    val hour = time.substringBefore(':', "").toIntOrNull() ?: return null
    val minute = time.substringAfter(':', "").take(2).toIntOrNull() ?: return null
    return hour * 60 + minute
}

/**
 * Whether a local time falls outside daylight. Sunrise/sunset come from the same forecast, so a
 * polar summer resolves correctly; a forecast that omits them falls back to a fixed night window.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `isNight`
 */
internal fun isNight(minuteOfDay: Int, sunriseMinute: Int?, sunsetMinute: Int?): Boolean {
    if (sunriseMinute == null || sunsetMinute == null) {
        val hour = minuteOfDay / 60
        return hour >= 21 || hour < 6
    }
    return minuteOfDay < sunriseMinute || minuteOfDay >= sunsetMinute
}

/**
 * Open-Meteo forecast response into a [Weather]. Returns null when the payload carries no usable
 * current conditions — a partial forecast is not worth showing a rider a wrong number for.
 *
 * @parity /modules/vescape-core/ios/weather/Weather.swift `parseOpenMeteoWeather`
 */
fun parseOpenMeteoWeather(
    body: String,
    latitude: Double,
    longitude: Double,
    fetchedAtMs: Long,
): Weather? {
    val json = runCatching { JSONObject(body) }.getOrNull() ?: return null
    val current = json.optJSONObject("current") ?: return null
    if (!current.has("temperature_2m") || current.isNull("temperature_2m")) return null
    if (!current.has("weather_code") || current.isNull("weather_code")) return null

    val daily = json.optJSONObject("daily")
    val sunriseMinute = daily?.optJSONArray("sunrise")?.optString(0)?.let(::minuteOfDay)
    val sunsetMinute = daily?.optJSONArray("sunset")?.optString(0)?.let(::minuteOfDay)

    val hourlyJson = json.optJSONObject("hourly")
    val times = hourlyJson?.optJSONArray("time")
    val temps = hourlyJson?.optJSONArray("temperature_2m")
    val codes = hourlyJson?.optJSONArray("weather_code")
    val precips = hourlyJson?.optJSONArray("precipitation_probability")
    val hourly = buildList {
        for (index in 0 until (times?.length() ?: 0)) {
            // Every required field must be present at this index. The arrays are parallel but
            // independent, and a short one would otherwise read as 0 — a fabricated clear sky at
            // 0 °C, which looks like real weather rather than like missing data.
            val minute = minuteOfDay(times!!.optString(index)) ?: continue
            if (codes == null || index >= codes.length() || codes.isNull(index)) continue
            if (temps == null || index >= temps.length() || temps.isNull(index)) continue
            val code = codes.optInt(index)
            add(
                WeatherHour(
                    minuteOfDay = minute,
                    temperatureC = Math.round(temps.optDouble(index)).toInt(),
                    weatherCode = code,
                    icon = weatherIcon(code, isNight(minute, sunriseMinute, sunsetMinute)),
                    precipitationProbability = precips?.optInt(index) ?: 0,
                ),
            )
        }
    }

    val currentMinute = minuteOfDay(json.optJSONObject("current")?.optString("time").orEmpty())
    val currentCode = current.optInt("weather_code")
    return Weather(
        temperatureC = Math.round(current.optDouble("temperature_2m")).toInt(),
        weatherCode = currentCode,
        icon = weatherIcon(
            currentCode,
            isNight(currentMinute ?: hourly.firstOrNull()?.minuteOfDay ?: 12 * 60, sunriseMinute, sunsetMinute),
        ),
        precipitationProbability = current.optInt("precipitation_probability"),
        hourly = hourly,
        sunriseMinuteOfDay = sunriseMinute,
        sunsetMinuteOfDay = sunsetMinute,
        latitude = latitude,
        longitude = longitude,
        fetchedAtMs = fetchedAtMs,
    )
}
