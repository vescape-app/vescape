package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/**
 * Ride weather backfill Maintenance Job (#606) through the production Room DAO and fence.
 * @parity /modules/vescape-core/persistence-macos/RideWeatherBackfillContract.swift `runRideWeatherBackfillContract`
 */
class RideWeatherBackfillHostTest {
  private val minute = 60_000L
  private val hour = 60 * minute
  private val day = 24 * hour
  private val board = "board-a"
  /** 2024-03-10T00:00Z: a US DST change day, inside the historical forecast range. */
  private val base = 1_710_028_800_000L
  private val now = base + 365 * day

  private fun db() = Room.inMemoryDatabaseBuilder<VescapeRoomDatabase>().setDriver(BundledSQLiteDriver()).build()

  private fun frame(at: Long) = TelemetryFrameEntity(
    capturedAtMs = at, elapsedRealtimeMs = at, boardId = board, canId = null,
    flags = TELEMETRY_FLAG_KEYFRAME, changedMask1 = Int.MAX_VALUE, changedMask2 = 0,
    speedCentiKmh = 2_000, batteryVoltageMv = 80_000, motorCurrentMa = 1_000,
    batteryCurrentMa = 500, dutyPermille = 100, pitchCentiDeg = 0, rollCentiDeg = 0,
    balancePitchCentiDeg = 0, balanceCurrentMa = 0, erpm = 1_000, state = 1,
    switchState = 1, adc1Milli = 0, adc2Milli = 0, odometerCm = at,
    tempMosfetDeciC = 300, tempMotorDeciC = 300,
  )

  private fun fix(at: Long, lat: Double, accuracyCm: Int = 500) = RideTrackPointEntity(
    boardId = board, fixAtMs = at, latitudeE7 = (lat * 1e7).toInt(), longitudeE7 = 210_000_000,
    accuracyCm = accuracyCm, gpsSpeedCentiMps = 500, bearingCentiDeg = null, altitudeCm = null,
  )

  /** A ride of [length] with frames every 10 s and, unless [gps] is false, precise fixes at [lat]. */
  private suspend fun TelemetryDao.ride(start: Long, length: Long, lat: Double = 52.0, gps: Boolean = true) {
    insertFrames((start until start + length step 10_000).map(::frame))
    if (gps) insertRideTrackPoints((start until start + length step 60_000).map { fix(it, lat) })
  }

