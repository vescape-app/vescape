import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `WATCH_WEATHER_PATH`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WEATHER_PATH`
/// @platform-diff Android gets one Data Layer path per channel; watchOS has a single Application
///   Context, so `weather` is a key in the merged dictionary rather than a path of its own.
let watchWeatherChannel = "weather"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt
enum WatchWeatherKey {
  static let temperatureC = "temperatureC"
  static let icon = "icon"
  static let label = "label"
  static let precipitationProbability = "precipitationProbability"
  static let hourMinutes = "hourMinutes"
  static let hourTemps = "hourTemps"
  static let hourIcons = "hourIcons"
  static let hourPrecips = "hourPrecips"
  static let sunrise = "sunriseMinuteOfDay"
  static let sunset = "sunsetMinuteOfDay"
  static let latitude = "latitude"
  static let longitude = "longitude"
  static let fetchedAtMs = "fetchedAtMs"
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WatchWeatherHour`
struct WatchWeatherHour: Equatable {
  var minuteOfDay: Int
  var temperatureC: Int
  var icon: String
  var precipitationProbability: Int
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `WatchWeather`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WatchWeather`
struct WatchWeather {
  var temperatureC: Int
  var icon: String
  var label: String
  var precipitationProbability: Int
  var hourly: [WatchWeatherHour]
  var sunriseMinuteOfDay: Int?
  var sunsetMinuteOfDay: Int?
  var latitude: Double?
  var longitude: Double?
  var fetchedAtMs: Int64

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeatherPusher.kt `push`
  var payload: [String: Any] {
    var payload: [String: Any] = [
      WatchWeatherKey.temperatureC: temperatureC,
      WatchWeatherKey.icon: icon,
      WatchWeatherKey.label: label,
      WatchWeatherKey.precipitationProbability: precipitationProbability,
      WatchWeatherKey.hourMinutes: hourly.map(\.minuteOfDay),
      WatchWeatherKey.hourTemps: hourly.map(\.temperatureC),
      WatchWeatherKey.hourIcons: hourly.map(\.icon),
      WatchWeatherKey.hourPrecips: hourly.map(\.precipitationProbability),
      WatchWeatherKey.fetchedAtMs: fetchedAtMs,
    ]
    if let sunriseMinuteOfDay { payload[WatchWeatherKey.sunrise] = sunriseMinuteOfDay }
    if let sunsetMinuteOfDay { payload[WatchWeatherKey.sunset] = sunsetMinuteOfDay }
    if let latitude { payload[WatchWeatherKey.latitude] = latitude }
    if let longitude { payload[WatchWeatherKey.longitude] = longitude }
    return payload
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `decodeWatchWeather`
  static func decode(_ payload: [String: Any]?) -> WatchWeather? {
    guard let payload,
      let temperatureC = (payload[WatchWeatherKey.temperatureC] as? NSNumber)?.intValue,
      let icon = payload[WatchWeatherKey.icon] as? String,
      let fetchedAtMs = (payload[WatchWeatherKey.fetchedAtMs] as? NSNumber)?.int64Value
    else { return nil }

    let minutes = (payload[WatchWeatherKey.hourMinutes] as? [NSNumber])?.map(\.intValue) ?? []
    let temps = (payload[WatchWeatherKey.hourTemps] as? [NSNumber])?.map(\.intValue) ?? []
    let icons = payload[WatchWeatherKey.hourIcons] as? [String] ?? []
    let precips = (payload[WatchWeatherKey.hourPrecips] as? [NSNumber])?.map(\.intValue) ?? []
    var hourly: [WatchWeatherHour] = []
    for (index, minuteOfDay) in minutes.enumerated() {
      guard index < temps.count, index < icons.count else { continue }
      hourly.append(
        WatchWeatherHour(
          minuteOfDay: minuteOfDay,
          temperatureC: temps[index],
          icon: icons[index],
          precipitationProbability: index < precips.count ? precips[index] : 0
        )
      )
    }

    return WatchWeather(
      temperatureC: temperatureC,
      icon: icon,
      label: payload[WatchWeatherKey.label] as? String ?? "",
      precipitationProbability: (payload[WatchWeatherKey.precipitationProbability] as? NSNumber)?.intValue ?? 0,
      hourly: hourly,
      sunriseMinuteOfDay: (payload[WatchWeatherKey.sunrise] as? NSNumber)?.intValue,
      sunsetMinuteOfDay: (payload[WatchWeatherKey.sunset] as? NSNumber)?.intValue,
      latitude: (payload[WatchWeatherKey.latitude] as? NSNumber)?.doubleValue,
      longitude: (payload[WatchWeatherKey.longitude] as? NSNumber)?.doubleValue,
      fetchedAtMs: fetchedAtMs
    )
  }

  static func decode(context: [String: Any]) -> WatchWeather? {
    decode(context[watchWeatherChannel] as? [String: Any])
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  func isFresh(nowMs: Int64) -> Bool { nowMs - fetchedAtMs <= watchWeatherStaleMs }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WEATHER_STALE_MS`
let watchWeatherStaleMs: Int64 = 3 * 60 * 60 * 1_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `equals`
extension WatchWeather: Equatable {
  static func == (lhs: WatchWeather, rhs: WatchWeather) -> Bool {
    lhs.temperatureC == rhs.temperatureC
      && lhs.icon == rhs.icon
      && lhs.label == rhs.label
      && lhs.precipitationProbability == rhs.precipitationProbability
      && lhs.hourly == rhs.hourly
      && lhs.sunriseMinuteOfDay == rhs.sunriseMinuteOfDay
      && lhs.sunsetMinuteOfDay == rhs.sunsetMinuteOfDay
      && lhs.latitude == rhs.latitude
      && lhs.longitude == rhs.longitude
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `SunEvent`
struct WatchSunEvent: Equatable {
  var minuteOfDay: Int
  var rising: Bool
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `nextSunEvent`
func watchNextSunEvent(
  nowMinuteOfDay: Int,
  sunriseMinuteOfDay: Int?,
  sunsetMinuteOfDay: Int?
) -> WatchSunEvent? {
  if let sunriseMinuteOfDay, nowMinuteOfDay < sunriseMinuteOfDay {
    return WatchSunEvent(minuteOfDay: sunriseMinuteOfDay, rising: true)
  }
  if let sunsetMinuteOfDay, nowMinuteOfDay < sunsetMinuteOfDay {
    return WatchSunEvent(minuteOfDay: sunsetMinuteOfDay, rising: false)
  }
  if let sunriseMinuteOfDay { return WatchSunEvent(minuteOfDay: sunriseMinuteOfDay, rising: true) }
  guard let sunsetMinuteOfDay else { return nil }
  return WatchSunEvent(minuteOfDay: sunsetMinuteOfDay, rising: false)
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `minuteOfDay`
func watchMinuteOfDay(epochMs: Int64, calendar: Calendar = .current) -> Int {
  let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
  let parts = calendar.dateComponents([.hour, .minute], from: date)
  return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `formatHour`
/// @parity /src/helpers/time.ts `formatTimeOfDay`
func watchFormatHour(_ minuteOfDay: Int, timeFormat: String = "24h", seconds: Int? = nil) -> String {
  let wrapped = ((minuteOfDay % 1440) + 1440) % 1440
  let hour = wrapped / 60
  let displayHour = timeFormat == "12h" ? (hour % 12 == 0 ? 12 : hour % 12) : hour
  let clock = String(format: timeFormat == "12h" ? "%d:%02d" : "%02d:%02d", displayHour, wrapped % 60)
  let precise = seconds.map { clock + String(format: ":%02d", $0) } ?? clock
  return timeFormat == "12h" ? precise + (hour < 12 ? " AM" : " PM") : precise
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `formatClock`
func watchFormatClock(_ epochMs: Int64, timeFormat: String = "24h", withSeconds: Bool = false) -> String {
  let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
  let parts = Calendar.current.dateComponents([.hour, .minute, .second], from: date)
  return watchFormatHour((parts.hour ?? 0) * 60 + (parts.minute ?? 0), timeFormat: timeFormat, seconds: withSeconds ? parts.second : nil)
}
