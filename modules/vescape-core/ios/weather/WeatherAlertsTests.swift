import XCTest
@testable import VescapeCore

private let minuteMs: Int64 = 60_000
private let t0: Int64 = 1_781_128_800_000

private func hour(_ startMin: Int64, mm: Double = 2.0, probability: Int = 80) -> WeatherSlot {
  WeatherSlot(
    startMs: t0 + startMin * minuteMs, endMs: t0 + (startMin + 60) * minuteMs, precipitationMmPerHour: mm,
    precipitationProbability: probability, weatherCode: 61, windGustsKmh: nil
  )
}

private func quarter(_ startMin: Int64, mmPerHour: Double = 2.0) -> WeatherSlot {
  WeatherSlot(
    startMs: t0 + startMin * minuteMs, endMs: t0 + (startMin + 15) * minuteMs, precipitationMmPerHour: mmPerHour,
    precipitationProbability: nil, weatherCode: 61, windGustsKmh: nil
  )
}

private func weather(hourly: [WeatherSlot] = [], quarters: [WeatherSlot] = [], fetchedAtMs: Int64 = t0) -> Weather {
  Weather(
    temperatureC: 15, weatherCode: 61, icon: .cloudRain, precipitationProbability: 0, hourly: [],
    sunriseMinuteOfDay: nil, sunsetMinuteOfDay: nil, latitude: 0, longitude: 0, fetchedAtMs: fetchedAtMs,
    hourlySlots: hourly, quarterHourSlots: quarters
  )
}

/// Rain starting at `startMin` after t0, in whichever series covers its lead at `nowMin`.
private func rainAt(_ startMin: Int64, _ nowMin: Int64, fetchedAtMs: Int64? = nil) -> Weather {
  let fetched = fetchedAtMs ?? t0 + nowMin * minuteMs
  if startMin - nowMin > 60 { return weather(hourly: [hour(startMin)], fetchedAtMs: fetched) }
  return weather(quarters: stride(from: startMin, to: startMin + 60, by: 15).map { quarter($0) }, fetchedAtMs: fetched)
}

/// A dry hourly slot carrying only a weather code and a gust.
private func dryHour(_ startMin: Int64, code: Int = 3, gustKmh: Double? = nil) -> WeatherSlot {
  WeatherSlot(
    startMs: t0 + startMin * minuteMs, endMs: t0 + (startMin + 60) * minuteMs, precipitationMmPerHour: 0,
    precipitationProbability: 0, weatherCode: code, windGustsKmh: gustKmh
  )
}

private struct Said: Equatable {
  let lead: Int
  let percent: Int?
  init(_ lead: Int, _ percent: Int? = nil) {
    self.lead = lead
    self.percent = percent
  }
}

/// Weather Alert Evaluator: the rain ladder, rounding, gap, escalation-only, re-arm and stale guard.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/weather/WeatherAlertsTest.kt
final class WeatherAlertsTests: XCTestCase {
  private var state = WeatherAlertState()

  private func eval(_ weather: Weather, _ nowMin: Int64) -> [Said] {
    let result = evaluateWeatherAlerts(weather, settings: WeatherAlertSettings(), nowMs: t0 + nowMin * minuteMs, state: state)
    state = result.state
    return result.lines.map { Said($0.leadMinutes, $0.percent) }
  }

  func testFirstLineRoundsTheLeadDownThenTheLadderSpeaksEachCloserRungOnce() {
    XCTAssertEqual(eval(rainAt(170, 0), 0), [Said(150, 80)])
    XCTAssertEqual(eval(rainAt(170, 10), 10), [])
    // 2h rung crossed at 115 min, more than 30 min after the first line.
    XCTAssertEqual(eval(rainAt(170, 55), 55), [Said(120, 80)])
    XCTAssertEqual(eval(rainAt(170, 115), 115), [Said(60)])
    XCTAssertEqual(eval(rainAt(170, 125), 125), [])
    XCTAssertEqual(eval(rainAt(170, 145), 145), [Said(30)])
    XCTAssertEqual(eval(rainAt(170, 160), 160), [Said(15)])
    XCTAssertEqual(eval(rainAt(170, 170), 170), [Said(0)])
    // Raining: never repeats.
    XCTAssertEqual(eval(rainAt(170, 185), 185), [])
  }

