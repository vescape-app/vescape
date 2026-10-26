package expo.modules.vescapecore.telemetry

import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

// Ride weather backfill (#606): hourly Open-Meteo history for past ride days without usable weather.
// Every constant and rule below is mirrored in RideWeatherBackfill.swift.

/** Candidate keys, batching and insertion bounds use UTC calendar days. */
internal const val WEATHER_BACKFILL_DAY_MS = 86_400_000L

/** Longest date range one request covers. A network work bound, not a resume cursor. */
internal const val WEATHER_BACKFILL_WINDOW_DAYS = 14

/** Days whose representative fixes round to the same 0.1° cell share requests. */
internal const val WEATHER_BACKFILL_AREA_STEPS_PER_DEG = 10.0

/**
 * 2022-01-01T00:00Z. The historical forecast endpoint is complete from here for every model it
 * blends; earlier days are fetched from the ERA5 reanalysis archive instead.
 */
internal const val WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS = 1_640_995_200_000L

/** 1940-01-01T00:00Z, where the ERA5 archive starts. Older days are a permanent miss. */
internal const val WEATHER_ARCHIVE_FIRST_DAY_MS = -946_771_200_000L

/** A day this close to now with no data may still be published: a temporary miss, not a permanent one. */
internal const val WEATHER_BACKFILL_RECENT_MS = 7 * WEATHER_BACKFILL_DAY_MS

/** Temporary misses one run tolerates before it stops requesting and backs off. */
internal const val WEATHER_BACKFILL_MAX_TEMPORARY_MISSES = 3
internal const val WEATHER_BACKFILL_BACKOFF_BASE_MS = 60_000L
internal const val WEATHER_BACKFILL_BACKOFF_MAX_MS = 3_600_000L

/** Buckets one scan page reads. */
internal const val WEATHER_BACKFILL_BUCKET_PAGE = 2_000

/** A ride overlapping the watermark is re-read from this far before it. */
internal const val WEATHER_BACKFILL_LOOKBACK_MS = WEATHER_BACKFILL_DAY_MS

/** Where one scan page starts: buckets from [bucketFromMs], rides ending after [ridesAfterMs]. */
data class WeatherBackfillCursor(val bucketFromMs: Long, val ridesAfterMs: Long)

/** One closed derived ride after the watermark. */
data class WeatherBackfillRide(val startMs: Long, val endMs: Long)

/**
 * The part of one ride on one UTC day that has no usable weather but has a precise fix: what
 * the backfill fetches. [latitude]/[longitude] is the segment's first precise fix.
 */
data class WeatherBackfillSegment(
  val ride: Int,
  val dayMs: Long,
  val startMs: Long,
  val endMs: Long,
  val latitude: Double,
  val longitude: Double,
)

/**
 * One bounded scan page. [next] is null once no closed ride is left; [activeRetryAtMs] is set while
 * a potentially active ride exists, which the scan never reads.
 */
data class WeatherBackfillPage(
  val rides: List<WeatherBackfillRide>,
  val segments: List<WeatherBackfillSegment>,
  val next: WeatherBackfillCursor?,
  val activeRetryAtMs: Long?,
)

/** One request: an area's assigned days within one bounded window and one endpoint. */
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
 * What one window request came back as. Kept apart from the live weather transport, which collapses
 * every failure to null and could not tell a permanent miss from a retry.
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `WeatherBackfillFetch`
 */
internal sealed class WeatherBackfillFetch {
  data class Samples(val samples: List<WeatherObservation>) : WeatherBackfillFetch()
  data class Failed(val miss: WeatherBackfillMiss, val retryAfterMs: Long? = null, val stopRun: Boolean = false) :
    WeatherBackfillFetch()
}

/** @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillWatermarkValue` */
internal fun weatherBackfillWatermarkValue(version: Int, doneThroughMs: Long) = "$version|$doneThroughMs"

/** The stored watermark of [version], or null when absent, unreadable or of another version. */
internal fun parseWeatherBackfillWatermark(value: String?, version: Int): Long? {
  val parts = value?.split('|') ?: return null
  if (parts.size != 2 || parts[0].toIntOrNull() != version) return null
  return parts[1].toLongOrNull()
}

private fun floorDay(ms: Long) = Math.floorDiv(ms, WEATHER_BACKFILL_DAY_MS) * WEATHER_BACKFILL_DAY_MS

private fun saturatingMinus(value: Long, delta: Long) = if (value < Long.MIN_VALUE + delta) Long.MIN_VALUE else value - delta

