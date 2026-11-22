import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchWeather.kt `toWatchWeather`
extension Weather {
  var watchWeather: WatchWeather {
    WatchWeather(
      temperatureC: temperatureC,
      icon: icon.rawValue,
      label: label,
      precipitationProbability: precipitationProbability,
      hourly: hourly.map {
        WatchWeatherHour(
          minuteOfDay: $0.minuteOfDay,
          temperatureC: $0.temperatureC,
          icon: $0.icon.rawValue,
          precipitationProbability: $0.precipitationProbability
        )
      },
      sunriseMinuteOfDay: sunriseMinuteOfDay,
      sunsetMinuteOfDay: sunsetMinuteOfDay,
      latitude: latitude,
      longitude: longitude,
      fetchedAtMs: fetchedAtMs
    )
  }
}