  func testRoundsTheFirstLineTo15MinutesWithinTheHourAndSaysNowUnder15() {
    XCTAssertEqual(eval(rainAt(59, 0), 0), [Said(45)])
    state = WeatherAlertState()
    XCTAssertEqual(eval(rainAt(14, 0), 0), [Said(0)])
    state = WeatherAlertState()
    // Already raining at connect: "now" once.
    XCTAssertEqual(eval(rainAt(-20, 0), 0), [Said(0)])
    XCTAssertEqual(eval(rainAt(-20, 5), 5), [])
  }

  func testTheFirstLineConsumesEveryRungAtOrAboveIt() {
    XCTAssertEqual(eval(rainAt(125, 0), 0), [Said(120, 80)])
    XCTAssertEqual(eval(rainAt(125, 10), 10), [])
    XCTAssertEqual(eval(rainAt(125, 70), 70), [Said(60)])
  }

  func testARungAboveAnHourWithin30MinutesOfThePreviousLineIsSkipped() {
    XCTAssertEqual(eval(rainAt(150, 0), 0), [Said(150, 80)])
    // The forecast pulls it to 100 min: the 2h rung is crossed only 10 min after the last line.
    XCTAssertEqual(eval(rainAt(110, 10), 10), [])
    // Consumed by the skip, so it does not speak late.
    XCTAssertEqual(eval(rainAt(110, 20), 20), [])
    XCTAssertEqual(eval(rainAt(110, 50), 50), [Said(60)])
  }

  func testExactly30MinutesAfterThePreviousLineSpeaks() {
    XCTAssertEqual(eval(rainAt(150, 0), 0), [Said(150, 80)])
    XCTAssertEqual(eval(rainAt(150, 30), 30), [Said(120, 80)])
  }

  func testDowngradesAndDelaysAreSilentAndAJumpCloserSpeaksOnce() {
    XCTAssertEqual(eval(rainAt(125, 0), 0), [Said(120, 80)])
    // Delayed out to 2.5 h: no line.
    XCTAssertEqual(eval(rainAt(160, 10), 10), [])
    // Gone: no line, state kept.
    XCTAssertEqual(eval(weather(fetchedAtMs: t0 + 20 * minuteMs), 20), [])
    // Back and much closer: only the new rung.
    XCTAssertEqual(eval(rainAt(45, 25), 25), [Said(30)])
    XCTAssertEqual(eval(rainAt(45, 28), 28), [])
  }

  func testTheHourlyGateNeedsProbabilityAndTheQuarterHourGateDoesNot() {
    XCTAssertEqual(eval(weather(hourly: [hour(120, probability: 40)]), 0), [])
    XCTAssertEqual(eval(weather(hourly: [hour(120, mm: 0.5)]), 0), [])
    // An hourly slot at or under 1 h out is the quarter-hour series' job.
    XCTAssertEqual(eval(weather(hourly: [hour(30)], quarters: [quarter(30, mmPerHour: 0)]), 0), [])
    XCTAssertEqual(eval(weather(quarters: [quarter(30, mmPerHour: 0.8)]), 0), [])
    XCTAssertEqual(eval(weather(quarters: [quarter(30, mmPerHour: 1.0)]), 0), [Said(30)])
  }

  func testWithoutAQuarterHourSeriesTheHourlyGateCoversTheNearHour() {
    XCTAssertEqual(eval(weather(hourly: [hour(30, probability: 40)]), 0), [])
    XCTAssertEqual(eval(weather(hourly: [hour(30)]), 0), [Said(30)])
    XCTAssertEqual(eval(weather(hourly: [hour(-10)], fetchedAtMs: t0 + 30 * minuteMs), 30), [Said(0)])
  }