/**
 * Group candidate days into requests: one representative fix per day (the day's first precise fix),
 * days grouped by 0.1° area, each area split into windows of at most [WEATHER_BACKFILL_WINDOW_DAYS]
 * that never mix endpoints. Days before the archive are left out; they are permanent misses.
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
 * Open-Meteo request for one window: hourly values on UTC days, timestamps as epoch seconds so no
 * offset (and no DST boundary) is ever applied by hand.
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
 * Hourly samples of a backfill response, sorted, one per timestamp. A sample missing its
 * temperature, code or day flag is dropped rather than read as zero-valued weather; a missing gust
 * stays null. Null for a body that is not the expected shape.
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
 * Classify one window response. Retryable: transport failure, 408, 429 (stops the run, honoring
 * Retry-After), 5xx and an unparseable 200. Any other 4xx is a validated, permanent rejection.
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
 * Rows the backfill stores for `[startMs, endMs]`: the last sample at or before the start (when
 * still fresh) and every sample inside, change-only against the previous sample of the same series,
 * with the live freshness renewal. Neither the newest database row nor other days are consulted, so
 * request order never changes what is stored.
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
 * One scan page in one read transaction: closed derived rides from [cursor], with the segments that
 * still lack usable weather (#604's read and freshness rule) and have a precise fix. Never reads
 * into the potentially active ride.
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `weatherBackfillPage`
 */
internal suspend fun TelemetryDao.weatherBackfillPageImpl(
  cursor: WeatherBackfillCursor,
  nowMs: Long,
  gapMs: Long,
): WeatherBackfillPage {
  val active = activeRideStartMs(nowMs, gapMs)
  val activeRetryAtMs = active?.let { listOfNotNull(lastFrameAt(), lastRideTrackAt()).maxOrNull()?.plus(gapMs) }
  val beforeMs = active?.let { Math.floorDiv(it, TELEMETRY_BUCKET_SIZE_MS) * TELEMETRY_BUCKET_SIZE_MS } ?: Long.MAX_VALUE
  val buckets = getWeatherBackfillBuckets(cursor.bucketFromMs, beforeMs, WEATHER_BACKFILL_BUCKET_PAGE)
  if (buckets.isEmpty()) return WeatherBackfillPage(emptyList(), emptyList(), null, activeRetryAtMs)
  val markers = getMarkers(buckets.minOf { it.firstSampleAtMs } - gapMs, buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS, null)
  val grouped = groupRideSessions(buckets, markers, gapMs)
  val hasMore = buckets.size == WEATHER_BACKFILL_BUCKET_PAGE
  // The last ride of a full page may continue on the next one, so it is read again there in full.
  val (kept, next) = when {
    !hasMore -> grouped to null
    grouped.size > 1 -> grouped.dropLast(1) to WeatherBackfillCursor(grouped.last().firstBucketStartMs, cursor.ridesAfterMs)
    else -> grouped to WeatherBackfillCursor(
      buckets.last().bucketStartMs + TELEMETRY_BUCKET_SIZE_MS,
      maxOf(cursor.ridesAfterMs, grouped.single().endAtMs),
    )
  }
  // Stationary sessions are settled with the rest; only moving rides get weather.
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
 * Store one window's samples for its segments in one write transaction. Eligibility is checked
 * again here, so live observations committed while the request was in flight win. True per
 * segment when it now has usable weather.
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `storeWeatherBackfill`
 */
internal suspend fun TelemetryDao.storeWeatherBackfillImpl(
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
 * Ride weather: fills `weather_observations` for past ride days that have none, from Open-Meteo
 * hourly history. Its done state is a watermark, `version|doneThroughMs` in `app_settings`: rides
 * ending at or before it are settled and never read again, and every trigger only scans closed
 * rides after it. The watermark never passes an unresolved temporary miss or the active ride.
 * @parity /modules/vescape-core/ios/telemetry/RideWeatherBackfill.swift `RideWeatherJob`
 */
internal object RideWeatherJob : MaintenanceJob {
  override val id = "rideWeather"
  override val version = 1
  override val requiresNetwork = true
  override val inputKeys = emptySet<String>()

  /** Consecutive runs that ended on a temporary miss, for the backoff. Maintenance thread only. */
  private var failedRuns = 0

  /** A 429 deadline: no trigger fetches before it, network back included. Maintenance thread only. */
  private var rateLimitedUntilMs = Long.MIN_VALUE

  override fun inputs(settings: AppSettings) = ""

  /** Settles every ride before the first one needing a fetch; stale only when one exists. */
  override suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean =
    pass(scope, settings, fetch = false) != MaintenanceJobOutcome.Completed

  /** The watermark is the done state; a partial run keeps what it settled. */
  override suspend fun begin(scope: MaintenanceJobScope, settings: AppSettings) = Unit

  override suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) = Unit

  override suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome =
    if (scope.nowMs() < rateLimitedUntilMs) MaintenanceJobOutcome.Deferred(rateLimitedUntilMs)
    else pass(scope, settings, fetch = true)

  /**
   * One pass from the watermark. Without [fetch] it stops at the first segment needing weather and
   * reports the job stale. Completed means every closed ride is settled.
   */
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
              // No data for a day the provider may not have published yet is retried, not settled.
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

  private suspend fun publish(dao: TelemetryDao, doneThroughMs: Long, nowMs: Long) =
    dao.publishMaintenanceFingerprint(id, weatherBackfillWatermarkValue(version, doneThroughMs), nowMs)
}
