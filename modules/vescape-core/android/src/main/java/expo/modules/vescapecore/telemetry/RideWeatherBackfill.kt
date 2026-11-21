package expo.modules.vescapecore.telemetry

import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.WeatherObservationEntity

internal const val WEATHER_BACKFILL_DAY_MS = 86_400_000L

internal const val WEATHER_BACKFILL_WINDOW_DAYS = 14

internal const val WEATHER_BACKFILL_AREA_STEPS_PER_DEG = 10.0

internal const val WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS = 1_640_995_200_000L

internal const val WEATHER_ARCHIVE_FIRST_DAY_MS = -946_771_200_000L

internal const val WEATHER_BACKFILL_RECENT_MS = 7 * WEATHER_BACKFILL_DAY_MS

internal const val WEATHER_BACKFILL_MAX_TEMPORARY_MISSES = 3
internal const val WEATHER_BACKFILL_BACKOFF_BASE_MS = 60_000L
internal const val WEATHER_BACKFILL_BACKOFF_MAX_MS = 3_600_000L

internal const val WEATHER_BACKFILL_BUCKET_PAGE = 2_000

internal const val WEATHER_BACKFILL_LOOKBACK_MS = WEATHER_BACKFILL_DAY_MS

data class WeatherBackfillCursor(val bucketFromMs: Long, val ridesAfterMs: Long)

data class WeatherBackfillRide(val startMs: Long, val endMs: Long)

data class WeatherBackfillSegment(
  val ride: Int,
  val dayMs: Long,
  val startMs: Long,
  val endMs: Long,
  val latitude: Double,
  val longitude: Double,
)

data class WeatherBackfillPage(
  val rides: List<WeatherBackfillRide>,
  val segments: List<WeatherBackfillSegment>,
  val next: WeatherBackfillCursor?,
  val activeRetryAtMs: Long?,
)

internal data class WeatherBackfillWindow(
  val latitude: Double,
  val longitude: Double,
  val firstDayMs: Long,
  val lastDayMs: Long,
  val days: Set<Long>,
  val archive: Boolean,
)

/** @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `WeatherBackfillMiss` */
internal enum class WeatherBackfillMiss { PERMANENT, TEMPORARY }

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `WeatherBackfillFetch`
 */
internal sealed class WeatherBackfillFetch {
  data class Samples(val samples: List<WeatherObservation>) : WeatherBackfillFetch()
  data class Failed(val miss: WeatherBackfillMiss, val retryAfterMs: Long? = null, val stopRun: Boolean = false) :
    WeatherBackfillFetch()
}

/** @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillWatermarkValue` */
internal fun weatherBackfillWatermarkValue(version: Int, doneThroughMs: Long) = "$version|$doneThroughMs"

internal fun parseWeatherBackfillWatermark(value: String?, version: Int): Long? {
  val parts = value?.split('|') ?: return null
  if (parts.size != 2 || parts[0].toIntOrNull() != version) return null
  return parts[1].toLongOrNull()
}

private fun floorDay(ms: Long) = Math.floorDiv(ms, WEATHER_BACKFILL_DAY_MS) * WEATHER_BACKFILL_DAY_MS

private fun saturatingMinus(value: Long, delta: Long) = if (value < Long.MIN_VALUE + delta) Long.MIN_VALUE else value - delta

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `planWeatherBackfillWindows`
 */
internal fun planWeatherBackfillWindows(segments: List<WeatherBackfillSegment>): List<WeatherBackfillWindow> {
  val representative = sortedMapOf<Long, WeatherBackfillSegment>()
  for (segment in segments.sortedWith(compareBy({ it.startMs }, { it.ride }))) {
    if (segment.dayMs >= WEATHER_ARCHIVE_FIRST_DAY_MS) representative.putIfAbsent(segment.dayMs, segment)
  }
  fun cell(value: Double) = Math.round(value * WEATHER_BACKFILL_AREA_STEPS_PER_DEG)
  val areas = representative.values.groupBy { cell(it.latitude) to cell(it.longitude) }
  val windows = mutableListOf<WeatherBackfillWindow>()
  for (days in areas.values) {
    var open = mutableListOf<WeatherBackfillSegment>()
    fun close() {
      val first = open.firstOrNull() ?: return
      windows += WeatherBackfillWindow(
        latitude = first.latitude,
        longitude = first.longitude,
        firstDayMs = first.dayMs,
        lastDayMs = open.last().dayMs,
        days = open.map { it.dayMs }.toSet(),
        archive = first.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS,
      )
      open = mutableListOf()
    }
    for (day in days) {
      val first = open.firstOrNull()
      if (first != null && (
          day.dayMs - first.dayMs >= WEATHER_BACKFILL_WINDOW_DAYS * WEATHER_BACKFILL_DAY_MS ||
            (first.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS) != (day.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS)
          )
      ) close()
      open += day
    }
    close()
  }
  return windows.sortedWith(compareBy({ it.firstDayMs }, { it.latitude }, { it.longitude }))
}