  func testAnEventLostAtTheHourHandoverKeepsItsStateAndOnlyEscalatesOnReturn() {
    XCTAssertEqual(eval(rainAt(95, 0), 0), [Said(90, 80)])
    XCTAssertEqual(eval(rainAt(95, 30), 30), [])
    // Inside the hour the quarter-hour series no longer shows it.
    XCTAssertEqual(eval(weather(fetchedAtMs: t0 + 40 * minuteMs), 40), [])
    XCTAssertEqual(eval(rainAt(95, 70), 70), [Said(30)])
  }

  func testReArmsAfter30MinutesClear() {
    XCTAssertEqual(eval(rainAt(-10, 0), 0), [Said(0)])
    XCTAssertEqual(eval(rainAt(-10, 20), 20), [])
    // A gap shorter than 30 min is still the same event.
    XCTAssertEqual(eval(weather(fetchedAtMs: t0 + 40 * minuteMs), 40), [])
    XCTAssertEqual(eval(rainAt(60, 49), 49), [])
    // 30 min with nothing over the threshold.
    XCTAssertEqual(eval(weather(fetchedAtMs: t0 + 79 * minuteMs), 79), [])
    XCTAssertEqual(eval(rainAt(200, 80), 80), [Said(120, 80)])
  }

  func testALaterEventAlreadyInTheWindowReArms30MinutesAfterTheOneUnderway() {
    XCTAssertEqual(eval(rainAt(-10, 0), 0), [Said(0)])
    XCTAssertEqual(eval(rainAt(-10, 20), 20), [])
    // The rain stopped and the next shower is already visible: same event until 30 min clear.
    XCTAssertEqual(eval(rainAt(130, 40), 40), [])
    XCTAssertEqual(eval(rainAt(130, 50), 50), [Said(60)])
    XCTAssertEqual(eval(rainAt(130, 100), 100), [Said(30)])
  }

  func testAForecastOlderThan30MinutesSaysNothing() {
    XCTAssertEqual(eval(rainAt(100, 31, fetchedAtMs: t0), 31), [])
    XCTAssertEqual(eval(rainAt(100, 40, fetchedAtMs: t0 + 10 * minuteMs), 40), [Said(60)])
  }

  func testPercentRoundsToTensWithin10To100() {
    XCTAssertEqual(eval(weather(hourly: [hour(100, probability: 55)]), 0), [Said(90, 60)])
  }

  func testSpeaksDurationAndPercentOrTheNowKey() {
    let far = WeatherAlertLine(kind: .rain, leadMinutes: 150, percent: 30).voiceAnnouncement
    XCTAssertEqual(far.key, "weather.rain")
    XCTAssertEqual(far.values, [VoiceValue(type: "duration", value: 150), VoiceValue(type: "percent", value: 30)])
    let now = WeatherAlertLine(kind: .rain, leadMinutes: 0, percent: nil).voiceAnnouncement
    XCTAssertEqual(now.key, "weather.rain.now")
    XCTAssertEqual(now.values, [])
  }

  func testMonitorSpeaksOnlyWhileLiveAndKeepsStateAcrossAReconnect() {
    var live = false
    var nowMin: Int64 = 0
    var spoken: [Int] = []
    let monitor = WeatherAlertMonitor(isLive: { live }, speak: { spoken.append($0.leadMinutes) }, nowMs: { t0 + nowMin * minuteMs })
    monitor.evaluate(rainAt(100, 0))
    XCTAssertEqual(spoken, [])
    live = true
    monitor.evaluate(rainAt(100, 0))
    live = false
    nowMin = 5
    monitor.evaluate(rainAt(100, 5))
    live = true
    monitor.evaluate(rainAt(100, 5))
    XCTAssertEqual(spoken, [90])
    monitor.rideEnded()
    monitor.evaluate(rainAt(100, 5))
    XCTAssertEqual(spoken, [90, 90])
  }

  private func kinds(_ weather: Weather, _ nowMin: Int64, _ settings: WeatherAlertSettings = WeatherAlertSettings()) -> [String] {
    let result = evaluateWeatherAlerts(weather, settings: settings, nowMs: t0 + nowMin * minuteMs, state: state)
    state = result.state
    return result.lines.map { "\($0.kind.voiceKey) \($0.leadMinutes)" }
  }

