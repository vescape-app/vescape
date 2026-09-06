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
}
