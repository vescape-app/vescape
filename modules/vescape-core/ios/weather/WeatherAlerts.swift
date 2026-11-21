import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WEATHER_ALERT_MAX_FORECAST_AGE_MS`
let weatherAlertMaxForecastAgeMs: Int64 = 30 * 60 * 1_000

private let minuteMs: Int64 = 60_000
private let horizonMin = 180
private let quarterHourWindowMin = 60
private let lineGapMs: Int64 = 30 * minuteMs
private let rearmMs: Int64 = 30 * minuteMs

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertTrack`
enum WeatherAlertTrack: Hashable {
  case precipitation, wind
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertKind`
/// @parity /modules/vescape-core/src/index.ts `WeatherAlertPreviewKind`
enum WeatherAlertKind: String, CaseIterable {
  case storm = "weather.storm"
  case rain = "weather.rain"
  case wind = "weather.wind"

  var voiceKey: String { rawValue }

  var track: WeatherAlertTrack { self == .wind ? .wind : .precipitation }

  var speaksPercent: Bool { self != .wind }
}

private let stormWeatherCodes: Set<Int> = [95, 96, 99]

struct RainThresholds: Equatable {
  let minProbabilityPercent: Int
  let minMmPerHour: Double
}

struct WindThresholds: Equatable {
  let minGustKmh: Double
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertLevel`
enum WeatherAlertLevel: String, CaseIterable {
  case sensitive, normal, extreme

  var rain: RainThresholds {
    switch self {
    case .sensitive: return RainThresholds(minProbabilityPercent: 30, minMmPerHour: 0.3)
    case .normal: return RainThresholds(minProbabilityPercent: 50, minMmPerHour: 1.0)
    case .extreme: return RainThresholds(minProbabilityPercent: 70, minMmPerHour: 4.0)
    }
  }