  func testThunderstormAndFreezingRainCodesAreStormWithoutAProbabilityGate() {
    for code in [95, 96, 99, 56, 57, 66, 67] {
      state = WeatherAlertState()
      XCTAssertEqual(kinds(weather(hourly: [dryHour(100, code: code)]), 0), ["weather.storm 90"])
    }
    state = WeatherAlertState()
    XCTAssertEqual(kinds(weather(hourly: [dryHour(100, code: 80)]), 0), [])
  }

  func testWindSpeaksFrom55KmhGustsAtNormal() {
    XCTAssertEqual(kinds(weather(hourly: [dryHour(100, gustKmh: 54.9)]), 0), [])
    XCTAssertEqual(kinds(weather(hourly: [dryHour(100, gustKmh: 55)]), 0), ["weather.wind 90"])
  }

  func testStormAndWindLinesCarryNoPercent() {
    let lines = evaluateWeatherAlerts(weather(hourly: [dryHour(100, code: 95)]), settings: WeatherAlertSettings(), nowMs: t0, state: state).lines
    XCTAssertEqual(lines.first?.voiceAnnouncement.values, [VoiceValue(type: "duration", value: 90)])
    XCTAssertEqual(WeatherAlertLine(kind: .storm, leadMinutes: 0, percent: nil).voiceAnnouncement.key, "weather.storm.now")
  }

  func testOnlyTheHighestActiveKindSpeaksAndASuppressedKindConsumesItsRungs() {
    func slot(_ start: Int64, _ end: Int64, probability: Int?, code: Int) -> WeatherSlot {
      WeatherSlot(
        startMs: t0 + start * minuteMs, endMs: t0 + end * minuteMs, precipitationMmPerHour: 2,
        precipitationProbability: probability, weatherCode: code, windGustsKmh: 60
      )
    }
    XCTAssertEqual(kinds(weather(hourly: [slot(100, 160, probability: 80, code: 95)]), 0), ["weather.storm 90"])
    // Rain and wind alone, storm gone: wind outranks rain, but its 90 min rung was consumed.
    XCTAssertEqual(kinds(weather(hourly: [slot(100, 160, probability: 80, code: 61)], fetchedAtMs: t0 + 10 * minuteMs), 10), [])
    XCTAssertEqual(
      kinds(weather(quarters: [slot(100, 115, probability: nil, code: 61)], fetchedAtMs: t0 + 40 * minuteMs), 40),
      ["weather.wind 60"]
    )
  }

  func testAKindTurnedOffSaysNothingAndNeverBlocksALowerKind() {
    let all = weather(hourly: [WeatherSlot(
      startMs: t0 + 100 * minuteMs, endMs: t0 + 160 * minuteMs, precipitationMmPerHour: 2,
      precipitationProbability: 80, weatherCode: 95, windGustsKmh: 60
    )])
    XCTAssertEqual(kinds(all, 0, WeatherAlertSettings(rain: .normal, wind: nil, storm: false)), ["weather.rain 90"])
    state = WeatherAlertState()
    XCTAssertEqual(kinds(all, 0, WeatherAlertSettings(rain: nil, wind: nil, storm: false)), [])
  }

  func testLevelsMoveTheRainAndWindGates() {
    let gust = weather(hourly: [dryHour(100, gustKmh: 45)])
    XCTAssertEqual(kinds(gust, 0), [])
    XCTAssertEqual(kinds(gust, 0, WeatherAlertSettings(wind: .sensitive)), ["weather.wind 90"])
    state = WeatherAlertState()
    XCTAssertEqual(kinds(rainAt(100, 0), 0, WeatherAlertSettings(rain: .severe)), [])
  }

  func testSettingsReadOffAndUnknownLevelsAsOff() {
    let settings = WeatherAlertSettings(settings: [
      "weatherRainAlertLevel": "off", "weatherWindAlertLevel": "severe", "weatherStormAlertEnabled": false,
    ])
    XCTAssertEqual(settings, WeatherAlertSettings(rain: nil, wind: .severe, storm: false))
    XCTAssertNil(WeatherAlertSettings(settings: ["weatherRainAlertLevel": "loud"]).rain)
  }
}
