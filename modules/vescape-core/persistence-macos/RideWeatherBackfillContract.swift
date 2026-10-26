import Foundation
import GRDB

/// Open-Meteo stand-in: hourly samples for the requested UTC days, temperature from the latitude.
private final class FakeOpenMeteo: MaintenanceHttp {
  var urls: [String] = []
  var respond: (String) throws -> MaintenanceHttpResponse?

  init(_ respond: @escaping (String) throws -> MaintenanceHttpResponse? = { _ in nil }) { self.respond = respond }

  func get(_ url: String, isCancelled: @escaping () -> Bool) throws -> MaintenanceHttpResponse {
    urls.append(url)
    return try respond(url) ?? Self.ok(url)
  }

  static func query(_ url: String, _ key: String) -> String {
    String(url.components(separatedBy: "\(key)=")[1].split(separator: "&", omittingEmptySubsequences: false)[0])
  }

  static func epochDay(_ date: String) -> Int64 {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd"
    return Int64(formatter.date(from: date)!.timeIntervalSince1970) / 86_400
  }

  static func ok(_ url: String) -> MaintenanceHttpResponse {
    let from = epochDay(query(url, "start_date")) * 86_400
    let to = epochDay(query(url, "end_date")) * 86_400 + 86_400
    let times = Array(stride(from: from, to: to, by: 3_600))
    let temperature = query(url, "latitude")
    let body = """
      {"hourly":{"time":[\(times.map(String.init).joined(separator: ","))],
      "temperature_2m":[\(times.map { _ in temperature }.joined(separator: ","))],
      "weather_code":[\(times.map { String(($0 / 3_600) % 2 * 3) }.joined(separator: ","))],
      "wind_gusts_10m":[\(times.map { _ in "null" }.joined(separator: ","))],
      "is_day":[\(times.map { _ in "1" }.joined(separator: ","))]}}
      """
    return MaintenanceHttpResponse(status: 200, body: Data(body.utf8), retryAfterSeconds: nil)
  }
}

