import Foundation

/// Older forecasts speak nothing: a rider offline must not be warned from old data.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WEATHER_ALERT_MAX_FORECAST_AGE_MS`
let weatherAlertMaxForecastAgeMs: Int64 = 30 * 60 * 1_000

private let minuteMs: Int64 = 60_000
private let horizonMin = 180
/// At or under this lead the evaluator reads `minutely_15`, above it hourly.
private let quarterHourWindowMin = 60
/// Above `quarterHourWindowMin`, a rung this soon after the previous line of its track is skipped.
private let lineGapMs: Int64 = 30 * minuteMs
/// A kind with no slot over its threshold for this long forgets its event.
private let rearmMs: Int64 = 30 * minuteMs

/// An independent Weather Alert line: its own events, gap and priority. Declaration order is
/// enqueue order when both speak in one evaluation.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertTrack`
enum WeatherAlertTrack: Hashable {
  case precipitation, wind
}

/// The condition a Weather Alert is about. Within a `track`, declaration order is speaking
/// priority, highest first: storm outranks rain; wind is a track of its own.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertKind`
/// @parity /modules/vescape-core/src/index.ts `WeatherAlertPreviewKind`
enum WeatherAlertKind: String, CaseIterable {
  case storm = "weather.storm"
  case rain = "weather.rain"
  case wind = "weather.wind"

  var voiceKey: String { rawValue }

  var track: WeatherAlertTrack { self == .wind ? .wind : .precipitation }

  /// Storm and rain lines add the slot's precipitation chance; wind has none to speak.
  var speaksPercent: Bool { self != .wind }
}

/// Thunderstorm only (95/96/99): storm-grade, no probability gate.
private let stormWeatherCodes: Set<Int> = [95, 96, 99]

/// Rain gate: probability applies to hourly slots only, intensity to both.
struct RainThresholds: Equatable {
  let minProbabilityPercent: Int
  let minMmPerHour: Double
}

/// Wind gate: the slot's peak gust, km/h.
struct WindThresholds: Equatable {
  let minGustKmh: Double
}

/// How bad weather must be to speak. Native-owned so thresholds retune without a migration.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertLevel`
enum WeatherAlertLevel: String, CaseIterable {
  case sensitive, normal, severe

  var rain: RainThresholds {
    switch self {
    case .sensitive: return RainThresholds(minProbabilityPercent: 30, minMmPerHour: 0.3)
    case .normal: return RainThresholds(minProbabilityPercent: 50, minMmPerHour: 1.0)
    case .severe: return RainThresholds(minProbabilityPercent: 70, minMmPerHour: 4.0)
    }
  }

  var wind: WindThresholds {
    switch self {
    case .sensitive: return WindThresholds(minGustKmh: 40)
    case .normal: return WindThresholds(minGustKmh: 55)
    case .severe: return WindThresholds(minGustKmh: 70)
    }
  }
}

/// Stored values of the rain and wind alert level settings: `off` or a `WeatherAlertLevel` raw value.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WEATHER_ALERT_LEVEL_SETTINGS`
/// @parity /modules/vescape-core/src/index.ts `WeatherAlertLevelSetting`
let weatherAlertLevelSettings = ["off"] + WeatherAlertLevel.allCases.map(\.rawValue)
let weatherAlertLevelDefault = "normal"

/// The rider's Weather Alert settings: a nil level turns that kind off.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertSettings`
struct WeatherAlertSettings: Equatable {
  var rain: WeatherAlertLevel? = .normal
  var wind: WeatherAlertLevel? = .normal
  var storm = true

  func enabled(_ kind: WeatherAlertKind) -> Bool {
    switch kind {
    case .storm: return storm
    case .wind: return wind != nil
    case .rain: return rain != nil
    }
  }

  /// From App Settings; `off` and unknown level values read as off, a missing storm flag as on.
  init(settings: [String: Any?]) {
    rain = (settings["weatherRainAlertLevel"] as? String).flatMap(WeatherAlertLevel.init(rawValue:))
    wind = (settings["weatherWindAlertLevel"] as? String).flatMap(WeatherAlertLevel.init(rawValue:))
    storm = settings["weatherStormAlertEnabled"] as? Bool ?? true
  }

