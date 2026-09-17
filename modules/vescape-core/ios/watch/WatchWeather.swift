import Foundation

/// Channel the forecast occupies inside the shared Application Context (see `WatchColdState`).
///
/// Cold state like the settings: the forecast changes once per refresh at most — never per tick —
/// so it rides the Application Context and survives a restart or a reconnect instead of being
/// dropped like an undelivered message. Android publishes the same bag on its own Data Layer path.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `WATCH_WEATHER_PATH`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WEATHER_PATH`
/// @platform-diff Android gets one Data Layer path per channel; watchOS has a single Application
///   Context, so `weather` is a key in the merged dictionary rather than a path of its own.
let watchWeatherChannel = "weather"

/// Wire keys, identical to Android's so the two wrists read the same bag.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt
enum WatchWeatherKey {
  /// Current temperature, whole degrees Celsius.
  static let temperatureC = "temperatureC"
  /// Condition pictogram slug, resolved by native so the wrist never classifies a WMO code.
  static let icon = "icon"
  /// One-line condition label, already phrased for a wrist-width readout.
  static let label = "label"
  /// Chance of precipitation right now, percent.
  static let precipitationProbability = "precipitationProbability"
  /// Forecast hours, packed as parallel arrays so the bag stays flat key-value.
  static let hourMinutes = "hourMinutes"
  static let hourTemps = "hourTemps"
  static let hourIcons = "hourIcons"
  static let hourPrecips = "hourPrecips"
  /// Sunrise / sunset as minutes since local midnight, absent when the forecast carried neither
  /// (polar day, or a provider response without daily times). Both or nothing: a lone sunrise
  /// reads as a bug.
  static let sunrise = "sunriseMinuteOfDay"
  static let sunset = "sunsetMinuteOfDay"
  /// Where the forecast was taken, so the wrist can ask a radar provider for imagery around the
  /// rider. The forecast location, not a live fix: it moves once per forecast refresh, which is the
  /// accuracy a radar frame kilometres across is drawn at anyway.
  static let latitude = "latitude"
  static let longitude = "longitude"
  /// When the forecast was fetched, so the wrist can age out a reading the phone stopped refreshing.
  static let fetchedAtMs = "fetchedAtMs"
}

/// One forecast hour, as the wrist renders it. `minuteOfDay` is local to the forecast location.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WatchWeatherHour`
struct WatchWeatherHour: Equatable {
  var minuteOfDay: Int
  var temperatureC: Int
  var icon: String
  var precipitationProbability: Int
}

/// The forecast on the wrist. Absent until the phone has pushed one — the wrist never fetches a
/// forecast, and a phone that has not seen a GPS Fix yet has nothing to send.
///
/// One file compiled into both the phone target and the watch target, so the writer and the reader
/// cannot drift; `WatchSettings.swift` already uses that arrangement, and Android has to duplicate
/// the same bag by convention across two Gradle modules.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `WatchWeather`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WatchWeather`
struct WatchWeather {
  var temperatureC: Int
  var icon: String
  var label: String
  var precipitationProbability: Int
  var hourly: [WatchWeatherHour]
  /// Minutes since local midnight; nil when the phone had no daily times to send.
  var sunriseMinuteOfDay: Int?
  var sunsetMinuteOfDay: Int?
  /// Where the forecast was taken. Nil from a phone too old to send it, which is why the radar page
  /// can be empty on a wrist that is otherwise showing weather fine.
  var latitude: Double?
  var longitude: Double?
  var fetchedAtMs: Int64

  /// The wire bag. Parallel arrays rather than a list of dictionaries, matching the Wear OS
  /// `DataMap`: both ends already agree on the key names, and a flat bag is what makes an unknown
  /// key ignorable by an older wrist.
  ///
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
    // Omitted rather than sent as a sentinel: the wrist reads absence directly.
    if let sunriseMinuteOfDay { payload[WatchWeatherKey.sunrise] = sunriseMinuteOfDay }
    if let sunsetMinuteOfDay { payload[WatchWeatherKey.sunset] = sunsetMinuteOfDay }
    if let latitude { payload[WatchWeatherKey.latitude] = latitude }
    if let longitude { payload[WatchWeatherKey.longitude] = longitude }
    return payload
  }

  /// Read the bag leniently. A forecast without current conditions is nothing at all rather than a
  /// fabricated 0 °C clear sky — the same rule the phone's own parser follows for a short hourly
  /// array. The hours are parallel arrays, so an hour is kept only where every lane has a value.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `readWeather`
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

  /// The weather channel of a whole Application Context. An absent channel is no forecast, which is
  /// also what a wrist reads before the phone has ever seen a GPS Fix.
  static func decode(context: [String: Any]) -> WatchWeather? {
    decode(context[watchWeatherChannel] as? [String: Any])
  }

  /// Whether this forecast is still worth showing. The Application Context keeps the last value
  /// forever, so a phone that stopped refreshing (app killed, out of range, GPS off) would
  /// otherwise leave yesterday's conditions on the wrist looking current.
  ///
  /// A clock that jumped backwards (timezone or NTP correction) must not read as "from the future"
  /// and hide a forecast that is fine; only real age hides it.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  func isFresh(nowMs: Int64) -> Bool { nowMs - fetchedAtMs <= watchWeatherStaleMs }
}

/// How long a pushed forecast is worth showing. Generous next to the phone's ten-minute refresh:
/// this is the line between "a bit old" and "not weather any more".
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WEATHER_STALE_MS`
let watchWeatherStaleMs: Int64 = 3 * 60 * 60 * 1_000

/// Two forecasts that look identical on the wrist are the same push, so the comparison deliberately
/// leaves out `fetchedAtMs` — refetching the same numbers ten minutes later is not a redraw.
///
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

/// Which sun event the rider still has ahead of them, and when.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `SunEvent`
struct WatchSunEvent: Equatable {
  var minuteOfDay: Int
  var rising: Bool
}

/// The next sun event from now: sunrise while the sun is still down, sunset once it is up, and
/// tomorrow's sunrise after dark. Nil when the phone sent neither time.
///
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

/// Minutes since local midnight for an instant, the unit every wrist time is formatted from.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `minuteOfDay`
func watchMinuteOfDay(epochMs: Int64, calendar: Calendar = .current) -> Int {
  let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
  let parts = calendar.dateComponents([.hour, .minute], from: date)
  return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
}

/// `HH:MM` for a minute-of-day. Always 24 h, matching Wear OS, so a forecast hour and a frame time
/// never disagree about what "13:00" is.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `formatHour`
func watchFormatHour(_ minuteOfDay: Int) -> String {
  // Floor-mod: a negative minute-of-day can only come from a corrupt bag, and `%` would print a
  // minus sign into a clock face.
  let wrapped = ((minuteOfDay % (24 * 60)) + 24 * 60) % (24 * 60)
  return String(format: "%02d:%02d", wrapped / 60, wrapped % 60)
}