/// Ride weather backfill Maintenance Job (#606) through the production GRDB statements and fence.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/RideWeatherBackfillHostTest.kt
func runRideWeatherBackfillContract() throws {
  let minute: Int64 = 60_000
  let hour = 60 * minute
  let day = 24 * hour
  let board = "board-a"
  /// 2024-03-10T00:00Z: a US DST change day, inside the historical forecast range.
  let base: Int64 = 1_710_028_800_000
  let now = base + 365 * day
  let job = RideWeatherJob.shared

  func freshQueue() throws -> DatabaseQueue {
    let queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    return queue
  }
  func frame(_ at: Int64) -> RecordingPersistenceSQL.Frame {
    .init(capturedAtMs: at, elapsedRealtimeMs: at, boardId: board, canId: nil, flags: 1,
          changedMask1: Int.max, changedMask2: 0, speedCentiKmh: 2_000, batteryVoltageMv: 80_000,
          motorCurrentMa: 1_000, batteryCurrentMa: 500, dutyPermille: 100, pitchCentiDeg: 0,
          rollCentiDeg: 0, balancePitchCentiDeg: 0, balanceCurrentMa: 0, erpm: 1_000, state: 1,
          switchState: 1, adc1Milli: 0, adc2Milli: 0, odometerCm: at, tempMosfetDeciC: 300,
          tempMotorDeciC: 300)
  }
  /// A ride of `length` with frames every 10 s and, unless `gps` is false, precise fixes at `lat`.
  func ride(_ queue: DatabaseQueue, _ start: Int64, _ length: Int64, lat: Double = 52.0, gps: Bool = true) throws {
    try queue.write { db in
      for at in stride(from: start, to: start + length, by: 10_000) {
        try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame(at)))
      }
      if gps {
        for at in stride(from: start, to: start + length, by: 60_000) {
          try insertRideTrackPoint(db, RideTrackPoint(boardId: board, fixAtMs: at, latitudeE7: Int64(lat * 1e7), longitudeE7: 210_000_000,
                                                      accuracyCm: 500, gpsSpeedCentiMps: 500, bearingCentiDeg: nil, altitudeCm: nil))
        }
      }
    }
  }
  func summarize(_ queue: DatabaseQueue) throws {
    try require(try rebuildRideSummaries(queue) == .completed, "summaries rebuilt")
  }
  func scope(_ queue: DatabaseQueue, _ http: MaintenanceHttp, fence: DatabaseReplacementFence = DatabaseReplacementFence()) -> MaintenanceJobScope {
    MaintenanceJobScope(writer: { queue }, fence: fence, ticket: fence.ticket(), nowMs: { now }, http: http)
  }
  func watermark(_ queue: DatabaseQueue) throws -> Int64? {
    parseWeatherBackfillWatermark(try queue.read { try storedMaintenanceFingerprint($0, id: job.id) }, version: job.version)
  }
  func weather(_ queue: DatabaseQueue, _ start: Int64, _ end: Int64) throws -> RideWeather? {
    try queue.read { try rideWeather($0, startMs: start, endMs: end) }
  }
  func observations(_ queue: DatabaseQueue, _ start: Int64, _ end: Int64) throws -> [WeatherObservation] {
    try queue.read { try weatherObservationsSpanning($0, startMs: start, endMs: end) }
  }
  func run(_ queue: DatabaseQueue, _ http: MaintenanceHttp) throws -> MaintenanceJobOutcome {
    try job.run(scope(queue, http), settings: [:])
  }

  // Fills missing days, then settles without another scan. Midnight-crossing ride; no-GPS ride.
  do {
    let queue = try freshQueue()
    try ride(queue, base + day - 30 * minute, hour)
    try ride(queue, base + 3 * day + 10 * hour, 20 * minute, gps: false)
    try summarize(queue)
    let http = FakeOpenMeteo()
    try require(try job.hasWork(scope(queue, http), settings: [:]), "past ride day is stale")
    try require(try run(queue, http) == .completed, "fill completes")
    try require(http.urls.count == 1, "one request \(http.urls)")
    try require(http.urls[0].contains("start_date=2024-03-10&end_date=2024-03-11"), "midnight ride touches both days")
    try require(http.urls[0].hasPrefix("https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=52.0000"), "forecast endpoint")
    try require(try weather(queue, base + day - 30 * minute, base + day - minute) != nil, "first day has weather")
    try require(try weather(queue, base + day, base + day + 29 * minute) != nil, "second day has weather")
    try require(try observations(queue, Int64.min, Int64.max).map(\.observedAtMs) == [base + day - hour], "first day's anchor covers the second")
    let mark = try watermark(queue)
    try require(mark.map { $0 - $0 % 10_000 } == base + 3 * day + 10 * hour + 20 * minute - 10_000, "watermark past the no-GPS ride")
    try require(!(try job.hasWork(scope(queue, http), settings: [:])), "second launch: no work")
    try require(http.urls.count == 1, "second launch: no request")
  }

  // Usable earlier weather is enough, and live rows committed during the request win.
  do {
    let queue = try freshQueue()
    try queue.write { _ = try storeWeatherObservation($0, WeatherObservation(observedAtMs: base + 8 * hour, temperatureC: 5, weatherCode: 0, gustKmh: nil, isDay: true), force: false) }
    try ride(queue, base + 19 * hour, 30 * minute)
    try ride(queue, base + 5 * day + 12 * hour, 30 * minute)
    try summarize(queue)
    let live = WeatherObservation(observedAtMs: base + 5 * day + 12 * hour, temperatureC: 9, weatherCode: 61, gustKmh: 20, isDay: true)
    let http = FakeOpenMeteo { _ in
      try queue.write { _ = try storeWeatherObservation($0, live, force: false) }
      return nil
    }
    try require(try run(queue, http) == .completed, "live-race run completes")
    try require(http.urls.count == 1 && http.urls[0].contains("start_date=2024-03-15"), "only the uncovered day is fetched")
    try require(try observations(queue, base + 5 * day, base + 6 * day).filter { $0.observedAtMs >= base + 5 * day } == [live], "live row wins")
  }

  // Temporary misses hold the watermark; permanent misses settle. Area A never fills B's days.
  do {
    let queue = try freshQueue()
    try ride(queue, base, 30 * minute, lat: 52.0)
    try ride(queue, base + 2 * day, 30 * minute, lat: 40.0)
    try ride(queue, base + 30 * day, 30 * minute, lat: 52.0)
    try summarize(queue)
    var failB = true
    let http = FakeOpenMeteo { url in
      if failB && url.contains("latitude=40.0000") { return MaintenanceHttpResponse(status: 503, body: nil, retryAfterSeconds: nil) }
      if url.contains("start_date=2024-04-09") { return MaintenanceHttpResponse(status: 400, body: Data("{\"error\":true}".utf8), retryAfterSeconds: nil) }
      return nil
    }
    guard case .deferred = try run(queue, http) else { throw Failure(description: "temporary miss defers") }
    try require(http.urls.count == 3, "all windows tried")
    try require(try watermark(queue) == base + 30 * minute - 10_000, "watermark stops before B")
    try require(try weather(queue, base, base + 29 * minute) != nil, "A filled")
    try require(try weather(queue, base + 30 * day, base + 30 * day + 29 * minute) == nil, "permanent miss stays empty")
    try require(try observations(queue, base + 2 * day, base + 3 * day).allSatisfy { $0.observedAtMs < base + 2 * day }, "A never fills B's day")
    failB = false
    http.urls = []
    try require(try run(queue, http) == .completed, "retry completes")
    try require(http.urls.count == 2, "retry refetches from the watermark")
    try require(try weather(queue, base + 2 * day, base + 2 * day + 29 * minute)?.maxTemperatureC == 40, "B filled from B")
    try require(try watermark(queue) == base + 30 * day + 30 * minute - 10_000, "permanent miss settled")
    http.urls = []
    try require(!(try job.hasWork(scope(queue, http), settings: [:])) && http.urls.isEmpty, "permanent miss not refetched")
  }

  // 429 stops the run and honors Retry-After; transport failures are temporary.
  do {
    let queue = try freshQueue()
    try ride(queue, base, 30 * minute, lat: 52.0)
    try ride(queue, base + 2 * day, 30 * minute, lat: 40.0)
    try summarize(queue)
    let limited = FakeOpenMeteo { _ in MaintenanceHttpResponse(status: 429, body: nil, retryAfterSeconds: 600) }
    try require(try run(queue, limited) == .deferred(retryAtMs: now + 600_000), "retry-after honored")
    try require(limited.urls.count == 1, "429 stops the run")
    try require(try watermark(queue) == nil, "no watermark after 429")
    let offline = FakeOpenMeteo { _ in throw URLError(.notConnectedToInternet) }
    guard case .deferred(let retryAt) = try run(queue, offline), retryAt > now else { throw Failure(description: "offline defers") }
    try require(try run(queue, FakeOpenMeteo()) == .completed, "online completes")
  }

  // Multi-year history uses bounded windows and the archive before the forecast range.
  do {
    let queue = try freshQueue()
    let first = WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS
    try ride(queue, first - 7 * day + 12 * hour, 20 * minute)
    for i in 0..<12 { try ride(queue, first + Int64(i) * 5 * day + 12 * hour, 20 * minute) }
    try summarize(queue)
    let http = FakeOpenMeteo()
    try require(try run(queue, http) == .completed, "multi-year completes")
    try require(http.urls[0].hasPrefix("https://archive-api.open-meteo.com/v1/archive"), "archive endpoint")
    let spans = http.urls.dropFirst().map {
      (FakeOpenMeteo.epochDay(FakeOpenMeteo.query($0, "start_date")), FakeOpenMeteo.epochDay(FakeOpenMeteo.query($0, "end_date")))
    }
    try require(spans.allSatisfy { $0.1 - $0.0 < WEATHER_BACKFILL_WINDOW_DAYS }, "bounded windows")
    try require(spans.count == 4, "window count \(spans.count)")
  }

  // Null and duplicate samples are dropped; timestamps are UTC epoch seconds.
  do {
    let samples = parseWeatherBackfillHourly(Data("""
      {"hourly":{"time":[1710054000,1710054000,1710057600,1710061200],
      "temperature_2m":[1.4,9.0,null,2.6],"weather_code":[3,3,3,61],
      "wind_gusts_10m":[12.4,null,null,null],"is_day":[1,1,1,0]}}
      """.utf8))
    try require(samples == [
      WeatherObservation(observedAtMs: 1_710_054_000_000, temperatureC: 1, weatherCode: 3, gustKmh: 10, isDay: true),
      WeatherObservation(observedAtMs: 1_710_061_200_000, temperatureC: 3, weatherCode: 61, gustKmh: nil, isDay: false),
    ], "parsed samples \(String(describing: samples))")
    try require(parseWeatherBackfillHourly(Data("<html>".utf8)) == nil, "html rejected")
    try require(classifyWeatherBackfillResponse(MaintenanceHttpResponse(status: 200, body: Data("<html>".utf8), retryAfterSeconds: nil)) == .failed(.temporary), "bad 200 temporary")
    try require(classifyWeatherBackfillResponse(MaintenanceHttpResponse(status: 400, body: nil, retryAfterSeconds: nil)) == .failed(.permanent), "400 permanent")
    try require(parseWeatherBackfillWatermark("2|5", version: job.version) == nil, "other version ignored")
    try require(parseWeatherBackfillWatermark(weatherBackfillWatermarkValue(version: job.version, doneThroughMs: 5), version: job.version) == 5, "watermark round trip")
  }

  // A fence during the fetch prevents late writes.
  do {
    let queue = try freshQueue()
    try ride(queue, base, 30 * minute)
    try summarize(queue)
    let fence = DatabaseReplacementFence()
    let http = FakeOpenMeteo { _ in fence.fence {}; return nil }
    var fenced = false
    do { _ = try job.run(scope(queue, http, fence: fence), settings: [:]) } catch is MaintenanceRunFenced { fenced = true }
    try require(fenced, "fence stops the run")
    try require(try observations(queue, Int64.min, Int64.max).isEmpty, "no late weather rows")
    try require(try watermark(queue) == nil, "no late watermark")
  }

  // The active ride is never read and defers to its closure.
  do {
    let queue = try freshQueue()
    try ride(queue, now - 20 * minute, 15 * minute)
    try summarize(queue)
    let http = FakeOpenMeteo()
    guard case .deferred = try run(queue, http) else { throw Failure(description: "active ride defers") }
    try require(http.urls.isEmpty, "active ride not fetched")
    try require(try watermark(queue) == nil, "no watermark into the active ride")
  }
}
