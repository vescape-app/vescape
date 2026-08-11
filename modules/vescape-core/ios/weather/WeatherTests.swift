import XCTest
@testable import VescapeCore

private let forecastJson = """
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

/// Forecast parsing: the classification a rider actually sees (day vs night glyph), the timezone-free
/// hour handling, and the refusal to publish a forecast that has no usable current conditions.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/weather/WeatherTest.kt
final class WeatherTests: XCTestCase {
  private func parse(_ json: String) -> Weather? {
    parseOpenMeteoWeather(Data(json.utf8), latitude: 52.2, longitude: 21.0, fetchedAtMs: 1_000)
  }

  func testResolvesTheNightGlyphFromTheForecastsOwnSunTimes() {
    let weather = parse(forecastJson)

    // 22:00 is after a 21:15 sunset, so a clear sky is a moon and not a sun.
    XCTAssertEqual(weather?.icon, .moon)
    XCTAssertEqual(weather?.temperatureC, 18)
    XCTAssertEqual(weather?.precipitationProbability, 40)
    XCTAssertEqual(weather?.label, "Clear sky")
  }

  func testKeepsForecastHoursInApiOrderAsLocalMinutes() {
    let hours = parse(forecastJson)?.hourly ?? []

    XCTAssertEqual(hours.map(\.minuteOfDay), [22 * 60, 23 * 60, 5 * 60])
    XCTAssertEqual(hours.map(\.temperatureC), [18, 16, 12])
    // Rain looks the same at every hour; the pre-sunrise overcast hour is still a plain cloud.
    XCTAssertEqual(hours.map(\.icon), [.moon, .cloudRain, .cloud])
    // A null probability is "no chance stated", which renders as 0 rather than as a gap.
    XCTAssertEqual(hours.last?.precipitationProbability, 0)
  }

  func testCarriesTheDaysSunTimesAsLocalMinutes() {
    let weather = parse(forecastJson)

    XCTAssertEqual(weather?.sunriseMinuteOfDay, 4 * 60 + 30)
    XCTAssertEqual(weather?.sunsetMinuteOfDay, 21 * 60 + 15)
  }

  func testRefusesAPayloadWithoutUsableCurrentConditions() {
    XCTAssertNil(parse(#"{"hourly":{"time":[]}}"#))
    XCTAssertNil(parse("not json"))
    XCTAssertNil(parse(#"{"current":{"temperature_2m":12.0}}"#))
  }

  func testFallsBackToAFixedNightWindowWhenTheForecastOmitsSunTimes() {
    let weather = parse(
      #"{"current":{"time":"2026-06-10T23:00","temperature_2m":9.0,"weather_code":0}}"#
    )

    XCTAssertEqual(weather?.icon, .moon)
    XCTAssertNil(weather?.sunriseMinuteOfDay)
  }
}
