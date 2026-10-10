import XCTest
@testable import VescapeCore

/// The weather contract both ends of the mirror compile against: what the phone puts on the wire,
/// what a wrist reads back out of a merged Application Context, and what it refuses to invent when
/// the bag is short.
///
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
    XCTAssertNil(WatchWeather.decode(context: ["settings": ["riderColor": "#FF0000"]]))
  }

  func testChannelIsReadOutOfAMergedContext() {
    let context: [String: Any] = [
      "settings": ["riderColor": "#FF0000"],
      watchWeatherChannel: sample().payload,
    ]
    XCTAssertEqual(WatchWeather.decode(context: context), sample())
  }

  func testAPayloadWithoutCurrentConditionsIsNothingRatherThanZeroDegrees() {
    // The trap the phone's own parser documents: a short bag coerced to numbers reads as a
    // fabricated clear sky at 0 °C, which looks like real weather rather than like missing data.
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
    // Equality drives the push gate: a ten-minute refresh that produced identical conditions must
    // not spend a round trip or redraw the wrist.
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

    // After dark it is tomorrow's sunrise, not a sunset that already happened.
    let night = watchNextSunEvent(nowMinuteOfDay: 1_300, sunriseMinuteOfDay: 380, sunsetMinuteOfDay: 1_180)
    XCTAssertEqual(night, WatchSunEvent(minuteOfDay: 380, rising: true))

    XCTAssertNil(watchNextSunEvent(nowMinuteOfDay: 700, sunriseMinuteOfDay: nil, sunsetMinuteOfDay: nil))
  }

  func testHourFormattingIsAlwaysTwentyFourHour() {
    XCTAssertEqual(watchFormatHour(0), "00:00")
    XCTAssertEqual(watchFormatHour(9 * 60 + 5), "09:05")
    XCTAssertEqual(watchFormatHour(23 * 60 + 59), "23:59")
    // A minute-of-day past midnight wraps rather than printing a 24th hour.
    XCTAssertEqual(watchFormatHour(24 * 60 + 30), "00:30")
    // Only a corrupt bag produces this, and a clock face must not grow a minus sign from it.
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
