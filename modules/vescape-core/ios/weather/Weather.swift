import Foundation

/// The condition pictogram a forecast resolves to. Native owns the classification so the phone, the
/// wrist and Android cannot drift apart on what a WMO code looks like; every renderer only maps a
/// slug to its own artwork and palette.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherIcon`
/// @parity /modules/vescape-core/src/index.ts `WeatherIconSlug`
enum WeatherIcon: String {
  case sun
  case moon
  case cloudSun = "cloud-sun"
  case cloudMoon = "cloud-moon"
  case cloud
  case cloudFog = "cloud-fog"
  case cloudRain = "cloud-rain"
  case cloudSnow = "cloud-snow"
  case cloudLightning = "cloud-lightning"
}

/// WMO weather code into a pictogram. Only the clear and lightly-clouded codes have a night form;
/// rain looks the same at every hour.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `weatherIcon`
func weatherIcon(code: Int, night: Bool) -> WeatherIcon {
  switch code {
  case 0: return night ? .moon : .sun
  case ...2: return night ? .cloudMoon : .cloudSun
  case 3: return .cloud
  case 45, 48: return .cloudFog
  case 51...57, 61...67, 80...82: return .cloudRain
  case 71, 73, 75, 77, 85, 86: return .cloudSnow
  case 95, 96, 99: return .cloudLightning
  default: return .cloud
  }
}

/// Human label for a WMO code. One line, wrist-width, and deliberately coarser than the WMO table:
/// a rider needs "Rain", not "moderate intensity rain showers".
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `weatherLabel`
func weatherLabel(code: Int) -> String {
  switch code {
  case 0: return "Clear sky"
  case ...2: return "Partly cloudy"
  case 3: return "Overcast"
  case 45, 48: return "Fog"
  case 51...57: return "Drizzle"
  case 61...67, 80...82: return "Rain"
  case 71, 73, 75, 77, 85, 86: return "Snow"
  case 95, 96, 99: return "Thunderstorm"
  default: return "Cloudy"
  }
}

/// One forecast hour. Times are local to the forecast location (Open-Meteo is asked for the device
/// timezone), carried as minutes since local midnight so no renderer has to parse an ISO string.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherHour`
/// @parity /modules/vescape-core/src/index.ts `WeatherHour`
struct WeatherHour {
  let minuteOfDay: Int
  let temperatureC: Int
  let weatherCode: Int
  let icon: WeatherIcon
  let precipitationProbability: Int

  var map: [String: Any?] {
    [
      "minuteOfDay": minuteOfDay,
      "temperatureC": temperatureC,
      "weatherCode": weatherCode,
      "icon": icon.rawValue,
      "precipitationProbability": precipitationProbability,
    ]
  }
}

/// One forecast period in absolute time, the shape the Weather Alert Evaluator reads. Open-Meteo
/// values describe the period *before* their timestamp, so `startMs` is that timestamp minus the
/// period. Precipitation is normalised to mm/h whatever the period; probability exists hourly only.
/// Native-only: the JS payload keeps `WeatherHour`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherSlot`
struct WeatherSlot: Equatable {
  let startMs: Int64
  let endMs: Int64
  let precipitationMmPerHour: Double
  let precipitationProbability: Int?
  let weatherCode: Int?
  let windGustsKmh: Double?
}

/// The weather where the rider is. Native truth: fetched, cached and aged natively so every consumer
/// keeps seeing it while the JS runtime is gone.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `Weather`
/// @parity /modules/vescape-core/src/index.ts `Weather`
struct Weather {
  let temperatureC: Int
  let weatherCode: Int
  let icon: WeatherIcon
  let precipitationProbability: Int
  let hourly: [WeatherHour]
  /// Minutes since local midnight, or nil when the forecast omitted the day's sun times.
  let sunriseMinuteOfDay: Int?
  let sunsetMinuteOfDay: Int?
  let latitude: Double
  let longitude: Double
  let fetchedAtMs: Int64
  /// Hourly series as absolute slots, for Weather Alerts. Not mirrored to JS.
  var hourlySlots: [WeatherSlot] = []
  /// `minutely_15` series as absolute slots, for Weather Alerts. Not mirrored to JS.
  var quarterHourSlots: [WeatherSlot] = []
  /// Unrounded current temperature, normalized only when stored.
  var currentTemperatureC: Double?
  /// Open-Meteo `current.time` as epoch ms, or nil when the response carried none.
  var observedAtMs: Int64?
  /// Current `wind_gusts_10m` in km/h, or nil when the response omitted it.
  var windGustsKmh: Double?
  /// Current `is_day`; falls back to the sunrise/sunset night window when omitted.
  var isDay = true