private fun utcDate(dayMs: Long) = Instant.ofEpochMilli(dayMs).atOffset(ZoneOffset.UTC).toLocalDate().toString()

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillUrl`
 */
internal fun weatherBackfillUrl(window: WeatherBackfillWindow): String {
  val base = if (window.archive) "https://archive-api.open-meteo.com/v1/archive"
  else "https://historical-forecast-api.open-meteo.com/v1/forecast"
  return base +
    String.format(Locale.ROOT, "?latitude=%.4f&longitude=%.4f", window.latitude, window.longitude) +
    "&start_date=${utcDate(window.firstDayMs)}&end_date=${utcDate(window.lastDayMs)}" +
    "&hourly=temperature_2m,weather_code,wind_gusts_10m,is_day" +
    "&timezone=GMT&timeformat=unixtime"
}

private fun JSONArray?.number(index: Int): Double? =
  (this?.opt(index) as? Number)?.toDouble()?.takeIf { it.isFinite() }

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `parseWeatherBackfillHourly`
 */
internal fun parseWeatherBackfillHourly(body: String): List<WeatherObservation>? {
  // intentional-suppression: an unparseable body is classified as a temporary miss by the caller.
  val json = runCatching { JSONObject(body) }.getOrNull() ?: return null
  val hourly = json.optJSONObject("hourly") ?: return null
  val times = hourly.optJSONArray("time") ?: return null
  val temperatures = hourly.optJSONArray("temperature_2m")
  val codes = hourly.optJSONArray("weather_code")
  val gusts = hourly.optJSONArray("wind_gusts_10m")
  val isDay = hourly.optJSONArray("is_day")
  val byTime = sortedMapOf<Long, WeatherObservation>()
  for (index in 0 until times.length()) {
    val seconds = times.number(index) ?: continue
    val temperature = temperatures.number(index) ?: continue
    val code = codes.number(index) ?: continue
    val day = isDay.number(index) ?: continue
    val at = seconds.toLong() * 1_000
    if (at in byTime) continue
    byTime[at] = WeatherObservation.normalized(at, temperature, code.toInt(), gusts.number(index), day != 0.0)
  }
  return byTime.values.toList()
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `classifyWeatherBackfillResponse`
 */
internal fun classifyWeatherBackfillResponse(response: MaintenanceHttpResponse): WeatherBackfillFetch = when {
  response.status == 429 -> WeatherBackfillFetch.Failed(
    WeatherBackfillMiss.TEMPORARY,
    retryAfterMs = response.retryAfterSeconds?.coerceAtLeast(0)?.times(1_000),
    stopRun = true,
  )
  response.status == 408 || response.status >= 500 -> WeatherBackfillFetch.Failed(WeatherBackfillMiss.TEMPORARY)
  response.status in 400..499 -> WeatherBackfillFetch.Failed(WeatherBackfillMiss.PERMANENT)
  response.status !in 200..299 -> WeatherBackfillFetch.Failed(WeatherBackfillMiss.TEMPORARY)
  else -> response.body?.let(::parseWeatherBackfillHourly)?.let { WeatherBackfillFetch.Samples(it) }
    ?: WeatherBackfillFetch.Failed(WeatherBackfillMiss.TEMPORARY)
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillRows`
 */
