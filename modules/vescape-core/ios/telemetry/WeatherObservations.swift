import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `WEATHER_OBSERVATION_FRESHNESS_MS`
internal let weatherObservationFreshnessMs: Int64 = 24 * 60 * 60 * 1_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `weatherProtectionStart`
internal func weatherProtectionStart(_ startMs: Int64) -> Int64 {
  let (value, overflow) = startMs.subtractingReportingOverflow(weatherObservationFreshnessMs)
  return overflow ? Int64.min : value
}

private let gustStepKmh = 5.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `WeatherObservation`
struct WeatherObservation: Equatable {
  let observedAtMs: Int64
  let temperatureC: Int
  let weatherCode: Int
  let gustKmh: Int?
  let isDay: Bool

  func sameConditions(_ other: WeatherObservation) -> Bool {
    temperatureC == other.temperatureC && weatherCode == other.weatherCode
      && gustKmh == other.gustKmh && isDay == other.isDay
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `WeatherObservation.normalized`
  static func normalized(
    observedAtMs: Int64,
    temperatureC: Double,
    weatherCode: Int,
    gustKmh: Double?,
    isDay: Bool
  ) -> WeatherObservation {
    WeatherObservation(
      observedAtMs: observedAtMs,
      temperatureC: Int((temperatureC + 0.5).rounded(.down)),
      weatherCode: weatherCode,
      gustKmh: gustKmh.flatMap { $0.isFinite ? Int(($0 / gustStepKmh + 0.5).rounded(.down)) * Int(gustStepKmh) : nil },
      isDay: isDay
    )
  }

  init(observedAtMs: Int64, temperatureC: Int, weatherCode: Int, gustKmh: Int?, isDay: Bool) {
    self.observedAtMs = observedAtMs
    self.temperatureC = temperatureC
    self.weatherCode = weatherCode
    self.gustKmh = gustKmh
    self.isDay = isDay
  }

  init(row: Row) {
    observedAtMs = row["observed_at_ms"]
    temperatureC = row["temperature_c"]
    weatherCode = row["weather_code"]
    gustKmh = row["gust_kmh"]
    isDay = row["is_day"]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `shouldStoreWeatherObservation`
internal func shouldStoreWeatherObservation(
  previous: WeatherObservation?,
  next: WeatherObservation,
  force: Bool
) -> Bool {
  guard let previous else { return true }
  if previous.observedAtMs == next.observedAtMs { return false }
  if force { return true }
  if !previous.sameConditions(next) { return true }
  return next.observedAtMs - previous.observedAtMs >= weatherObservationFreshnessMs
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getLatestWeatherObservation`
internal func latestWeatherObservation(_ db: Database, atMs: Int64) throws -> WeatherObservation? {
  try Row.fetchOne(
    db,
    sql: "SELECT * FROM weather_observations WHERE observed_at_ms <= ? ORDER BY observed_at_ms DESC LIMIT 1",
    arguments: [atMs]
  ).map(WeatherObservation.init(row:))
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `getWeatherObservationsSpanning`
internal func weatherObservationsSpanning(_ db: Database, startMs: Int64, endMs: Int64) throws -> [WeatherObservation] {
  try Row.fetchAll(
    db,
    sql: """
      SELECT * FROM weather_observations
      WHERE observed_at_ms <= ?
        AND observed_at_ms >= COALESCE(
          (SELECT MAX(observed_at_ms) FROM weather_observations WHERE observed_at_ms <= ?),
          ?)
      ORDER BY observed_at_ms
      """,
    arguments: [endMs, startMs, startMs]
  ).map(WeatherObservation.init(row:))
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `storeWeatherObservation`
internal func storeWeatherObservation(_ db: Database, _ observation: WeatherObservation, force: Bool) throws -> Bool {
  let previous = try latestWeatherObservation(db, atMs: observation.observedAtMs)
  guard shouldStoreWeatherObservation(previous: previous, next: observation, force: force) else { return false }
  try db.execute(
    sql: "INSERT OR IGNORE INTO weather_observations (observed_at_ms, temperature_c, weather_code, gust_kmh, is_day) VALUES (?, ?, ?, ?, ?)",
    arguments: [observation.observedAtMs, observation.temperatureC, observation.weatherCode, observation.gustKmh, observation.isDay]
  )
  return db.changesCount > 0
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `WeatherObservationRecorder`
final class WeatherObservationRecorder {
  static let process = WeatherObservationRecorder(writer: { try VescapeDatabase.requirePool() })

  private let writer: () throws -> any DatabaseWriter
  private let fence: DatabaseReplacementFence
  private var storedThisProcess = false

  init(writer: @escaping () throws -> any DatabaseWriter, fence: DatabaseReplacementFence = .process) {
    self.writer = writer
    self.fence = fence
  }

  func ticket() -> Int64 { fence.ticket() }

  func record(_ observation: WeatherObservation, ticket: Int64) throws -> Bool {
    try fence.write(ticket: ticket) { () throws -> Bool in
      let force = !storedThisProcess
      let stored = try writer().write { db in try storeWeatherObservation(db, observation, force: force) }
      storedThisProcess = true
      return stored
    } ?? false
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `RideWeather`
/// @parity /modules/vescape-core/src/index.ts `RideWeather`
struct RideWeather: Equatable {
  let icon: String
  let minTemperatureC: Int
  let maxTemperatureC: Int
  let maxGustKmh: Int?
  let rainMinutes: Int

  var map: [String: Any?] {
    [
      "icon": icon,
      "minTemperatureC": minTemperatureC,
      "maxTemperatureC": maxTemperatureC,
      "maxGustKmh": maxGustKmh,
      "rainMinutes": rainMinutes,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `summarizeRideWeather`
internal func summarizeRideWeather(_ rows: [WeatherObservation], startMs: Int64, endMs: Int64) -> RideWeather? {
  let anchor = rows.last { $0.observedAtMs <= startMs }
    .flatMap { startMs - $0.observedAtMs <= weatherObservationFreshnessMs ? $0 : nil }
  let inside = rows.filter { $0.observedAtMs > startMs && $0.observedAtMs <= endMs }
  let applicable = (anchor.map { [$0] } ?? []) + inside
  guard !applicable.isEmpty else { return nil }

  let weights: [Int64] = applicable.indices.map { index in
    let from = max(applicable[index].observedAtMs, startMs)
    let until = index + 1 < applicable.count ? applicable[index + 1].observedAtMs : endMs
    return max(until - from, 0)
  }
  let effective = weights.allSatisfy { $0 == 0 } ? weights.indices.map { $0 == 0 ? Int64(1) : 0 } : weights

  var order: [WeatherIcon] = []
  var iconTime: [WeatherIcon: Int64] = [:]
  var iconCode: [WeatherIcon: Int] = [:]
  var nightTime: Int64 = 0
  var dayTime: Int64 = 0
  var rainTime: Int64 = 0
  for (index, row) in applicable.enumerated() {
    let time = effective[index]
    let icon = weatherIcon(code: row.weatherCode, night: false)
    if iconTime[icon] == nil { order.append(icon); iconCode[icon] = row.weatherCode }
    iconTime[icon, default: 0] += time
    if row.isDay { dayTime += time } else { nightTime += time }
    if icon == .cloudRain || icon == .cloudLightning { rainTime += time }
  }
  let counted = applicable.indices.filter { effective[$0] > 0 }.map { applicable[$0] }
  var dominant = order[0]
  for icon in order where iconTime[icon]! > iconTime[dominant]! { dominant = icon }
  return RideWeather(
    icon: weatherIcon(code: iconCode[dominant]!, night: nightTime > dayTime).rawValue,
    minTemperatureC: counted.map(\.temperatureC).min()!,
    maxTemperatureC: counted.map(\.temperatureC).max()!,
    maxGustKmh: counted.compactMap(\.gustKmh).max(),
    rainMinutes: Int((Double(rainTime) / 60_000 + 0.5).rounded(.down))
  )
}

internal func rideWeather(_ db: Database, startMs: Int64, endMs: Int64) throws -> RideWeather? {
  summarizeRideWeather(try weatherObservationsSpanning(db, startMs: startMs, endMs: endMs), startMs: startMs, endMs: endMs)
}
