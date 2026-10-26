package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.weather.WeatherIcon
import expo.modules.vescapecore.weather.weatherIcon
import kotlin.math.roundToInt

/**
 * How long one stored Weather Observation keeps describing the weather when nothing changed. A
 * live refresh with unchanged conditions writes a fresh row once the last one is this old, and a
 * ride whose only applicable row is older than this has no weather.
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `weatherObservationFreshnessMs`
 */
internal const val WEATHER_OBSERVATION_FRESHNESS_MS = 24 * 60 * 60 * 1_000L

/**
 * Earliest observation a Favorite starting at [startMs] may read; saturates for the protect-all range.
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `weatherProtectionStart`
 */
internal fun weatherProtectionStart(startMs: Long): Long =
  if (startMs < Long.MIN_VALUE + WEATHER_OBSERVATION_FRESHNESS_MS) Long.MIN_VALUE
  else startMs - WEATHER_OBSERVATION_FRESHNESS_MS

/** Gusts are stored at this granularity so forecast noise does not read as a condition change. */
private const val GUST_STEP_KMH = 5

/**
 * One stored, normalized observation of current conditions (`weather_observations`). Weather
 * belongs to time, not to a Board or ride, and carries no coordinates so Privacy Zones stay out of
 * it. Condition equality deliberately ignores [observedAtMs].
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
     * Normalize raw Open-Meteo current conditions. Live refreshes and the history backfill both go
     * through here, so the two writers can never disagree about what "unchanged" means.
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
 * Whether [next] earns a row after [previous], the newest stored row at or before it. An identical
 * timestamp is the same observation (a cached or repeated API answer) and never renews freshness.
 * [force] is the first successful refresh of the process.
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
 * The write seam for every observation writer: live refreshes now, the history backfill later.
 * Holds the "first successful refresh after launch" flag, so one instance lives per process.
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `WeatherObservationRecorder`
 */
internal class WeatherObservationRecorder(
  private val dao: () -> TelemetryDao,
  private val fence: DatabaseReplacementFence = DatabaseReplacementFence.process,
) {
  private var storedThisProcess = false

  fun ticket(): Long = fence.ticket()

  /** True when a row was written; false when unchanged, a duplicate, or fenced off. */
  suspend fun record(observation: WeatherObservation, ticket: Long): Boolean =
    fence.write(ticket) {
      val stored = dao().storeWeatherObservation(observation, force = !storedThisProcess)
      storedThisProcess = true
      stored
    } ?: false
}

/**
 * Weather of one ride or Favorite, folded natively from the rows in effect across `[start, end]`.
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
 * Fold observations into the weather of `[startMs, endMs]`. [rows] may be a superset sorted by
 * time (one query per History page); the ride uses the last row at or before its start plus every
 * row inside it, each in effect until the next row or the ride end. A start row older than
 * [WEATHER_OBSERVATION_FRESHNESS_MS] is not applicable. The icon is the time-dominant one, night
 * when most of the covered time was night. Classification is the native `weatherIcon()`.
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
  // A zero-length range still has the weather in effect at that instant.
  val effective = if (weights.all { it == 0L }) weights.mapIndexed { i, _ -> if (i == 0) 1L else 0L } else weights

  // Keyed by the day form so a ride crossing sunset still counts one condition; each icon keeps the
  // first code that produced it so the night form comes from the same `weatherIcon()` rule.
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

/** Rows bounding a span, per the ride weather read query. Shared by History pages and Favorites. */
internal suspend fun TelemetryDao.rideWeather(startMs: Long, endMs: Long): RideWeather? =
  summarizeRideWeather(getWeatherObservationsSpanning(startMs, endMs).map { it.toObservation() }, startMs, endMs)
