package expo.modules.vescapecore.weather

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private const val FORECAST_JSON = """
{
  "current": {
    "time": "2026-06-10T22:00",
    "temperature_2m": 17.6,
    "weather_code": 0,
    "precipitation_probability": 40
  },
  "hourly": {
    "time": ["2026-06-10T22:00", "2026-06-10T23:00", "2026-06-11T05:00"],
    "temperature_2m": [17.6, 16.4, 12.2],
    "weather_code": [0, 61, 3],
    "precipitation_probability": [40, 80, null]
  },
  "daily": { "sunrise": ["2026-06-10T04:30"], "sunset": ["2026-06-10T21:15"] }
}
"""

/**
 * Forecast parsing: the classification a rider actually sees (day vs night glyph), the timezone-free
 * hour handling, and the refusal to publish a forecast that has no usable current conditions.
 * @parity /modules/vescape-core/ios/weather/WeatherTests.swift
 */
class WeatherTest {
  @Test
  fun `resolves the night glyph from the forecast's own sun times`() {
    val weather = parseOpenMeteoWeather(FORECAST_JSON, 52.2, 21.0, fetchedAtMs = 1_000)!!

    // 22:00 is after a 21:15 sunset, so a clear sky is a moon and not a sun.
    assertEquals(WeatherIcon.MOON, weather.icon)
    assertEquals(18, weather.temperatureC)
    assertEquals(40, weather.precipitationProbability)
    assertEquals("Clear sky", weather.label)
  }

  @Test
  fun `keeps forecast hours in API order as local minutes`() {
    val hours = parseOpenMeteoWeather(FORECAST_JSON, 52.2, 21.0, fetchedAtMs = 1_000)!!.hourly

    assertEquals(listOf(22 * 60, 23 * 60, 5 * 60), hours.map { it.minuteOfDay })
    assertEquals(listOf(18, 16, 12), hours.map { it.temperatureC })
    // Rain looks the same at every hour; the pre-sunrise overcast hour is still a plain cloud.
    assertEquals(
        listOf(WeatherIcon.MOON, WeatherIcon.CLOUD_RAIN, WeatherIcon.CLOUD),
        hours.map { it.icon },
    )
    // A null probability is "no chance stated", which renders as 0 rather than as a gap.
    assertEquals(0, hours[2].precipitationProbability)
  }

  @Test
  fun `carries the day's sun times as local minutes`() {
    val weather = parseOpenMeteoWeather(FORECAST_JSON, 52.2, 21.0, fetchedAtMs = 1_000)!!

    assertEquals(4 * 60 + 30, weather.sunriseMinuteOfDay)
    assertEquals(21 * 60 + 15, weather.sunsetMinuteOfDay)
  }

  @Test
  fun `drops hours whose parallel arrays ran short instead of inventing values`() {
    val json = """
      {
        "current": {"time":"2026-06-10T12:00","temperature_2m":20.0,"weather_code":3},
        "hourly": {
          "time": ["2026-06-10T12:00", "2026-06-10T13:00", "2026-06-10T14:00"],
          "temperature_2m": [20.0, null],
          "weather_code": [3]
        }
      }
    """
    val hours = parseOpenMeteoWeather(json, 0.0, 0.0, fetchedAtMs = 1_000)!!.hourly

    // Only the first hour has every required field. A missing code would otherwise read as 0 — a
    // clear sky — and a missing temperature as 0 °C, both indistinguishable from real weather.
    assertEquals(listOf(12 * 60), hours.map { it.minuteOfDay })
    assertEquals(20, hours.single().temperatureC)
  }

  @Test
  fun `refuses a payload without usable current conditions`() {
    assertNull(parseOpenMeteoWeather("""{"hourly":{"time":[]}}""", 0.0, 0.0, 1_000))
    assertNull(parseOpenMeteoWeather("not json", 0.0, 0.0, 1_000))
    assertNull(
        parseOpenMeteoWeather("""{"current":{"temperature_2m":12.0}}""", 0.0, 0.0, 1_000),
    )
  }

  @Test
  fun `falls back to a fixed night window when the forecast omits sun times`() {
    val json = """{"current":{"time":"2026-06-10T23:00","temperature_2m":9.0,"weather_code":0}}"""
    val weather = parseOpenMeteoWeather(json, 0.0, 0.0, fetchedAtMs = 1_000)!!

    assertEquals(WeatherIcon.MOON, weather.icon)
    assertNull(weather.sunriseMinuteOfDay)
  }

  @Test
  fun `builds absolute period-start slots across local midnight`() {
    // 23:00 local at UTC+2; the window runs into the next day.
    val json = """
      {
        "utc_offset_seconds": 7200,
        "current": {"time":"2026-06-10T23:00","temperature_2m":15.0,"weather_code":61},
        "hourly": {
          "time": ["2026-06-11T00:00", "2026-06-11T01:00"],
          "temperature_2m": [15.0, 14.0],
          "weather_code": [61, 63],
          "precipitation_probability": [60, null],
          "precipitation": [1.2, 3.0],
          "wind_gusts_10m": [30.5, null]
        },
        "minutely_15": {
          "time": ["2026-06-10T23:15", "2026-06-10T23:30", "2026-06-10T23:45"],
          "precipitation": [0.5, null, 0.1],
          "weather_code": [61, 61, 61],
          "wind_gusts_10m": [20.0, 21.0, 22.0]
        }
      }
    """
    val weather = parseOpenMeteoWeather(json, 0.0, 0.0, fetchedAtMs = 1_000)!!
    val midnightUtcMs = 1_781_128_800_000L // 2026-06-10T22:00Z = 2026-06-11T00:00+02:00

    assertEquals(listOf(midnightUtcMs - 3_600_000, midnightUtcMs), weather.hourlySlots.map { it.startMs })
    assertEquals(midnightUtcMs, weather.hourlySlots[0].endMs)
    assertEquals(60, weather.hourlySlots[0].precipitationProbability)
    assertNull(weather.hourlySlots[1].precipitationProbability)
    assertEquals(3.0, weather.hourlySlots[1].precipitationMmPerHour, 1e-9)
    // A quarter-hour value is mm per 15 min; the null one is dropped, not read as dry.
    assertEquals(listOf(2.0, 0.4), weather.quarterHourSlots.map { it.precipitationMmPerHour })
    assertEquals(midnightUtcMs - 60 * 60_000, weather.quarterHourSlots[0].startMs)
    assertNull(weather.quarterHourSlots[0].precipitationProbability)
  }

  @Test
  fun `has no alert slots without a UTC offset to anchor them`() {
    val json = """
      {
        "current": {"time":"2026-06-10T12:00","temperature_2m":20.0,"weather_code":3},
        "hourly": {"time":["2026-06-10T13:00"],"temperature_2m":[20.0],"weather_code":[3],"precipitation":[2.0]}
      }
    """
    val weather = parseOpenMeteoWeather(json, 0.0, 0.0, fetchedAtMs = 1_000)!!

    assertEquals(1, weather.hourly.size)
    assertEquals(emptyList<WeatherSlot>(), weather.hourlySlots)
  }
}