  init(rain: WeatherAlertLevel? = .normal, wind: WeatherAlertLevel? = .normal, storm: Bool = true) {
    self.rain = rain
    self.wind = wind
    self.storm = storm
  }
}

/// One line due: `leadMinutes` until the event starts (0 is "now"), `percent` its chance on far rungs.
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

  /// The line the evaluator would speak for `kind` (`storm`/`wind`/`rain`), for the dev preview.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertLine.preview`
  static func preview(kind: String, leadMinutes: Int, percent: Int?) -> WeatherAlertLine? {
    guard let kind = WeatherAlertKind(rawValue: "weather.\(kind.lowercased())") else { return nil }
    return WeatherAlertLine(kind: kind, leadMinutes: max(leadMinutes, 0), percent: kind.speaksPercent ? percent : nil)
  }
}

/// The tracked event of one kind: the closest lead already spoken (or skipped), when it was last
/// seen in the window, and when it was last underway (nil until it starts).
struct WeatherEventState: Equatable {
  let spokenMinutes: Int
  let lastSeenMs: Int64
  var lastUnderwayMs: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertState`
struct WeatherAlertState: Equatable {
  var events: [WeatherAlertKind: WeatherEventState] = [:]
  /// When each track last spoke, for the 30 min gap above 1 h.
  var lastLineAtMs: [WeatherAlertTrack: Int64] = [:]
}

/// Weather Alert Evaluator: what to say about `weather` at `nowMs`, given what was said before.
/// Pure; the caller owns the clock, the live-connection gate and the state.
///
/// Per enabled kind, the event is its earliest slot over its `settings` level within 3 h. The first line speaks the lead
/// rounded down; after it only a closer ladder rung (2h, 1h, 30, 15, now) speaks, once. An event that
/// vanishes keeps its state, so a downgrade is silent and a reappearance only escalates.
///
/// Tracks are independent: storm/rain and wind each keep their own events and gap, and storm/rain
/// lines are enqueued before wind. Within storm/rain only the highest active kind speaks (storm >
/// rain); rain under an active storm still tracks its ladder, so its passed rungs are consumed
/// silently rather than spoken late. A kind turned off forgets its event and never suppresses another.
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
    // A later event after 30 min clear of the one underway is a new event, even with it already in the window.
    var prior = next.events[kind]
    if lead > 0, let underway = prior?.lastUnderwayMs, nowMs - underway >= rearmMs { prior = nil }
    let spoken: Int?
    let stored: Int
    if let prior {
      if let rung = ladderRung(lead), rung < prior.spokenMinutes {
        // Skipped rungs are consumed, so a late line never names a rung already passed.
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
    // `inserted` is false when a higher kind of the track is already active.
    if activeTracks.insert(kind.track).inserted, let spoken {
      let percent = kind.speaksPercent && spoken > quarterHourWindowMin ? event.probability.map(percentClip) : nil
      lines.append(WeatherAlertLine(kind: kind, leadMinutes: spoken, percent: percent))
      next.lastLineAtMs[kind.track] = nowMs
    }
  }
  return (lines, next)
}

/// First line: above 1 h down to 30 min (capped at 3 h), from 15 min down to 15 min, under it "now".
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `firstLeadMinutes`
func firstLeadMinutes(_ lead: Int) -> Int {
  if lead > quarterHourWindowMin { return min(horizonMin, lead / 30 * 30) }
  if lead >= 15 { return lead / 15 * 15 }
  return 0
}

/// Closest ladder rung `lead` has crossed, or nil while it is still beyond 2 h.
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

/// Nearest ten, 10–100: the `percent` clips a line can speak.
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
  // Without a `minutely_15` series the hourly one covers the near hour too, gate and all.
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

/// Runs the evaluator against the live forecast while a Board is connected and hands due lines to
/// `speak`. State lives as long as this monitor (the Board Session, per app process), so a Bluetooth
/// dropout and reconnect never re-announces; `rideEnded` forgets it. Main thread only.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertMonitor`
final class WeatherAlertMonitor {
  private let isLive: () -> Bool
  private let speak: (WeatherAlertLine) -> Void
  private let nowMs: () -> Int64
  private var state = WeatherAlertState()
  /// The rider's levels, applied from App Settings; read at the next evaluation.
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

  /// Evaluate `weather` (a refresh, or the known forecast at connect); silent off a live link.
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
