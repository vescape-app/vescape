package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.weather.WeatherIcon
import expo.modules.vescapecore.weather.weatherIcon
import kotlin.math.roundToInt
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeDao

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `weatherObservationFreshnessMs`
 */
internal const val WEATHER_OBSERVATION_FRESHNESS_MS = 24 * 60 * 60 * 1_000L

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `weatherProtectionStart`
 */
internal fun weatherProtectionStart(startMs: Long): Long =
  if (startMs < Long.MIN_VALUE + WEATHER_OBSERVATION_FRESHNESS_MS) Long.MIN_VALUE
  else startMs - WEATHER_OBSERVATION_FRESHNESS_MS

private const val GUST_STEP_KMH = 5

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `WeatherObservation`
 */
data class WeatherObservation(
  val observedAtMs: Long,
  val temperatureC: Int,
  val weatherCode: Int,
  val gustKmh: Int?,
  val isDay: Boolean,
) {
  fun sameConditions(other: WeatherObservation): Boolean =
    temperatureC == other.temperatureC && weatherCode == other.weatherCode &&
      gustKmh == other.gustKmh && isDay == other.isDay

  companion object {
    /**
     * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `WeatherObservation.normalized`
     */
    fun normalized(
      observedAtMs: Long,
      temperatureC: Double,
      weatherCode: Int,
      gustKmh: Double?,
      isDay: Boolean,
    ) = WeatherObservation(
      observedAtMs = observedAtMs,
      temperatureC = Math.round(temperatureC).toInt(),
      weatherCode = weatherCode,
      gustKmh = gustKmh?.takeIf { it.isFinite() }?.let { (it / GUST_STEP_KMH).roundToInt() * GUST_STEP_KMH },
      isDay = isDay,
    )
  }
}

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `shouldStoreWeatherObservation`
 */
internal fun shouldStoreWeatherObservation(
  previous: WeatherObservation?,
  next: WeatherObservation,
  force: Boolean,
): Boolean = when {
  previous == null -> true
  previous.observedAtMs == next.observedAtMs -> false
  force -> true
  !previous.sameConditions(next) -> true
  else -> next.observedAtMs - previous.observedAtMs >= WEATHER_OBSERVATION_FRESHNESS_MS
}

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `WeatherObservationRecorder`
 */
internal class WeatherObservationRecorder(
  private val dao: () -> VescapeDao,
  private val fence: DatabaseReplacementFence = DatabaseReplacementFence.process,
) {
  private var storedThisProcess = false

  fun ticket(): Long = fence.ticket()

  suspend fun record(observation: WeatherObservation, ticket: Long): Boolean =
    fence.write(ticket) {
      val stored = dao().storeWeatherObservation(observation, force = !storedThisProcess)
      storedThisProcess = true
      stored
    } ?: false
}

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `RideWeather`
 * @parity /modules/vescape-core/src/index.ts `RideWeather`
 */
data class RideWeather(
  val icon: String,
  val minTemperatureC: Int,
  val maxTemperatureC: Int,
  val maxGustKmh: Int?,
  val rainMinutes: Int,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "icon" to icon,
    "minTemperatureC" to minTemperatureC,
    "maxTemperatureC" to maxTemperatureC,
    "maxGustKmh" to maxGustKmh,
    "rainMinutes" to rainMinutes,
  )
}

/**
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `summarizeRideWeather`
 */
internal fun summarizeRideWeather(
  rows: List<WeatherObservation>,
  startMs: Long,
  endMs: Long,
): RideWeather? {
  val anchor = rows.lastOrNull { it.observedAtMs <= startMs }
    ?.takeIf { startMs - it.observedAtMs <= WEATHER_OBSERVATION_FRESHNESS_MS }
  val inside = rows.filter { it.observedAtMs in (startMs + 1)..endMs }
  val applicable = listOfNotNull(anchor) + inside
  if (applicable.isEmpty()) return null

  val weights = applicable.mapIndexed { index, row ->
    val from = maxOf(row.observedAtMs, startMs)
    val until = applicable.getOrNull(index + 1)?.observedAtMs ?: endMs
    (until - from).coerceAtLeast(0L)
  }
  val effective = if (weights.all { it == 0L }) weights.mapIndexed { i, _ -> if (i == 0) 1L else 0L } else weights

  val iconTime = linkedMapOf<WeatherIcon, Long>()
  val iconCode = mutableMapOf<WeatherIcon, Int>()
  var nightTime = 0L
  var dayTime = 0L
  var rainTime = 0L
  applicable.forEachIndexed { index, row ->
    val time = effective[index]
    val icon = weatherIcon(row.weatherCode, night = false)
    iconTime[icon] = (iconTime[icon] ?: 0L) + time
    iconCode.getOrPut(icon) { row.weatherCode }
    if (row.isDay) dayTime += time else nightTime += time
    if (icon == WeatherIcon.CLOUD_RAIN || icon == WeatherIcon.CLOUD_LIGHTNING) rainTime += time
  }
  val counted = applicable.filterIndexed { index, _ -> effective[index] > 0L }
  val dominant = iconTime.entries.maxBy { it.value }.key
  return RideWeather(
    icon = weatherIcon(iconCode.getValue(dominant), night = nightTime > dayTime).slug,
    minTemperatureC = counted.minOf { it.temperatureC },
    maxTemperatureC = counted.maxOf { it.temperatureC },
    maxGustKmh = counted.mapNotNull { it.gustKmh }.maxOrNull(),
    rainMinutes = Math.round(rainTime / 60_000.0).toInt(),
  )
}

internal suspend fun VescapeDao.rideWeather(startMs: Long, endMs: Long): RideWeather? =
  summarizeRideWeather(getWeatherObservationsSpanning(startMs, endMs).map { it.toObservation() }, startMs, endMs)