  var label: String { weatherLabel(code: weatherCode) }

  /// Normalized current conditions for `weather_observations`, or nil without an observation time:
  /// a row must say when the weather was, not when it was fetched.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `Weather.observation`
  var observation: WeatherObservation? {
    guard let observedAtMs else { return nil }
    return WeatherObservation.normalized(
      observedAtMs: observedAtMs,
      temperatureC: currentTemperatureC ?? Double(temperatureC),
      weatherCode: weatherCode,
      gustKmh: windGustsKmh,
      isDay: isDay
    )
  }

  var map: [String: Any?] {
    [
      "temperatureC": temperatureC,
      "weatherCode": weatherCode,
      "icon": icon.rawValue,
      "label": label,
      "precipitationProbability": precipitationProbability,
      "hourly": hourly.map { $0.map },
      "sunriseMinuteOfDay": sunriseMinuteOfDay,
      "sunsetMinuteOfDay": sunsetMinuteOfDay,
      "latitude": latitude,
      "longitude": longitude,
      "fetchedAtMs": fetchedAtMs,
    ]
  }
}

/// Minutes since local midnight in an Open-Meteo `YYYY-MM-DDTHH:MM` stamp, or nil if unparseable.
func minuteOfDay(_ isoLocalTime: String) -> Int? {
  guard let timePart = isoLocalTime.split(separator: "T").last else { return nil }
  let fields = timePart.split(separator: ":")
  guard fields.count >= 2, let hour = Int(fields[0]), let minute = Int(fields[1].prefix(2)) else {
    return nil
  }
  return hour * 60 + minute
}

/// Epoch ms of an Open-Meteo local `YYYY-MM-DDTHH:MM` stamp at the response's `utc_offset_seconds`.
/// One offset covers the whole window, so a slot past a DST change inside it is off by that hour.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `epochMs`
func epochMs(_ isoLocalTime: String, utcOffsetSeconds: Int) -> Int64? {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(secondsFromGMT: utcOffsetSeconds)
  formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
  guard let date = formatter.date(from: isoLocalTime) else { return nil }
  return Int64((date.timeIntervalSince1970 * 1000).rounded())
}

/// One Open-Meteo series into `WeatherSlot`s of `periodMinutes`; `precipitationScale` turns the
/// series' per-period precipitation into mm/h. A slot without a precipitation value is dropped.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `weatherSlots`
private func weatherSlots(
  _ series: [String: Any]?,
  utcOffsetSeconds: Int?,
  periodMinutes: Int64,
  precipitationScale: Double
) -> [WeatherSlot] {
  guard let series, let utcOffsetSeconds, let times = series["time"] as? [String],
        let precips = series["precipitation"] as? [Double?]
  else { return [] }
  let probabilities = (series["precipitation_probability"] as? [Int?]) ?? []
  let codes = (series["weather_code"] as? [Int?]) ?? []
  let gusts = (series["wind_gusts_10m"] as? [Double?]) ?? []
  func at<T>(_ values: [T?], _ index: Int) -> T? { index < values.count ? values[index] : nil }
  return times.enumerated().compactMap { index, time in
    guard let endMs = epochMs(time, utcOffsetSeconds: utcOffsetSeconds), let precip = at(precips, index) else {
      return nil
    }
    return WeatherSlot(
      startMs: endMs - periodMinutes * 60_000,
      endMs: endMs,
      precipitationMmPerHour: precip * precipitationScale,
      precipitationProbability: at(probabilities, index),
      weatherCode: at(codes, index),
      windGustsKmh: at(gusts, index)
    )
  }
}

/// Whether a local time falls outside daylight. Sunrise/sunset come from the same forecast, so a
/// polar summer resolves correctly; a forecast that omits them falls back to a fixed night window.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `isNight`
func isNight(minuteOfDay: Int, sunriseMinute: Int?, sunsetMinute: Int?) -> Bool {
  guard let sunriseMinute, let sunsetMinute else {
    let hour = minuteOfDay / 60
    return hour >= 21 || hour < 6
  }
  return minuteOfDay < sunriseMinute || minuteOfDay >= sunsetMinute
}

