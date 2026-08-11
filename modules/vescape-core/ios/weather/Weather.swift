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

  var label: String { weatherLabel(code: weatherCode) }

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
  let temps = (hourlyJson?["temperature_2m"] as? [Double]) ?? []
  let codes = (hourlyJson?["weather_code"] as? [Int]) ?? []
  let precips = (hourlyJson?["precipitation_probability"] as? [Int?]) ?? []
  var hourly: [WeatherHour] = []
  for (index, time) in times.enumerated() {
    guard let minute = minuteOfDay(time), index < codes.count else { continue }
    let code = codes[index]
    hourly.append(
      WeatherHour(
        minuteOfDay: minute,
        temperatureC: Int((index < temps.count ? temps[index] : 0).rounded()),
        weatherCode: code,
        icon: weatherIcon(
          code: code,
          night: isNight(minuteOfDay: minute, sunriseMinute: sunriseMinute, sunsetMinute: sunsetMinute)
        ),
        precipitationProbability: (index < precips.count ? precips[index] : nil) ?? 0
      )
    )
  }

  let currentMinute = (current["time"] as? String).flatMap(minuteOfDay)
  return Weather(
    temperatureC: Int(temperature.rounded()),
    weatherCode: currentCode,
    icon: weatherIcon(
      code: currentCode,
      night: isNight(
        minuteOfDay: currentMinute ?? hourly.first?.minuteOfDay ?? 12 * 60,
        sunriseMinute: sunriseMinute,
        sunsetMinute: sunsetMinute
      )
    ),
    precipitationProbability: (current["precipitation_probability"] as? Int) ?? 0,
    hourly: hourly,
    sunriseMinuteOfDay: sunriseMinute,
    sunsetMinuteOfDay: sunsetMinute,
    latitude: latitude,
    longitude: longitude,
    fetchedAtMs: fetchedAtMs
  )
}
