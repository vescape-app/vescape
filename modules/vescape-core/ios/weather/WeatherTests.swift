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

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/weather/WeatherTest.kt
final class WeatherTests: XCTestCase {
  private func parse(_ json: String) -> Weather? {
    parseOpenMeteoWeather(Data(json.utf8), latitude: 52.2, longitude: 21.0, fetchedAtMs: 1_000)
  }

  func testResolvesTheNightGlyphFromTheForecastsOwnSunTimes() {
    let weather = parse(forecastJson)

    XCTAssertEqual(weather?.icon, .moon)
    XCTAssertEqual(weather?.temperatureC, 18)
    XCTAssertEqual(weather?.precipitationProbability, 40)
    XCTAssertEqual(weather?.label, "Clear sky")
  }

  func testKeepsForecastHoursInApiOrderAsLocalMinutes() {
    let hours = parse(forecastJson)?.hourly ?? []

    XCTAssertEqual(hours.map(\.minuteOfDay), [22 * 60, 23 * 60, 5 * 60])
    XCTAssertEqual(hours.map(\.temperatureC), [18, 16, 12])
    XCTAssertEqual(hours.map(\.icon), [.moon, .cloudRain, .cloud])
    XCTAssertEqual(hours.last?.precipitationProbability, 0)
  }

  func testCarriesTheDaysSunTimesAsLocalMinutes() {
    let weather = parse(forecastJson)

    XCTAssertEqual(weather?.sunriseMinuteOfDay, 4 * 60 + 30)
    XCTAssertEqual(weather?.sunsetMinuteOfDay, 21 * 60 + 15)
  }

  func testDropsHoursWhoseParallelArraysRanShortInsteadOfInventingValues() {
    let hours = parse("""
      {
        "current": {"time":"2026-06-10T12:00","temperature_2m":20.0,"weather_code":3},
        "hourly": {
          "time": ["2026-06-10T12:00", "2026-06-10T13:00", "2026-06-10T14:00"],
          "temperature_2m": [20.0, null],
          "weather_code": [3]
        }
      }
      """)?.hourly ?? []

    XCTAssertEqual(hours.map(\.minuteOfDay), [12 * 60])
    XCTAssertEqual(hours.first?.temperatureC, 20)
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

  func testBuildsAbsolutePeriodStartSlotsAcrossLocalMidnight() {
    let weather = parse("""
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
      """)
    let midnightUtcMs: Int64 = 1_781_128_800_000
    let hourly = weather?.hourlySlots ?? []

    XCTAssertEqual(hourly.map(\.startMs), [midnightUtcMs - 3_600_000, midnightUtcMs])
    XCTAssertEqual(hourly.first?.endMs, midnightUtcMs)
    XCTAssertEqual(hourly.first?.precipitationProbability, 60)
    XCTAssertNil(hourly.last?.precipitationProbability)
    XCTAssertEqual(hourly.last?.precipitationMmPerHour, 3.0)
    let quarters = weather?.quarterHourSlots ?? []
    XCTAssertEqual(quarters.map(\.precipitationMmPerHour), [2.0, 0.4])
    XCTAssertEqual(quarters.first?.startMs, midnightUtcMs - 60 * 60_000)
    XCTAssertNil(quarters.first?.precipitationProbability)
  }

  func testHasNoAlertSlotsWithoutAUtcOffsetToAnchorThem() {
    let weather = parse("""
      {
        "current": {"time":"2026-06-10T12:00","temperature_2m":20.0,"weather_code":3},
        "hourly": {"time":["2026-06-10T13:00"],"temperature_2m":[20.0],"weather_code":[3],"precipitation":[2.0]}
      }
      """)

    XCTAssertEqual(weather?.hourly.count, 1)
    XCTAssertEqual(weather?.hourlySlots, [])
  }
}
