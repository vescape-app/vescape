import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt
final class WatchWeatherTests: XCTestCase {
  private func sample(fetchedAtMs: Int64 = 1_000_000) -> WatchWeather {
    WatchWeather(
      temperatureC: 14,
      icon: "cloud-rain",
      label: "Rain",
      precipitationProbability: 60,
      hourly: [
        WatchWeatherHour(minuteOfDay: 780, temperatureC: 14, icon: "cloud-rain", precipitationProbability: 60),
        WatchWeatherHour(minuteOfDay: 840, temperatureC: 15, icon: "cloud-sun", precipitationProbability: 0),
      ],
      sunriseMinuteOfDay: 380,
      sunsetMinuteOfDay: 1_180,
      latitude: 52.23,
      longitude: 21.01,
      fetchedAtMs: fetchedAtMs
    )
  }

  func testRoundTripsThroughThePayload() {
    let decoded = WatchWeather.decode(sample().payload)
    XCTAssertEqual(decoded, sample())
    XCTAssertEqual(decoded?.fetchedAtMs, sample().fetchedAtMs)
    XCTAssertEqual(decoded?.hourly.count, 2)
  }

  func testAbsentSunTimesRideAsAbsentKeysRatherThanSentinels() {
    var weather = sample()
    weather.sunriseMinuteOfDay = nil
    weather.sunsetMinuteOfDay = nil
    let payload = weather.payload
    XCTAssertNil(payload[WatchWeatherKey.sunrise])
    XCTAssertNil(payload[WatchWeatherKey.sunset])
    XCTAssertNil(WatchWeather.decode(payload)?.sunriseMinuteOfDay)
  }

  func testAbsentChannelIsNoForecast() {
    XCTAssertNil(WatchWeather.decode(context: ["settings": ["distanceUnit": "mi"]]))
  }

  func testChannelIsReadOutOfAMergedContext() {
    let context: [String: Any] = [
      "settings": ["distanceUnit": "mi"],
      watchWeatherChannel: sample().payload,
    ]
    XCTAssertEqual(WatchWeather.decode(context: context), sample())
  }

  func testAPayloadWithoutCurrentConditionsIsNothingRatherThanZeroDegrees() {
    XCTAssertNil(WatchWeather.decode([WatchWeatherKey.label: "Rain"]))
  }

  func testAShortHourLaneDropsThatHourRatherThanFabricatingIt() {
    var payload = sample().payload
    payload[WatchWeatherKey.hourTemps] = [14]
    XCTAssertEqual(WatchWeather.decode(payload)?.hourly.count, 1)
  }

  func testAMissingPrecipitationLaneReadsAsNoRainNotAsADroppedHour() {
    var payload = sample().payload
    payload.removeValue(forKey: WatchWeatherKey.hourPrecips)
    let hourly = WatchWeather.decode(payload)?.hourly
    XCTAssertEqual(hourly?.count, 2)
    XCTAssertEqual(hourly?.first?.precipitationProbability, 0)
  }

  func testRefetchingTheSameNumbersIsNotAChange() {
    XCTAssertEqual(sample(fetchedAtMs: 1), sample(fetchedAtMs: 9_999_999))
  }

  func testAgedOutForecastsStopBeingWorthShowing() {
    let weather = sample(fetchedAtMs: 0)
    XCTAssertTrue(weather.isFresh(nowMs: watchWeatherStaleMs))
    XCTAssertFalse(weather.isFresh(nowMs: watchWeatherStaleMs + 1))
  }

  func testAClockThatJumpedBackwardsDoesNotHideAGoodForecast() {
    XCTAssertTrue(sample(fetchedAtMs: 5_000).isFresh(nowMs: 1_000))
  }

  func testNextSunEventIsTheOneStillAhead() {
    let beforeDawn = watchNextSunEvent(nowMinuteOfDay: 300, sunriseMinuteOfDay: 380, sunsetMinuteOfDay: 1_180)
    XCTAssertEqual(beforeDawn, WatchSunEvent(minuteOfDay: 380, rising: true))

    let daytime = watchNextSunEvent(nowMinuteOfDay: 700, sunriseMinuteOfDay: 380, sunsetMinuteOfDay: 1_180)
    XCTAssertEqual(daytime, WatchSunEvent(minuteOfDay: 1_180, rising: false))

    let night = watchNextSunEvent(nowMinuteOfDay: 1_300, sunriseMinuteOfDay: 380, sunsetMinuteOfDay: 1_180)
    XCTAssertEqual(night, WatchSunEvent(minuteOfDay: 380, rising: true))

    XCTAssertNil(watchNextSunEvent(nowMinuteOfDay: 700, sunriseMinuteOfDay: nil, sunsetMinuteOfDay: nil))
  }

  func testHourFormattingIsAlwaysTwentyFourHour() {
    XCTAssertEqual(watchFormatHour(0), "00:00")
    XCTAssertEqual(watchFormatHour(0, timeFormat: "12h"), "12:00 AM")
    XCTAssertEqual(watchFormatHour(720, timeFormat: "12h"), "12:00 PM")
    XCTAssertEqual(watchFormatHour(845, timeFormat: "12h"), "2:05 PM")
    XCTAssertEqual(watchFormatHour(845, timeFormat: "12h", seconds: 9), "2:05:09 PM")
    XCTAssertEqual(watchFormatHour(9 * 60 + 5), "09:05")
    XCTAssertEqual(watchFormatHour(23 * 60 + 59), "23:59")
    XCTAssertEqual(watchFormatHour(24 * 60 + 30), "00:30")
    XCTAssertEqual(watchFormatHour(-30), "23:30")
  }

  func testTheWireMirrorsThePhonesForecast() {
    let weather = Weather(
      temperatureC: 14,
      weatherCode: 61,
      icon: .cloudRain,
      precipitationProbability: 60,
      hourly: [
        WeatherHour(
          minuteOfDay: 780, temperatureC: 14, weatherCode: 61,
          icon: .cloudRain, precipitationProbability: 60
        )
      ],
      sunriseMinuteOfDay: 380,
      sunsetMinuteOfDay: 1_180,
      latitude: 52.23,
      longitude: 21.01,
      fetchedAtMs: 1_000_000
    )
    let mirrored = weather.watchWeather
    XCTAssertEqual(mirrored.icon, "cloud-rain")
    XCTAssertEqual(mirrored.label, "Rain")
    XCTAssertEqual(mirrored.hourly.first?.icon, "cloud-rain")
    XCTAssertEqual(mirrored.latitude, 52.23)
    XCTAssertEqual(WatchWeather.decode(mirrored.payload), mirrored)
  }
}
