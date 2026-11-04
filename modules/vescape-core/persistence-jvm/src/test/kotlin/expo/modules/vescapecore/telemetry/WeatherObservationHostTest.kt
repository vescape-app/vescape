package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import expo.modules.vescapecore.weather.parseOpenMeteoWeather
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeRoomDatabase
import expo.modules.vescapecore.database.WeatherObservationEntity

/**
 * Ride weather storage (#604) through the production Room DAO, recorder and fence.
 * @parity /modules/vescape-core/persistence-macos/WeatherObservationContract.swift `runWeatherObservationContract`
 */
class WeatherObservationHostTest {
  private val hour = 3_600_000L
  private val day = 24 * hour

  private fun obs(at: Long, temp: Int = 14, code: Int = 3, gust: Int? = 20, isDay: Boolean = true) =
    WeatherObservation(at, temp, code, gust, isDay)

  private fun withDb(block: suspend (path: String, open: () -> VescapeRoomDatabase) -> Unit): Unit = runBlocking {
    val path = Files.createTempFile("vescape-weather", ".db")
    Files.deleteIfExists(path)
    block(path.toString()) { Room.databaseBuilder<VescapeRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build() }
    Files.deleteIfExists(path)
  }

  @Test fun launchRefreshWritesThenOnlyChangesAndFreshnessDo(): Unit = withDb { _, open ->
    var db = open()
    val first = WeatherObservationRecorder({ db.vescapeDao() }, DatabaseReplacementFence())
    assertTrue("first refresh after launch", first.record(obs(0), first.ticket()))
    assertFalse("unchanged an hour later", first.record(obs(hour), first.ticket()))
    assertFalse("unchanged just under a day", first.record(obs(day - 1), first.ticket()))
    assertTrue("changed conditions write at once", first.record(obs(day - 1 + hour, temp = 15), first.ticket()))
    assertFalse(first.record(obs(2 * day, temp = 15), first.ticket()))
    assertTrue("a day after the last stored row", first.record(obs(2 * day - 1 + hour, temp = 15), first.ticket()))
    db.close()

    // A new process: its first refresh writes even when nothing changed, then the rules resume.
    db = open()
    val relaunched = WeatherObservationRecorder({ db.vescapeDao() }, DatabaseReplacementFence())
    assertTrue(relaunched.record(obs(2 * day + 2 * hour, temp = 15), relaunched.ticket()))
    assertFalse(relaunched.record(obs(2 * day + 3 * hour, temp = 15), relaunched.ticket()))
    assertEquals(4, db.vescapeDao().getWeatherObservationsSpanning(0, 10 * day).size)
    db.close()
  }

  @Test fun repeatedApiTimestampNeverRenewsOrDuplicates(): Unit = withDb { _, open ->
    val db = open()
    val recorder = WeatherObservationRecorder({ db.vescapeDao() }, DatabaseReplacementFence())
    assertTrue(recorder.record(obs(0), recorder.ticket()))
    assertFalse("same observation, new conditions", recorder.record(obs(0, temp = 30), recorder.ticket()))
    assertFalse(recorder.record(obs(day - hour), recorder.ticket()))
    assertFalse("cached answer a day later", recorder.record(obs(day - hour), recorder.ticket()))
    val rows = db.vescapeDao().getWeatherObservationsSpanning(0, 10 * day)
    assertEquals(listOf(0L), rows.map { it.observedAtMs })
    assertEquals(14, rows.single().temperatureC)
    db.close()
  }

  @Test fun failedRefreshManufacturesNothing() {
    assertNull(parseOpenMeteoWeather("not json", 0.0, 0.0, 0L)?.observation())
    val noTime = """{"utc_offset_seconds":0,"current":{"temperature_2m":12.4,"weather_code":3}}"""
    assertNull("no observation time, no row", parseOpenMeteoWeather(noTime, 0.0, 0.0, 99L)!!.observation())
    val body = """{"utc_offset_seconds":3600,"current":{"time":"2026-10-25T14:00","temperature_2m":12.6,"weather_code":61,"wind_gusts_10m":23.0,"is_day":0}}"""
    val observation = parseOpenMeteoWeather(body, 0.0, 0.0, 99L)!!.observation()!!
    assertEquals(WeatherObservation(1_792_933_200_000L, 13, 61, 25, false), observation)
  }

  @Test fun restoreOrClearFencesALateWrite(): Unit = withDb { _, open ->
    val db = open()
    val fence = DatabaseReplacementFence()
    val recorder = WeatherObservationRecorder({ db.vescapeDao() }, fence)
    val staleTicket = recorder.ticket()
    fence.fence { db.vescapeDao().clearAll() }
    assertFalse("landed before the clear, written after", recorder.record(obs(0), staleTicket))
    assertTrue(db.vescapeDao().getWeatherObservationsSpanning(0, day).isEmpty())
    assertTrue("the fenced write did not use up the launch write", recorder.record(obs(hour), recorder.ticket()))
    db.close()
  }

  @Test fun clearKeepsTheRowsAFavoriteReads(): Unit = withDb { _, open ->
    val db = open()
    val dao = db.vescapeDao()
    for (at in listOf(0L, 10 * day, 20 * day + 1, 21 * day, 30 * day)) dao.insertWeatherObservation(WeatherObservationEntity.of(obs(at)))
    dao.clearExcept(listOf(TelemetryTimeRange(21 * day, 22 * day)))
    assertEquals(listOf(20 * day + 1, 21 * day), dao.getWeatherObservationsSpanning(0, 40 * day).map { it.observedAtMs })
    // The protect-all fallback range must not wrap and delete everything.
    dao.clearExcept(listOf(TelemetryTimeRange(Long.MIN_VALUE, Long.MAX_VALUE)))
    assertEquals(2, dao.getWeatherObservationsSpanning(0, 40 * day).size)
    db.close()
  }

  @Test fun rideWeatherReadsTheApplicableRows(): Unit = withDb { _, open ->
    val db = open()
    val dao = db.vescapeDao()
    // Sun all along, five minutes of rain inside a two-hour ride.
    dao.insertWeatherObservation(WeatherObservationEntity.of(obs(0, temp = 8, code = 0, gust = 15)))
    dao.insertWeatherObservation(WeatherObservationEntity.of(obs(hour, temp = 20, code = 61, gust = 40)))
    dao.insertWeatherObservation(WeatherObservationEntity.of(obs(hour + 5 * 60_000, temp = 19, code = 0, gust = 10)))
    val weather = dao.rideWeather(30 * 60_000, 2 * hour + 30 * 60_000)!!
    assertEquals(RideWeather("sun", 8, 20, 40, 5), weather)
    // Only a row older than a day applies at the start, and nothing changes inside: no weather.
    assertNull(dao.rideWeather(3 * day, 3 * day + hour))
    db.close()
  }

  @Test fun summaryIsTimeWeightedWithNightAndStaleAnchor() {
    val rows = listOf(obs(0, code = 1, isDay = false), obs(hour, code = 2, isDay = false), obs(2 * hour, code = 0, isDay = true))
    assertEquals("cloud-moon", summarizeRideWeather(rows, 0, 2 * hour + 10 * 60_000)!!.icon)
    val stale = listOf(obs(0, temp = 2), obs(2 * day, temp = 9))
    val weather = summarizeRideWeather(stale, day + hour, 2 * day + hour)!!
    assertEquals("stale start row is ignored", 9 to 9, weather.minTemperatureC to weather.maxTemperatureC)
    assertEquals(14, summarizeRideWeather(listOf(obs(0)), hour, hour)!!.minTemperatureC)
  }
}
