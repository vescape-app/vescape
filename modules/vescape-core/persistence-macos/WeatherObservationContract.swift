import Foundation
import GRDB

/// Ride weather storage (#604) through the production GRDB statements, recorder and fence.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/WeatherObservationHostTest.kt
func runWeatherObservationContract() throws {
  let hour: Int64 = 3_600_000
  let day = 24 * hour
  func obs(_ at: Int64, temp: Int = 14, code: Int = 3, gust: Int? = 20, isDay: Bool = true) -> WeatherObservation {
    WeatherObservation(observedAtMs: at, temperatureC: temp, weatherCode: code, gustKmh: gust, isDay: isDay)
  }
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("weather-\(UUID().uuidString).db")
  defer { try? FileManager.default.removeItem(at: url) }
  var queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  func stored() throws -> [WeatherObservation] {
    try queue.read { db in try weatherObservationsSpanning(db, startMs: 0, endMs: 100 * day) }
  }

  // Launch refresh, unchanged refreshes across 24 h, changed conditions.
  let first = WeatherObservationRecorder(writer: { queue }, fence: DatabaseReplacementFence())
  try require(try first.record(obs(0), ticket: first.ticket()), "first refresh after launch")
  try require(!(try first.record(obs(hour), ticket: first.ticket())), "unchanged an hour later")
  try require(!(try first.record(obs(day - 1), ticket: first.ticket())), "unchanged just under a day")
  try require(try first.record(obs(day - 1 + hour, temp: 15), ticket: first.ticket()), "changed conditions write at once")
  try require(!(try first.record(obs(2 * day, temp: 15), ticket: first.ticket())), "unchanged after a change")
  try require(try first.record(obs(2 * day - 1 + hour, temp: 15), ticket: first.ticket()), "a day after the last stored row")
  try queue.close()
  queue = try DatabaseQueue(path: url.path)
  let relaunched = WeatherObservationRecorder(writer: { queue }, fence: DatabaseReplacementFence())
  try require(try relaunched.record(obs(2 * day + 2 * hour, temp: 15), ticket: relaunched.ticket()), "relaunch writes")
  try require(!(try relaunched.record(obs(2 * day + 3 * hour, temp: 15), ticket: relaunched.ticket())), "relaunch then unchanged")
  try require(try stored().count == 4, "launch/change/freshness rows")

  // A repeated API timestamp never renews or duplicates.
  try require(!(try relaunched.record(obs(2 * day + 2 * hour, temp: 30), ticket: relaunched.ticket())), "duplicate timestamp")
  try require(try stored().last?.temperatureC == 15, "duplicate kept the first row")

  // A failed or timeless refresh manufactures nothing.
  try require(parseOpenMeteoWeather(Data("not json".utf8), latitude: 0, longitude: 0, fetchedAtMs: 0) == nil, "failed refresh")
  let noTime = #"{"utc_offset_seconds":0,"current":{"temperature_2m":12.4,"weather_code":3}}"#
  try require(parseOpenMeteoWeather(Data(noTime.utf8), latitude: 0, longitude: 0, fetchedAtMs: 99)?.observation == nil, "no observation time")
  let body = #"{"utc_offset_seconds":3600,"current":{"time":"2026-10-25T14:00","temperature_2m":12.6,"weather_code":61,"wind_gusts_10m":23.0,"is_day":0}}"#
  let parsed = parseOpenMeteoWeather(Data(body.utf8), latitude: 0, longitude: 0, fetchedAtMs: 99)?.observation
  try require(parsed == obs(1_792_933_200_000, temp: 13, code: 61, gust: 25, isDay: false), "normalized observation")

  // Restore or Clear all fences a write that landed before it.
  let fence = DatabaseReplacementFence()
  let fenced = WeatherObservationRecorder(writer: { queue }, fence: fence)
  let staleTicket = fenced.ticket()
  try fence.fence { try TelemetryMaintenancePersistence(writer: queue).clear(protectedRanges: []) }
  try require(!(try fenced.record(obs(0), ticket: staleTicket)), "fenced late write")
  try require(try stored().isEmpty, "clear removed observations")
  try require(try fenced.record(obs(hour), ticket: fenced.ticket()), "fenced write kept the launch write")

  // Clear keeps the rows a Favorite reads.
  try queue.write { db in
    try db.execute(sql: "DELETE FROM weather_observations")
    for at in [0, 10 * day, 20 * day + 1, 21 * day, 30 * day] { _ = try storeWeatherObservation(db, obs(at, temp: Int(at % 7)), force: true) }
  }
  try TelemetryMaintenancePersistence(writer: queue).clear(protectedRanges: [TelemetryTimeRange(startMs: 21 * day, endMs: 22 * day)])
  try require(try stored().map(\.observedAtMs) == [20 * day + 1, 21 * day], "clear keeps Favorite weather")
  try TelemetryMaintenancePersistence(writer: queue).clear(protectedRanges: [TelemetryTimeRange(startMs: Int64.min, endMs: Int64.max)])
  try require(try stored().count == 2, "protect-all clear does not overflow")

  // Ride weather: five minutes of rain in a two-hour sunny ride shows sun; a stale start row alone is nothing.
  try queue.write { db in
    try db.execute(sql: "DELETE FROM weather_observations")
    _ = try storeWeatherObservation(db, obs(0, temp: 8, code: 0, gust: 15), force: true)
    _ = try storeWeatherObservation(db, obs(hour, temp: 20, code: 61, gust: 40), force: true)
    _ = try storeWeatherObservation(db, obs(hour + 5 * 60_000, temp: 19, code: 0, gust: 10), force: true)
  }
  try queue.read { db in
    let weather = try rideWeather(db, startMs: 30 * 60_000, endMs: 2 * hour + 30 * 60_000)
    try require(weather == RideWeather(icon: "sun", minTemperatureC: 8, maxTemperatureC: 20, maxGustKmh: 40, rainMinutes: 5), "time-weighted ride weather")
    try require(try rideWeather(db, startMs: 3 * day, endMs: 3 * day + hour) == nil, "stale start row only")
  }
  let night = [obs(0, code: 1, isDay: false), obs(hour, code: 2, isDay: false), obs(2 * hour, code: 0)]
  try require(summarizeRideWeather(night, startMs: 0, endMs: 2 * hour + 10 * 60_000)?.icon == "cloud-moon", "night dominant icon")
  let stale = summarizeRideWeather([obs(0, temp: 2), obs(2 * day, temp: 9)], startMs: day + hour, endMs: 2 * day + hour)
  try require(stale?.minTemperatureC == 9 && stale?.maxTemperatureC == 9, "stale start row ignored")
  try require(summarizeRideWeather([obs(0)], startMs: hour, endMs: hour)?.minTemperatureC == 14, "zero-length range")
  try queue.close()
}