  private suspend fun TelemetryDao.summarize() = assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(this))

  /** Open-Meteo stand-in: hourly samples for the requested UTC days, temperature from the latitude. */
  private class FakeOpenMeteo(var respond: (String) -> MaintenanceHttpResponse? = { null }) : MaintenanceHttp {
    val urls = mutableListOf<String>()
    override suspend fun get(url: String): MaintenanceHttpResponse {
      urls += url
      return respond(url) ?: ok(url)
    }

    companion object {
      fun query(url: String, key: String) = url.substringAfter("$key=").substringBefore('&')
      fun ok(url: String): MaintenanceHttpResponse {
        val from = LocalDate.parse(query(url, "start_date")).atStartOfDay().toEpochSecond(ZoneOffset.UTC)
        val to = LocalDate.parse(query(url, "end_date")).atStartOfDay().toEpochSecond(ZoneOffset.UTC) + 86_400
        val times = (from until to step 3_600).toList()
        val temperature = query(url, "latitude").toDouble()
        val body = """{"hourly":{"time":[${times.joinToString()}],
          "temperature_2m":[${times.joinToString { "$temperature" }}],
          "weather_code":[${times.joinToString { "${(it / 3_600) % 2 * 3}" }}],
          "wind_gusts_10m":[${times.joinToString { "null" }}],
          "is_day":[${times.joinToString { "1" }}]}}"""
        return MaintenanceHttpResponse(200, body, null)
      }
    }
  }

  private fun scope(dao: TelemetryDao, http: MaintenanceHttp, fence: DatabaseReplacementFence = DatabaseReplacementFence(), at: Long = now) =
    MaintenanceJobScope({ dao }, fence, fence.ticket(), { at }, http = http)

  private suspend fun TelemetryDao.watermark() = parseWeatherBackfillWatermark(storedMaintenanceFingerprint(RideWeatherJob.id), RideWeatherJob.version)

  private suspend fun TelemetryDao.weather(start: Long, end: Long) = rideWeather(start, end)

  @Test fun fillsMissingDaysThenSettlesWithoutAnotherScan(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    // Midnight-crossing ride: both UTC days are candidates. A no-GPS ride is never one.
    dao.ride(base + day - 30 * minute, hour)
    dao.ride(base + 3 * day + 10 * hour, 20 * minute, gps = false)
    dao.summarize()
    val http = FakeOpenMeteo()
    val scope = scope(dao, http)
    assertTrue(RideWeatherJob.hasWork(scope, AppSettings()))
    assertEquals(MaintenanceJobOutcome.Completed, RideWeatherJob.run(scope, AppSettings()))
    assertEquals(1, http.urls.size)
    assertTrue(http.urls.single().contains("start_date=2024-03-10&end_date=2024-03-11"))
    assertTrue(http.urls.single().startsWith("https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=52.0000"))
    assertNotNull(dao.weather(base + day - 30 * minute, base + day - minute))
    assertNotNull(dao.weather(base + day, base + day + 29 * minute))
    // The first day's anchor already covers the second day under the freshness rule.
    assertEquals(listOf(base + day - hour), dao.getWeatherObservationsSpanning(Long.MIN_VALUE, Long.MAX_VALUE).map { it.observedAtMs })
    assertEquals(base + 3 * day + 10 * hour + 20 * minute - 10_000, dao.watermark()?.let { it - it % 10_000 })
    // A second launch: no history scan, no request.
    assertFalse(RideWeatherJob.hasWork(scope, AppSettings()))
    assertEquals(1, http.urls.size)
    db.close()
  }

  @Test fun usableEarlierWeatherIsEnoughAndLiveRowsWin(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    // Morning live weather covers an offline evening ride within the freshness rule.
    dao.storeWeatherObservation(WeatherObservation(base + 8 * hour, 5, 0, null, true), force = false)
    dao.ride(base + 19 * hour, 30 * minute)
    // A ride with no usable weather, where a live row lands while the request is in flight.
    dao.ride(base + 5 * day + 12 * hour, 30 * minute)
    dao.summarize()
    val live = WeatherObservation(base + 5 * day + 12 * hour, 9, 61, 20, true)
    val http = FakeOpenMeteo { runBlocking { dao.storeWeatherObservation(live, force = false) }; null }
    val scope = scope(dao, http)
    assertEquals(MaintenanceJobOutcome.Completed, RideWeatherJob.run(scope, AppSettings()))
    assertEquals(1, http.urls.size)
    assertTrue(http.urls.single().contains("start_date=2024-03-15"))
    val rows = dao.getWeatherObservationsSpanning(base + 5 * day, base + 6 * day).map { it.toObservation() }
      .filter { it.observedAtMs >= base + 5 * day }
    assertEquals(listOf(live), rows)
    db.close()
  }

  @Test fun temporaryMissesHoldTheWatermarkAndPermanentMissesSettle(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    // Two areas (A at 52°, B at 40°) on travel days; A also before the historical forecast range.
    dao.ride(base, 30 * minute, lat = 52.0)
    dao.ride(base + 2 * day, 30 * minute, lat = 40.0)
    dao.ride(base + 30 * day, 30 * minute, lat = 52.0)
    dao.summarize()
    var failB = true
    val http = FakeOpenMeteo { url ->
      when {
        failB && url.contains("latitude=40.0000") -> MaintenanceHttpResponse(503, null, null)
        url.contains("start_date=2024-04-09") -> MaintenanceHttpResponse(400, """{"error":true}""", null)
        else -> null
      }
    }
    val first = RideWeatherJob.run(scope(dao, http), AppSettings())
    assertTrue(first is MaintenanceJobOutcome.Deferred)
    assertEquals(3, http.urls.size)
    // A's first day filled, B failed: the watermark stops before B; A's later day was a permanent miss.
    assertEquals(base + 30 * minute - 10_000, dao.watermark())
    assertNotNull(dao.weather(base, base + 29 * minute))
    assertNull(dao.weather(base + 30 * day, base + 30 * day + 29 * minute))
    assertTrue("area A never fills B's travel day", dao.getWeatherObservationsSpanning(base + 2 * day, base + 3 * day).none { it.observedAtMs >= base + 2 * day })

    failB = false
    http.urls.clear()
    assertEquals(MaintenanceJobOutcome.Completed, RideWeatherJob.run(scope(dao, http), AppSettings()))
    assertEquals(2, http.urls.size)
    assertEquals(40, dao.weather(base + 2 * day, base + 2 * day + 29 * minute)?.maxTemperatureC)
    assertEquals(base + 30 * day + 30 * minute - 10_000, dao.watermark())
    // The permanent miss stays settled: no refetch on the next trigger.
    http.urls.clear()
    assertFalse(RideWeatherJob.hasWork(scope(dao, http), AppSettings()))
    assertTrue(http.urls.isEmpty())
    db.close()
  }

  @Test fun rateLimitStopsTheRunAndHonorsRetryAfter(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    dao.ride(base, 30 * minute, lat = 52.0)
    dao.ride(base + 2 * day, 30 * minute, lat = 40.0)
    dao.summarize()
    val http = FakeOpenMeteo { MaintenanceHttpResponse(429, null, 600) }
    assertEquals(MaintenanceJobOutcome.Deferred(now + 600_000), RideWeatherJob.run(scope(dao, http), AppSettings()))
    assertEquals(1, http.urls.size)
    assertNull(dao.watermark())
    // No trigger fetches before the 429 deadline.
    val early = FakeOpenMeteo()
    assertEquals(MaintenanceJobOutcome.Deferred(now + 600_000), RideWeatherJob.run(scope(dao, early), AppSettings()))
    assertTrue(early.urls.isEmpty())
    // A transport failure is temporary too, and the backoff grows.
    val later = now + 600_001
    val offline = FakeOpenMeteo { throw IOException("offline") }
    val outcome = RideWeatherJob.run(scope(dao, offline, at = later), AppSettings()) as MaintenanceJobOutcome.Deferred
    assertTrue(outcome.retryAtMs > later)
    assertEquals(MaintenanceJobOutcome.Completed, RideWeatherJob.run(scope(dao, FakeOpenMeteo(), at = later), AppSettings()))
    db.close()
  }

  @Test fun multiYearHistoryUsesBoundedWindowsAndEndpoints(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    // 2021-12-25: archive. Then one ride every five days for 60 days from 2022-01-01.
    val first = WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS
    dao.ride(first - 7 * day + 12 * hour, 20 * minute)
    for (i in 0 until 12) dao.ride(first + i * 5 * day + 12 * hour, 20 * minute)
    dao.summarize()
    val http = FakeOpenMeteo()
    assertEquals(MaintenanceJobOutcome.Completed, RideWeatherJob.run(scope(dao, http), AppSettings()))
    assertTrue(http.urls.first().startsWith("https://archive-api.open-meteo.com/v1/archive"))
    val spans = http.urls.drop(1).map {
      LocalDate.parse(FakeOpenMeteo.query(it, "start_date")) to LocalDate.parse(FakeOpenMeteo.query(it, "end_date"))
    }
    assertTrue(spans.all { (from, to) -> to.toEpochDay() - from.toEpochDay() < WEATHER_BACKFILL_WINDOW_DAYS })
    assertEquals(4, spans.size)
    db.close()
  }

  @Test fun responsesDropNullAndDuplicateSamplesInUtc(): Unit = runBlocking {
    val samples = parseWeatherBackfillHourly(
      """{"hourly":{"time":[1710054000,1710054000,1710057600,1710061200],
        "temperature_2m":[1.4,9.0,null,2.6],"weather_code":[3,3,3,61],
        "wind_gusts_10m":[12.4,null,null,null],"is_day":[1,1,1,0]}}""",
    )!!
    assertEquals(
      listOf(WeatherObservation(1_710_054_000_000, 1, 3, 10, true), WeatherObservation(1_710_061_200_000, 3, 61, null, false)),
      samples,
    )
    assertNull(parseWeatherBackfillHourly("<html>"))
    assertEquals(WeatherBackfillMiss.TEMPORARY, (classifyWeatherBackfillResponse(MaintenanceHttpResponse(200, "<html>", null)) as WeatherBackfillFetch.Failed).miss)
    assertEquals(WeatherBackfillMiss.PERMANENT, (classifyWeatherBackfillResponse(MaintenanceHttpResponse(400, null, null)) as WeatherBackfillFetch.Failed).miss)
    assertNull(parseWeatherBackfillWatermark("2|5", RideWeatherJob.version))
    assertEquals(5L, parseWeatherBackfillWatermark(weatherBackfillWatermarkValue(RideWeatherJob.version, 5), RideWeatherJob.version))
  }

  @Test fun fenceDuringFetchPreventsLateWrites(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    dao.ride(base, 30 * minute)
    dao.summarize()
    val fence = DatabaseReplacementFence()
    val http = FakeOpenMeteo { runBlocking { fence.fence { } }; null }
    var fenced = false
    try {
      RideWeatherJob.run(scope(dao, http, fence), AppSettings())
    } catch (_: MaintenanceRunFenced) {
      fenced = true
    }
    assertTrue(fenced)
    assertTrue(dao.getWeatherObservationsSpanning(Long.MIN_VALUE, Long.MAX_VALUE).isEmpty())
    assertNull(dao.watermark())
    db.close()
  }

  @Test fun activeRideIsNeverReadAndDefersToClosure(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    dao.ride(now - 20 * minute, 15 * minute)
    dao.summarize()
    val http = FakeOpenMeteo()
    val outcome = RideWeatherJob.run(scope(dao, http), AppSettings())
    assertTrue(outcome is MaintenanceJobOutcome.Deferred)
    assertTrue(http.urls.isEmpty())
    assertNull(dao.watermark())
    db.close()
  }
}
