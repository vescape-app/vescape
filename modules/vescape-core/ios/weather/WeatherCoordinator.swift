import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `WeatherTransport`
typealias WeatherTransport = (_ url: String, _ onResult: @escaping (Data?) -> Void) -> Void

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt
final class WeatherCoordinator {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `FORECAST_TTL_MS`
  static let forecastTtlMs: Int64 = 10 * 60 * 1_000

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `REFETCH_DELTA_DEG`
  static let refetchDeltaDeg = 0.01

  static let forecastHours = 12

  static let forecastQuarterHours = 12

  private static let callTimeoutSeconds: TimeInterval = 10

  static let shared = WeatherCoordinator(transport: urlSessionTransport())

  private(set) var current: Weather?

  var onChange: ((Weather?) -> Void)?

  private var nativeListeners: [UUID: (Weather) -> Void] = [:]

  private let transport: WeatherTransport
  private let nowMs: () -> Int64
  private var fetching = false

  private var pendingPosition: (latitude: Double, longitude: Double)?

  private var lastPosition: (latitude: Double, longitude: Double)?

  init(
    transport: @escaping WeatherTransport,
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  ) {
    self.transport = transport
    self.nowMs = nowMs
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `addChangeListener`
  func addNativeChangeListener(_ listener: @escaping (Weather) -> Void) -> () -> Void {
    let id = UUID()
    nativeListeners[id] = listener
    return { [weak self] in self?.nativeListeners[id] = nil }
  }

  func onPosition(latitude: Double, longitude: Double) {
    guard latitude.isFinite, longitude.isFinite else { return }
    lastPosition = (latitude, longitude)
    if let known = current,
       nowMs() - known.fetchedAtMs < Self.forecastTtlMs,
       abs(known.latitude - latitude) < Self.refetchDeltaDeg,
       abs(known.longitude - longitude) < Self.refetchDeltaDeg {
      return
    }
    refresh(latitude: latitude, longitude: longitude)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `refresh`
  func refresh() {
    guard let position = lastPosition else { return }
    refresh(latitude: position.latitude, longitude: position.longitude)
  }

  func refresh(latitude: Double, longitude: Double) {
    guard !fetching else {
      pendingPosition = (latitude, longitude)
      return
    }
    fetching = true
    transport(Self.forecastUrl(latitude: latitude, longitude: longitude)) { [weak self] body in
      self?.onFetched(body, latitude: latitude, longitude: longitude)
    }
  }

  private func onFetched(_ body: Data?, latitude: Double, longitude: Double) {
    fetching = false
    if let body,
       let weather = parseOpenMeteoWeather(
         body,
         latitude: latitude,
         longitude: longitude,
         fetchedAtMs: nowMs()
       ) {
      current = weather
      onChange?(weather)
      nativeListeners.values.forEach { $0(weather) }
    }
    guard let pending = pendingPosition else { return }
    pendingPosition = nil
    onPosition(latitude: pending.latitude, longitude: pending.longitude)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `forecastUrl`
  static func forecastUrl(latitude: Double, longitude: Double) -> String {
    "https://api.open-meteo.com/v1/forecast"
      + "?latitude=\(latitude)&longitude=\(longitude)"
      + "&current=temperature_2m,weather_code,precipitation_probability,wind_gusts_10m,is_day"
      + "&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_gusts_10m"
      + "&minutely_15=precipitation,weather_code,wind_gusts_10m"
      + "&forecast_minutely_15=\(forecastQuarterHours)"
      + "&daily=sunrise,sunset"
      + "&forecast_hours=\(forecastHours)&forecast_days=1"
      + "&timezone=auto"
  }

  private static func urlSessionTransport() -> WeatherTransport {
    { url, onResult in
      guard let target = URL(string: url) else {
        DispatchQueue.main.async { onResult(nil) }
        return
      }
      var request = URLRequest(url: target)
      request.timeoutInterval = callTimeoutSeconds
      URLSession.shared.dataTask(with: request) { data, response, _ in
        let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        DispatchQueue.main.async { onResult(ok ? data : nil) }
      }.resume()
    }
  }
}
