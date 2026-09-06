import Foundation

/// One forecast fetch attempt. `nil` body means "no usable response" (transport or HTTP error).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `WeatherTransport`
typealias WeatherTransport = (_ url: String, _ onResult: @escaping (Data?) -> Void) -> Void

/// Process-owned weather truth. Every GPS Fix offers the coordinator a position; it refetches only
/// when the rider has moved far enough or the forecast has aged out, and keeps the last **successful**
/// result for the life of the process.
///
/// It lives native rather than in JS because the consumers that matter outlive the JS runtime: the
/// wrist mirror keeps rendering through a backgrounded phone, and Weather Alerts (a later slice) have
/// to fire while nobody is looking at a screen.
///
/// Failure semantics match App Status: a failed refresh never clears a known forecast, and nothing is
/// persisted, so a fresh process starts empty.
///
/// Main-thread affine: GPS Fixes arrive on the main thread and the URLSession transport hops back
/// there before touching state.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt
final class WeatherCoordinator {
  /// How long a forecast stays good. Open-Meteo publishes hourly; ten minutes keeps the readout
  /// honest without spending a request per GPS Fix on a free API.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `FORECAST_TTL_MS`
  static let forecastTtlMs: Int64 = 10 * 60 * 1_000

  /// How far the rider must move before the cached forecast stops describing where they are.
  /// ~1.1 km at the equator — under a single Open-Meteo grid cell, so a shorter hop would refetch
  /// the same numbers.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `REFETCH_DELTA_DEG`
  static let refetchDeltaDeg = 0.01

  /// Hours of forecast requested — one wrist page plus the phone's hourly strip.
  static let forecastHours = 12

  private static let callTimeoutSeconds: TimeInterval = 10

  /// Process singleton — its in-memory forecast must outlive JS runtime reloads.
  static let shared = WeatherCoordinator(transport: urlSessionTransport())

  /// Last successful forecast for this process, or `nil` while none has landed.
  private(set) var current: Weather?

  /// Notified on every change so the module can mirror it to JS.
  var onChange: ((Weather?) -> Void)?

  private let transport: WeatherTransport
  private let nowMs: () -> Int64
  private var fetching = false

  /// Where the rider was when a Fix arrived mid-fetch. A ride moves during the seconds a request
  /// takes, and dropping those Fixes outright would leave the forecast pinned to wherever the ride
  /// started if GPS then stops. Re-evaluated once the in-flight request lands.
  private var pendingPosition: (latitude: Double, longitude: Double)?

  init(
    transport: @escaping WeatherTransport,
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  ) {
    self.transport = transport
    self.nowMs = nowMs
  }

  /// Offer the rider's current position. Cheap to call per GPS Fix: it refetches only when nothing is
  /// known yet, when the forecast has aged past `forecastTtlMs`, or when the rider has left the area
  /// the current forecast was fetched for.
  func onPosition(latitude: Double, longitude: Double) {
    guard latitude.isFinite, longitude.isFinite else { return }
    if let known = current,
       nowMs() - known.fetchedAtMs < Self.forecastTtlMs,
       abs(known.latitude - latitude) < Self.refetchDeltaDeg,
       abs(known.longitude - longitude) < Self.refetchDeltaDeg {
      return
    }
    refresh(latitude: latitude, longitude: longitude)
  }

  /// Refetch where the last forecast was fetched, ignoring the freshness gate — the rider asking for
  /// fresh weather. A no-op before the first fetch: there is no position to ask about, and the next
  /// GPS Fix will bring one.
  func refresh() {
    guard let known = current else { return }
    refresh(latitude: known.latitude, longitude: known.longitude)
  }

  /// Fetch now for an explicit position, ignoring the freshness gate. A refresh asked for while one
  /// is already in flight is dropped: the in-flight request answers it.
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
    // Silent on failure by design: expected offline, and it must never clear a known forecast.
    if let body,
       let weather = parseOpenMeteoWeather(
         body,
         latitude: latitude,
         longitude: longitude,
         fetchedAtMs: nowMs()
       ) {
      current = weather
      onChange?(weather)
    }
    // The ride moved while this request was in flight. Re-offer the newest position through the
    // normal gate, so it refetches only if it actually left the area this forecast describes.
    guard let pending = pendingPosition else { return }
    pendingPosition = nil
    onPosition(latitude: pending.latitude, longitude: pending.longitude)
  }

  /// Open-Meteo forecast endpoint. Public and keyless, which is why it is called directly rather
  /// than through `VescapeApi`.
  ///
  /// `timezone=auto` resolves the zone of the **forecast location**, which is what the hour labels
  /// claim to be. The device zone would be a different thing the moment a rider crosses a border or
  /// turns automatic time off.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherCoordinator.kt `forecastUrl`
  static func forecastUrl(latitude: Double, longitude: Double) -> String {
    "https://api.open-meteo.com/v1/forecast"
      + "?latitude=\(latitude)&longitude=\(longitude)"
      + "&current=temperature_2m,weather_code,precipitation_probability"
      + "&hourly=temperature_2m,weather_code,precipitation_probability"
      + "&daily=sunrise,sunset"
      + "&forecast_hours=\(forecastHours)&forecast_days=1"
      + "&timezone=auto"
  }

  /// Default transport: one short-timeout GET, result handed back on the main thread.
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
