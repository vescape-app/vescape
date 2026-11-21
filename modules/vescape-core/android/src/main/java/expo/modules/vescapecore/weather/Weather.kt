package expo.modules.vescapecore.weather

import expo.modules.vescapecore.telemetry.WeatherObservation
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
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
 * @parity /modules/vescape-core/ios/weather/Weather.swift `WeatherSlot`
 */
data class WeatherSlot(
    val startMs: Long,
    val endMs: Long,
    val precipitationMmPerHour: Double,
    val precipitationProbability: Int?,
    val weatherCode: Int?,
    val windGustsKmh: Double?,
)

/**
 * @parity /modules/vescape-core/ios/weather/Weather.swift `Weather`
 * @parity /modules/vescape-core/src/index.ts `Weather`
 */
data class Weather(
    val temperatureC: Int,
    val weatherCode: Int,
    val icon: WeatherIcon,
    val precipitationProbability: Int,
    val hourly: List<WeatherHour>,
    val sunriseMinuteOfDay: Int?,
    val sunsetMinuteOfDay: Int?,
    val latitude: Double,
    val longitude: Double,
    val fetchedAtMs: Long,
    val hourlySlots: List<WeatherSlot> = emptyList(),
    val quarterHourSlots: List<WeatherSlot> = emptyList(),
    val observedAtMs: Long? = null,
    val windGustsKmh: Double? = null,
    val isDay: Boolean = true,
    val currentTemperatureC: Double = temperatureC.toDouble(),
) {
    val label: String get() = weatherLabel(weatherCode)

    /**
     * @parity /modules/vescape-core/ios/weather/Weather.swift `Weather.observation`
     */
    fun observation(): WeatherObservation? {
        val at = observedAtMs ?: return null
        return WeatherObservation.normalized(at, currentTemperatureC, weatherCode, windGustsKmh, isDay)
    }

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

internal fun minuteOfDay(isoLocalTime: String): Int? {
    val time = isoLocalTime.substringAfter('T', "")
    val hour = time.substringBefore(':', "").toIntOrNull() ?: return null
    val minute = time.substringAfter(':', "").take(2).toIntOrNull() ?: return null
    return hour * 60 + minute
}

/**
 * @parity /modules/vescape-core/ios/weather/Weather.swift `epochMs`
 */
internal fun epochMs(isoLocalTime: String, utcOffsetSeconds: Int): Long? =
    // intentional-suppression: an unparseable stamp drops only its own slot
    runCatching {
        LocalDateTime.parse(isoLocalTime).toEpochSecond(ZoneOffset.ofTotalSeconds(utcOffsetSeconds)) * 1_000
    }.getOrNull()

/**
 * @parity /modules/vescape-core/ios/weather/Weather.swift `weatherSlots`
 */
private fun weatherSlots(
    series: JSONObject?,
    utcOffsetSeconds: Int?,
    periodMinutes: Int,
    precipitationScale: Double,
): List<WeatherSlot> {
    if (series == null || utcOffsetSeconds == null) return emptyList()
    val times = series.optJSONArray("time") ?: return emptyList()
    val precips = series.optJSONArray("precipitation") ?: return emptyList()
    val probabilities = series.optJSONArray("precipitation_probability")
    val codes = series.optJSONArray("weather_code")
    val gusts = series.optJSONArray("wind_gusts_10m")
    fun JSONArray?.present(index: Int) = this != null && index < length() && !isNull(index)
    return buildList {
        for (index in 0 until times.length()) {
            val endMs = epochMs(times.optString(index), utcOffsetSeconds) ?: continue
            if (!precips.present(index)) continue
            add(
                WeatherSlot(
                    startMs = endMs - periodMinutes * 60_000L,
                    endMs = endMs,
                    precipitationMmPerHour = precips.optDouble(index) * precipitationScale,
                    precipitationProbability = if (probabilities.present(index)) probabilities!!.optInt(index) else null,
                    weatherCode = if (codes.present(index)) codes!!.optInt(index) else null,
                    windGustsKmh = if (gusts.present(index)) gusts!!.optDouble(index) else null,
                ),
            )
        }
    }
}

/**
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
 * @parity /modules/vescape-core/ios/weather/Weather.swift `parseOpenMeteoWeather`
 */
fun parseOpenMeteoWeather(
    body: String,
    latitude: Double,
    longitude: Double,
    fetchedAtMs: Long,
): Weather? {
    // intentional-suppression: owning store exposes the failure to the active UI
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

    val utcOffsetSeconds = if (json.has("utc_offset_seconds")) json.optInt("utc_offset_seconds") else null
    val currentMinute = minuteOfDay(json.optJSONObject("current")?.optString("time").orEmpty())
    val currentCode = current.optInt("weather_code")
    val currentTemperature = current.optDouble("temperature_2m")
    val night = isNight(currentMinute ?: hourly.firstOrNull()?.minuteOfDay ?: 12 * 60, sunriseMinute, sunsetMinute)
    val currentTime = current.optString("time").takeIf { it.isNotEmpty() }
    return Weather(
        temperatureC = Math.round(currentTemperature).toInt(),
        currentTemperatureC = currentTemperature,
        weatherCode = currentCode,
        icon = weatherIcon(currentCode, night),
        observedAtMs = if (currentTime != null && utcOffsetSeconds != null) epochMs(currentTime, utcOffsetSeconds) else null,
        windGustsKmh = if (current.has("wind_gusts_10m") && !current.isNull("wind_gusts_10m")) {
            current.optDouble("wind_gusts_10m")
        } else null,
        isDay = if (current.has("is_day") && !current.isNull("is_day")) current.optInt("is_day") != 0 else !night,
        precipitationProbability = current.optInt("precipitation_probability"),
        hourly = hourly,
        sunriseMinuteOfDay = sunriseMinute,
        sunsetMinuteOfDay = sunsetMinute,
        latitude = latitude,
        longitude = longitude,
        fetchedAtMs = fetchedAtMs,
        hourlySlots = weatherSlots(hourlyJson, utcOffsetSeconds, periodMinutes = 60, precipitationScale = 1.0),
        quarterHourSlots = weatherSlots(
            json.optJSONObject("minutely_15"),
            utcOffsetSeconds,
            periodMinutes = 15,
            precipitationScale = 4.0,
        ),
    )
}