internal fun weatherBackfillRows(samples: List<WeatherObservation>, startMs: Long, endMs: Long): List<WeatherObservation> {
  val anchor = samples.lastOrNull { it.observedAtMs <= startMs }
    ?.takeIf { startMs - it.observedAtMs <= WEATHER_OBSERVATION_FRESHNESS_MS }
  val rows = mutableListOf<WeatherObservation>()
  for (sample in listOfNotNull(anchor) + samples.filter { it.observedAtMs in (startMs + 1)..endMs }) {
    if (shouldStoreWeatherObservation(rows.lastOrNull(), sample, force = false)) rows += sample
  }
  return rows
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillPage`
 */
internal suspend fun VescapeDao.weatherBackfillPageImpl(
  cursor: WeatherBackfillCursor,
  nowMs: Long,
  gapMs: Long,
): WeatherBackfillPage {
  val active = activeRideStartMs(nowMs, gapMs)
  val activeRetryAtMs = active?.let { lastSampleAtOrBefore(nowMs)?.plus(gapMs) }
  val beforeMs = active?.let { Math.floorDiv(it, TELEMETRY_BUCKET_SIZE_MS) * TELEMETRY_BUCKET_SIZE_MS } ?: Long.MAX_VALUE
  val buckets = getWeatherBackfillBuckets(cursor.bucketFromMs, beforeMs, WEATHER_BACKFILL_BUCKET_PAGE)
  if (buckets.isEmpty()) return WeatherBackfillPage(emptyList(), emptyList(), null, activeRetryAtMs)
  val markers = getMarkers(buckets.minOf { it.firstSampleAtMs } - gapMs, buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS, null)
  val grouped = groupRideSessions(buckets, markers, gapMs)
  val hasMore = buckets.size == WEATHER_BACKFILL_BUCKET_PAGE
  val (kept, next) = when {
    !hasMore -> grouped to null
    grouped.size > 1 -> grouped.dropLast(1) to WeatherBackfillCursor(grouped.last().firstBucketStartMs, cursor.ridesAfterMs)
    else -> grouped to WeatherBackfillCursor(
      buckets.last().bucketStartMs + TELEMETRY_BUCKET_SIZE_MS,
      maxOf(cursor.ridesAfterMs, grouped.single().endAtMs),
    )
  }
  val rides = kept.filter { it.endAtMs > cursor.ridesAfterMs }.sortedBy { it.endAtMs }
  val segments = mutableListOf<WeatherBackfillSegment>()
  rides.forEachIndexed { index, ride ->
    if (ride.avgSpeedSampleCount == 0) return@forEachIndexed
    var day = floorDay(ride.startAtMs)
    while (day <= ride.endAtMs) {
      val start = maxOf(ride.startAtMs, day)
      val end = minOf(ride.endAtMs, day + WEATHER_BACKFILL_DAY_MS - 1)
      if (rideWeather(start, end) == null) {
        getFirstPreciseRideTrackFix(start, end, RIDE_TRACK_PRECISE_ACCURACY_CM)?.let {
          segments += WeatherBackfillSegment(index, day, start, end, it.latitudeE7 / 1e7, it.longitudeE7 / 1e7)
        }
      }
      day += WEATHER_BACKFILL_DAY_MS
    }
  }
  return WeatherBackfillPage(rides.map { WeatherBackfillRide(it.startAtMs, it.endAtMs) }, segments, next, activeRetryAtMs)
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `storeWeatherBackfill`
 */
internal suspend fun VescapeDao.storeWeatherBackfillImpl(
  segments: List<WeatherBackfillSegment>,
  samples: List<WeatherObservation>,
): List<Boolean> = segments.map { segment ->
  if (rideWeather(segment.startMs, segment.endMs) != null) return@map true
  for (row in weatherBackfillRows(samples, segment.startMs, segment.endMs)) {
    insertWeatherObservation(WeatherObservationEntity.of(row))
  }
  rideWeather(segment.startMs, segment.endMs) != null
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `RideWeatherJob`
 */
internal object RideWeatherJob : MaintenanceJob {
  override val id = "rideWeather"
  override val version = 1
  override val requiresNetwork = true
  override val inputKeys = emptySet<String>()

  private var failedRuns = 0

  private var rateLimitedUntilMs = Long.MIN_VALUE

  override fun inputs(settings: AppSettings) = ""

  override suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean =
    pass(scope, settings, fetch = false) != MaintenanceJobOutcome.Completed

  override suspend fun begin(scope: MaintenanceJobScope, settings: AppSettings) = Unit

  override suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) = Unit

  override suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome =
    if (scope.nowMs() < rateLimitedUntilMs) MaintenanceJobOutcome.Deferred(rateLimitedUntilMs)
    else pass(scope, settings, fetch = true)

  private suspend fun pass(scope: MaintenanceJobScope, settings: AppSettings, fetch: Boolean): MaintenanceJobOutcome {
    val gapMs = settings.rideSplitGapMinutes * 60_000L
    val stored = scope.chunk { dao -> dao.storedMaintenanceFingerprint(id) }
    val start = parseWeatherBackfillWatermark(stored, version) ?: Long.MIN_VALUE
    var watermark = start
    var cursor: WeatherBackfillCursor? = WeatherBackfillCursor(saturatingMinus(start, WEATHER_BACKFILL_LOOKBACK_MS), start)
    var blocked = false
    var temporaryMisses = 0
    var retryAfterMs: Long? = null
    var stopped = false
    var rateLimited = false
    var activeRetryAtMs: Long? = null
    var done = 0
    var total = 0
    while (cursor != null) {
      val page = scope.chunk { it.weatherBackfillPage(cursor!!, scope.nowMs(), gapMs) }
      activeRetryAtMs = page.activeRetryAtMs
      if (!fetch && page.segments.isNotEmpty()) {
        val firstPending = page.segments.minOf { it.ride }
        watermark = settle(page.rides.take(firstPending), watermark)
        if (watermark != start) scope.chunk { publish(it, watermark, scope.nowMs()) }
        return MaintenanceJobOutcome.Deferred(scope.nowMs())
      }
      val resolved = BooleanArray(page.segments.size)
      total += page.segments.size
      scope.progress(done, total)
      page.segments.forEachIndexed { index, segment ->
        if (segment.dayMs < WEATHER_ARCHIVE_FIRST_DAY_MS) resolved[index] = true
      }
      for (window in planWeatherBackfillWindows(page.segments)) {
        val members = page.segments.indices.filter { page.segments[it].dayMs in window.days }
        if (stopped) continue
        val fetched = try {
          classifyWeatherBackfillResponse(scope.http.get(weatherBackfillUrl(window)))
        } catch (_: IOException) {
          WeatherBackfillFetch.Failed(WeatherBackfillMiss.TEMPORARY)
        }
        when (fetched) {
          is WeatherBackfillFetch.Samples -> {
            val segments = members.map { page.segments[it] }
            val filled = scope.chunk { it.storeWeatherBackfill(segments, fetched.samples) }
            scope.committed()
            members.forEachIndexed { i, index ->
              val segment = page.segments[index]
              resolved[index] = filled[i] || scope.nowMs() - segment.endMs >= WEATHER_BACKFILL_RECENT_MS
              if (!resolved[index]) temporaryMisses++
            }
          }
          is WeatherBackfillFetch.Failed -> {
            if (fetched.miss == WeatherBackfillMiss.PERMANENT) {
              members.forEach { resolved[it] = true }
            } else {
              temporaryMisses++
              fetched.retryAfterMs?.let { retryAfterMs = maxOf(retryAfterMs ?: 0, it) }
              if (fetched.stopRun) {
                stopped = true
                rateLimited = true
              }
            }
          }
        }
        if (temporaryMisses >= WEATHER_BACKFILL_MAX_TEMPORARY_MISSES) stopped = true
        done += members.size
        scope.progress(done, total)
      }
      if (!blocked) {
        val unresolvedRides = page.segments.filterIndexed { index, _ -> !resolved[index] }.map { it.ride }.toSet()
        val firstUnresolved = unresolvedRides.minOrNull()
        val settled = settle(page.rides.take(firstUnresolved ?: page.rides.size), watermark)
        if (settled != watermark) {
          watermark = settled
          scope.chunk { publish(it, watermark, scope.nowMs()) }
        }
        blocked = firstUnresolved != null
      }
      if (blocked && stopped) break
      cursor = page.next
    }
    if (!fetch) return if (activeRetryAtMs != null) MaintenanceJobOutcome.Deferred(activeRetryAtMs) else MaintenanceJobOutcome.Completed
    if (!blocked) {
      failedRuns = 0
      rateLimitedUntilMs = Long.MIN_VALUE
    }
    return when {
      blocked -> {
        failedRuns++
        val backoff = minOf(WEATHER_BACKFILL_BACKOFF_BASE_MS shl minOf(failedRuns - 1, 20), WEATHER_BACKFILL_BACKOFF_MAX_MS)
        val retryAtMs = scope.nowMs() + maxOf(backoff, retryAfterMs ?: 0)
        if (rateLimited) rateLimitedUntilMs = retryAtMs
        MaintenanceJobOutcome.Deferred(retryAtMs)
      }
      activeRetryAtMs != null -> MaintenanceJobOutcome.Deferred(activeRetryAtMs)
      else -> MaintenanceJobOutcome.Completed
    }
  }

  private fun settle(rides: List<WeatherBackfillRide>, watermark: Long): Long =
    rides.fold(watermark) { mark, ride -> maxOf(mark, ride.endMs) }

  private suspend fun publish(dao: VescapeDao, doneThroughMs: Long, nowMs: Long) =
    dao.publishMaintenanceFingerprint(id, weatherBackfillWatermarkValue(version, doneThroughMs), nowMs)
}