  var wind: WindThresholds {
    switch self {
    case .sensitive: return WindThresholds(minGustKmh: 40)
    case .normal: return WindThresholds(minGustKmh: 55)
    case .extreme: return WindThresholds(minGustKmh: 70)
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WEATHER_ALERT_LEVEL_SETTINGS`
/// @parity /modules/vescape-core/src/index.ts `WeatherAlertLevelSetting`
let weatherAlertLevelSettings = ["off"] + WeatherAlertLevel.allCases.map(\.rawValue)
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlertDefaults.kt `WEATHER_ALERT_LEVEL_DEFAULT`
let weatherAlertLevelDefault = "normal"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertSettings`
struct WeatherAlertSettings: Equatable {
  var rain: WeatherAlertLevel? = .normal
  var wind: WeatherAlertLevel? = .normal

  func enabled(_ kind: WeatherAlertKind) -> Bool {
    switch kind {
    case .storm: return true
    case .wind: return wind != nil
    case .rain: return rain != nil
    }
  }

  init(settings: [String: Any?]) {
    rain = (settings["weatherRainAlertLevel"] as? String).flatMap(WeatherAlertLevel.init(rawValue:))
    wind = (settings["weatherWindAlertLevel"] as? String).flatMap(WeatherAlertLevel.init(rawValue:))
  }

  init(rain: WeatherAlertLevel? = .normal, wind: WeatherAlertLevel? = .normal) {
    self.rain = rain
    self.wind = wind
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertLine`
struct WeatherAlertLine: Equatable {
  let kind: WeatherAlertKind
  let leadMinutes: Int
  let percent: Int?

  var voiceAnnouncement: VoiceAnnouncement {
    if leadMinutes == 0 {
      return VoiceAnnouncement(severity: .warning, key: "\(kind.voiceKey).now")
    }
    var values = [VoiceValue(type: "duration", value: leadMinutes)]
    if let percent { values.append(VoiceValue(type: "percent", value: percent)) }
    return VoiceAnnouncement(severity: .warning, key: kind.voiceKey, values: values)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertLine.preview`
  static func preview(kind: String, leadMinutes: Int, percent: Int?) -> WeatherAlertLine? {
    guard let kind = WeatherAlertKind(rawValue: "weather.\(kind.lowercased())") else { return nil }
    return WeatherAlertLine(kind: kind, leadMinutes: max(leadMinutes, 0), percent: kind.speaksPercent ? percent : nil)
  }
}

struct WeatherEventState: Equatable {
  let spokenMinutes: Int
  let lastSeenMs: Int64
  var lastUnderwayMs: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertState`
struct WeatherAlertState: Equatable {
  var events: [WeatherAlertKind: WeatherEventState] = [:]
  var lastLineAtMs: [WeatherAlertTrack: Int64] = [:]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `evaluateWeatherAlerts`
func evaluateWeatherAlerts(
  _ weather: Weather,
  settings: WeatherAlertSettings,
  nowMs: Int64,
  state: WeatherAlertState
) -> (lines: [WeatherAlertLine], state: WeatherAlertState) {
  guard nowMs - weather.fetchedAtMs <= weatherAlertMaxForecastAgeMs else { return ([], state) }
  var next = state
  var lines: [WeatherAlertLine] = []
  var activeTracks: Set<WeatherAlertTrack> = []
  for kind in WeatherAlertKind.allCases {
    guard settings.enabled(kind) else {
      next.events[kind] = nil
      continue
    }
    guard let event = nextEvent(kind, weather: weather, settings: settings, nowMs: nowMs) else {
      if let prior = next.events[kind], nowMs - prior.lastSeenMs >= rearmMs { next.events[kind] = nil }
      continue
    }
    let lead = max(0, Int((event.startMs - nowMs) / minuteMs))
    var prior = next.events[kind]
    if lead > 0, let underway = prior?.lastUnderwayMs, nowMs - underway >= rearmMs { prior = nil }
    let spoken: Int?
    let stored: Int
    if let prior {
      if let rung = ladderRung(lead), rung < prior.spokenMinutes {
        if rung > quarterHourWindowMin, let last = next.lastLineAtMs[kind.track], nowMs - last < lineGapMs {
          spoken = nil
        } else {
          spoken = rung
        }
        stored = rung
      } else {
        spoken = nil
        stored = prior.spokenMinutes
      }
    } else {
      spoken = firstLeadMinutes(lead)
      stored = firstLeadMinutes(lead)
    }
    next.events[kind] = WeatherEventState(
      spokenMinutes: stored, lastSeenMs: nowMs, lastUnderwayMs: lead == 0 ? nowMs : prior?.lastUnderwayMs)
    if activeTracks.insert(kind.track).inserted, let spoken {
      let percent = kind.speaksPercent && spoken > quarterHourWindowMin ? event.probability.map(percentClip) : nil
      lines.append(WeatherAlertLine(kind: kind, leadMinutes: spoken, percent: percent))
      next.lastLineAtMs[kind.track] = nowMs
    }
  }
  return (lines, next)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `firstLeadMinutes`
func firstLeadMinutes(_ lead: Int) -> Int {
  if lead > quarterHourWindowMin { return min(horizonMin, lead / 30 * 30) }
  if lead >= 15 { return lead / 15 * 15 }
  return 0
}

private func ladderRung(_ lead: Int) -> Int? {
  switch lead {
  case ...0: return 0
  case ...15: return 15
  case ...30: return 30
  case ...60: return 60
  case ...120: return 120
  default: return nil
  }
}

private func percentClip(_ probability: Int) -> Int {
  min(100, max(10, Int((Double(probability) / 10).rounded()) * 10))
}

private func nextEvent(
  _ kind: WeatherAlertKind,
  weather: Weather,
  settings: WeatherAlertSettings,
  nowMs: Int64
) -> (startMs: Int64, probability: Int?)? {
  let window = Int64(quarterHourWindowMin) * minuteMs
  let quarters = !weather.quarterHourSlots.isEmpty
  let near = (quarters ? weather.quarterHourSlots : weather.hourlySlots).filter {
    $0.endMs > nowMs && $0.startMs - nowMs <= window && qualifies(kind, $0, settings: settings, hourly: !quarters)
  }
  let far = weather.hourlySlots.filter {
    let lead = $0.startMs - nowMs
    return lead > window && lead <= Int64(horizonMin) * minuteMs && qualifies(kind, $0, settings: settings, hourly: true)
  }
  guard let first = (near + far).min(by: { $0.startMs < $1.startMs }) else { return nil }
  return (first.startMs, first.precipitationProbability)
}

private func qualifies(_ kind: WeatherAlertKind, _ slot: WeatherSlot, settings: WeatherAlertSettings, hourly: Bool) -> Bool {
  switch kind {
  case .storm:
    return slot.weatherCode.map(stormWeatherCodes.contains) ?? false
  case .wind:
    guard let level = settings.wind else { return false }
    return (slot.windGustsKmh ?? 0) >= level.wind.minGustKmh
  case .rain:
    guard let gate = settings.rain?.rain else { return false }
    return slot.precipitationMmPerHour >= gate.minMmPerHour
      && (!hourly || (slot.precipitationProbability ?? 0) >= gate.minProbabilityPercent)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertMonitor`
final class WeatherAlertMonitor {
  private let isLive: () -> Bool
  private let speak: (WeatherAlertLine) -> Void
  private let nowMs: () -> Int64
  private var state = WeatherAlertState()
  var settings = WeatherAlertSettings()

  init(
    isLive: @escaping () -> Bool,
    speak: @escaping (WeatherAlertLine) -> Void,
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  ) {
    self.isLive = isLive
    self.speak = speak
    self.nowMs = nowMs
  }

  func evaluate(_ weather: Weather?) {
    guard let weather, isLive() else { return }
    let result = evaluateWeatherAlerts(weather, settings: settings, nowMs: nowMs(), state: state)
    state = result.state
    result.lines.forEach(speak)
  }

  func rideEnded() {
    state = WeatherAlertState()
  }
}
