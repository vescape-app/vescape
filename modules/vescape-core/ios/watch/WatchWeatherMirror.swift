import Foundation

/// Everything the wrist mirrors from the phone's forecast. Phone-side only: `WatchWeather.swift` is
/// symlinked into the watch target and the wrist has no `Weather` to convert from.
///
/// Adding a field means adding a key constant in `WatchWeatherKey`, a value in `payload`, a read in
/// `decode`, and a render on the wrist.
///
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