/// Open-Meteo forecast response into a `Weather`. Returns nil when the payload carries no usable
/// current conditions — a partial forecast is not worth showing a rider a wrong number for.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `parseOpenMeteoWeather`
func parseOpenMeteoWeather(
  _ body: Data,
  latitude: Double,
  longitude: Double,
  fetchedAtMs: Int64
) -> Weather? {
  // intentional-suppression: malformed remote weather produces an explicit unavailable result
  guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
        let current = root["current"] as? [String: Any],
        let temperature = current["temperature_2m"] as? Double,
        let currentCode = current["weather_code"] as? Int
  else { return nil }

  let daily = root["daily"] as? [String: Any]
  let sunriseMinute = ((daily?["sunrise"] as? [String])?.first).flatMap(minuteOfDay)
  let sunsetMinute = ((daily?["sunset"] as? [String])?.first).flatMap(minuteOfDay)

  let hourlyJson = root["hourly"] as? [String: Any]
  let times = (hourlyJson?["time"] as? [String]) ?? []
  // Optional element types throughout: a single null anywhere would fail a `[Double]` cast and drop
  // the whole day, where the parallel-array contract only loses the hour that is actually missing.
  let temps = (hourlyJson?["temperature_2m"] as? [Double?]) ?? []
  let codes = (hourlyJson?["weather_code"] as? [Int?]) ?? []
  let precips = (hourlyJson?["precipitation_probability"] as? [Int?]) ?? []
  var hourly: [WeatherHour] = []
  for (index, time) in times.enumerated() {
    // Every required field must be present at this index. The arrays are parallel but independent,
    // and a short one would otherwise read as 0 — a fabricated clear sky at 0 °C, which looks like
    // real weather rather than like missing data.
    guard let minute = minuteOfDay(time),
          index < codes.count, let code = codes[index],
          index < temps.count, let temperature = temps[index]
    else { continue }
    hourly.append(
      WeatherHour(
        minuteOfDay: minute,
        temperatureC: Int(temperature.rounded()),
        weatherCode: code,
        icon: weatherIcon(
          code: code,
          night: isNight(minuteOfDay: minute, sunriseMinute: sunriseMinute, sunsetMinute: sunsetMinute)
        ),
        precipitationProbability: (index < precips.count ? precips[index] : nil) ?? 0
      )
    )
  }

  let currentTime = current["time"] as? String
  let currentMinute = currentTime.flatMap(minuteOfDay)
  let utcOffsetSeconds = root["utc_offset_seconds"] as? Int
  let night = isNight(
    minuteOfDay: currentMinute ?? hourly.first?.minuteOfDay ?? 12 * 60,
    sunriseMinute: sunriseMinute,
    sunsetMinute: sunsetMinute
  )
  var weather = Weather(
    temperatureC: Int(temperature.rounded()),
    weatherCode: currentCode,
    icon: weatherIcon(code: currentCode, night: night),
    precipitationProbability: (current["precipitation_probability"] as? Int) ?? 0,
    hourly: hourly,
    sunriseMinuteOfDay: sunriseMinute,
    sunsetMinuteOfDay: sunsetMinute,
    latitude: latitude,
    longitude: longitude,
    fetchedAtMs: fetchedAtMs,
    hourlySlots: weatherSlots(hourlyJson, utcOffsetSeconds: utcOffsetSeconds, periodMinutes: 60, precipitationScale: 1),
    // `minutely_15` precipitation is mm per 15 min.
    quarterHourSlots: weatherSlots(
      root["minutely_15"] as? [String: Any],
      utcOffsetSeconds: utcOffsetSeconds,
      periodMinutes: 15,
      precipitationScale: 4
    )
  )
  weather.currentTemperatureC = temperature
  if let currentTime, let utcOffsetSeconds {
    weather.observedAtMs = epochMs(currentTime, utcOffsetSeconds: utcOffsetSeconds)
  }
  weather.windGustsKmh = (current["wind_gusts_10m"] as? NSNumber)?.doubleValue
  weather.isDay = (current["is_day"] as? NSNumber).map { $0.intValue != 0 } ?? !night
  return weather
}
