import Foundation
import GRDB

let WEATHER_BACKFILL_DAY_MS: Int64 = 86_400_000

let WEATHER_BACKFILL_WINDOW_DAYS: Int64 = 14

let WEATHER_BACKFILL_AREA_STEPS_PER_DEG = 10.0

let WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS: Int64 = 1_640_995_200_000

let WEATHER_ARCHIVE_FIRST_DAY_MS: Int64 = -946_771_200_000

let WEATHER_BACKFILL_RECENT_MS: Int64 = 7 * WEATHER_BACKFILL_DAY_MS

let WEATHER_BACKFILL_MAX_TEMPORARY_MISSES = 3
let WEATHER_BACKFILL_BACKOFF_BASE_MS: Int64 = 60_000
let WEATHER_BACKFILL_BACKOFF_MAX_MS: Int64 = 3_600_000

let WEATHER_BACKFILL_BUCKET_PAGE = 2_000

let WEATHER_BACKFILL_LOOKBACK_MS: Int64 = WEATHER_BACKFILL_DAY_MS

struct WeatherBackfillCursor: Equatable {
  let bucketFromMs: Int64
  let ridesAfterMs: Int64
}

struct WeatherBackfillRide: Equatable {
  let startMs: Int64
  let endMs: Int64
}

struct WeatherBackfillSegment: Equatable {
  let ride: Int
  let dayMs: Int64
  let startMs: Int64
  let endMs: Int64
  let latitude: Double
  let longitude: Double
}

struct WeatherBackfillPage {
  let rides: [WeatherBackfillRide]
  let segments: [WeatherBackfillSegment]
  let next: WeatherBackfillCursor?
  let activeRetryAtMs: Int64?
}

struct WeatherBackfillWindow: Equatable {
  let latitude: Double
  let longitude: Double
  let firstDayMs: Int64
  let lastDayMs: Int64
  let days: Set<Int64>
  let archive: Bool
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `WeatherBackfillMiss`
enum WeatherBackfillMiss { case permanent, temporary }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `WeatherBackfillFetch`
enum WeatherBackfillFetch: Equatable {
  case samples([WeatherObservation])
  case failed(WeatherBackfillMiss, retryAfterMs: Int64? = nil, stopRun: Bool = false)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `weatherBackfillWatermarkValue`
func weatherBackfillWatermarkValue(version: Int, doneThroughMs: Int64) -> String { "\(version)|\(doneThroughMs)" }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `parseWeatherBackfillWatermark`
func parseWeatherBackfillWatermark(_ value: String?, version: Int) -> Int64? {
  guard let parts = value?.split(separator: "|", omittingEmptySubsequences: false),
        parts.count == 2, Int(parts[0]) == version
  else { return nil }
  return Int64(parts[1])
}

private func floorDay(_ ms: Int64) -> Int64 {
  let q = ms / WEATHER_BACKFILL_DAY_MS
  return (ms % WEATHER_BACKFILL_DAY_MS != 0 && ms < 0 ? q - 1 : q) * WEATHER_BACKFILL_DAY_MS
}

private func saturatingMinus(_ value: Int64, _ delta: Int64) -> Int64 {
  let (result, overflow) = value.subtractingReportingOverflow(delta)
  return overflow ? Int64.min : result
}

private func roundHalfUp(_ value: Double) -> Int64 { Int64((value + 0.5).rounded(.down)) }

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `planWeatherBackfillWindows`
func planWeatherBackfillWindows(_ segments: [WeatherBackfillSegment]) -> [WeatherBackfillWindow] {
  var representative: [Int64: WeatherBackfillSegment] = [:]
  let ordered = segments.enumerated().sorted {
    ($0.element.startMs, $0.element.ride, $0.offset) < ($1.element.startMs, $1.element.ride, $1.offset)
  }.map(\.element)
  for segment in ordered where segment.dayMs >= WEATHER_ARCHIVE_FIRST_DAY_MS && representative[segment.dayMs] == nil {
    representative[segment.dayMs] = segment
  }
  func cell(_ value: Double) -> Int64 { roundHalfUp(value * WEATHER_BACKFILL_AREA_STEPS_PER_DEG) }
  var areaOrder: [[Int64]] = []
  var areas: [[Int64]: [WeatherBackfillSegment]] = [:]
  for day in representative.keys.sorted() {
    let segment = representative[day]!
    let key = [cell(segment.latitude), cell(segment.longitude)]
    if areas[key] == nil { areaOrder.append(key) }
    areas[key, default: []].append(segment)
  }
  var windows: [WeatherBackfillWindow] = []
  for key in areaOrder {
    var open: [WeatherBackfillSegment] = []
    func close() {
      guard let first = open.first, let last = open.last else { return }
      windows.append(WeatherBackfillWindow(
        latitude: first.latitude,
        longitude: first.longitude,
        firstDayMs: first.dayMs,
        lastDayMs: last.dayMs,
        days: Set(open.map(\.dayMs)),
        archive: first.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS
      ))
      open = []
    }
    for day in areas[key]! {
      if let first = open.first,
         day.dayMs - first.dayMs >= WEATHER_BACKFILL_WINDOW_DAYS * WEATHER_BACKFILL_DAY_MS
          || (first.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS) != (day.dayMs < WEATHER_HISTORICAL_FORECAST_FIRST_DAY_MS) {
        close()
      }
      open.append(day)
    }
    close()
  }
  return windows.enumerated().sorted {
    ($0.element.firstDayMs, $0.element.latitude, $0.element.longitude, $0.offset)
      < ($1.element.firstDayMs, $1.element.latitude, $1.element.longitude, $1.offset)
  }.map(\.element)
}

private func utcDate(_ dayMs: Int64) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "UTC")!
  let parts = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: TimeInterval(dayMs / 1_000)))
  return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `weatherBackfillUrl`
func weatherBackfillUrl(_ window: WeatherBackfillWindow) -> String {
  let base = window.archive
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://historical-forecast-api.open-meteo.com/v1/forecast"
  return base
    + String(format: "?latitude=%.4f&longitude=%.4f", locale: Locale(identifier: "en_US_POSIX"), window.latitude, window.longitude)
    + "&start_date=\(utcDate(window.firstDayMs))&end_date=\(utcDate(window.lastDayMs))"
    + "&hourly=temperature_2m,weather_code,wind_gusts_10m,is_day"
    + "&timezone=GMT&timeformat=unixtime"
}

private func number(_ array: [Any]?, _ index: Int) -> Double? {
  guard let array, index < array.count, let value = array[index] as? NSNumber,
        CFGetTypeID(value) != CFBooleanGetTypeID()
  else { return nil }
  let double = value.doubleValue
  return double.isFinite ? double : nil
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `parseWeatherBackfillHourly`
func parseWeatherBackfillHourly(_ body: Data) -> [WeatherObservation]? {
  // intentional-suppression: an unparseable body is classified as a temporary miss by the caller.
  guard let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
        let hourly = json["hourly"] as? [String: Any],
        let times = hourly["time"] as? [Any]
  else { return nil }
  let temperatures = hourly["temperature_2m"] as? [Any]
  let codes = hourly["weather_code"] as? [Any]
  let gusts = hourly["wind_gusts_10m"] as? [Any]
  let isDay = hourly["is_day"] as? [Any]
  var byTime: [Int64: WeatherObservation] = [:]
  for index in times.indices {
    guard let seconds = number(times, index),
          let temperature = number(temperatures, index),
          let code = number(codes, index),
          let day = number(isDay, index)
    else { continue }
    let at = Int64(seconds) * 1_000
    if byTime[at] != nil { continue }
    byTime[at] = WeatherObservation.normalized(
      observedAtMs: at, temperatureC: temperature, weatherCode: Int(code), gustKmh: number(gusts, index), isDay: day != 0
    )
  }
  return byTime.keys.sorted().map { byTime[$0]! }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `classifyWeatherBackfillResponse`
func classifyWeatherBackfillResponse(_ response: MaintenanceHttpResponse) -> WeatherBackfillFetch {
  switch response.status {
  case 429:
    return .failed(.temporary, retryAfterMs: response.retryAfterSeconds.map { max($0, 0) * 1_000 }, stopRun: true)
  case 408, 500...:
    return .failed(.temporary)
  case 400..<500:
    return .failed(.permanent)
  case 200..<300:
    guard let samples = response.body.flatMap(parseWeatherBackfillHourly) else { return .failed(.temporary) }
    return .samples(samples)
  default:
    return .failed(.temporary)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `weatherBackfillRows`
func weatherBackfillRows(_ samples: [WeatherObservation], startMs: Int64, endMs: Int64) -> [WeatherObservation] {
  let anchor = samples.last { $0.observedAtMs <= startMs }
    .flatMap { startMs - $0.observedAtMs <= weatherObservationFreshnessMs ? $0 : nil }
  var rows: [WeatherObservation] = []
  for sample in (anchor.map { [$0] } ?? []) + samples.filter({ $0.observedAtMs > startMs && $0.observedAtMs <= endMs })
  where shouldStoreWeatherObservation(previous: rows.last, next: sample, force: false) {
    rows.append(sample)
  }
  return rows
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `weatherBackfillPageImpl`
func weatherBackfillPage(_ db: Database, cursor: WeatherBackfillCursor, nowMs: Int64, gapMs: Int64) throws -> WeatherBackfillPage {
  let active = try activeRideStartMs(db, nowMs: nowMs, gapMs: gapMs)
  let activeRetryAtMs = try active.flatMap { _ in try lastSampleAtOrBefore(db, nowMs: nowMs).map { $0 + gapMs } }
  let beforeMs = active.map { $0 - (($0 % TELEMETRY_BUCKET_SIZE_MS) + TELEMETRY_BUCKET_SIZE_MS) % TELEMETRY_BUCKET_SIZE_MS } ?? Int64.max
  let buckets = try Row.fetchAll(
    db,
    sql: """
      SELECT * FROM telemetry_minute_buckets
      WHERE bucket_start_ms >= ? AND bucket_start_ms < ?
      ORDER BY bucket_start_ms, board_id LIMIT ?
      """,
    arguments: [cursor.bucketFromMs, beforeMs, WEATHER_BACKFILL_BUCKET_PAGE]
  )
  if buckets.isEmpty { return WeatherBackfillPage(rides: [], segments: [], next: nil, activeRetryAtMs: activeRetryAtMs) }
  let markers = try Row.fetchAll(
    db,
    sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? ORDER BY occurred_at_ms ASC",
    arguments: [
      buckets.map { $0["first_sample_at_ms"] as Int64 }.min()! - gapMs,
      buckets.map { $0["last_sample_at_ms"] as Int64 }.max()! + TELEMETRY_BUCKET_SIZE_MS,
    ]
  )
  let grouped = try groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
  let hasMore = buckets.count == WEATHER_BACKFILL_BUCKET_PAGE
  let kept: [RideSessionAggregate]
  let next: WeatherBackfillCursor?
  if !hasMore {
    kept = grouped
    next = nil
  } else if grouped.count > 1 {
    kept = Array(grouped.dropLast())
    next = WeatherBackfillCursor(bucketFromMs: grouped.last!.firstBucketStartMs, ridesAfterMs: cursor.ridesAfterMs)
  } else {
    kept = grouped
    next = WeatherBackfillCursor(
      bucketFromMs: (buckets.last!["bucket_start_ms"] as Int64) + TELEMETRY_BUCKET_SIZE_MS,
      ridesAfterMs: max(cursor.ridesAfterMs, grouped.first?.endAtMs ?? cursor.ridesAfterMs)
    )
  }
  let rides = kept.filter { $0.endAtMs > cursor.ridesAfterMs }
    .enumerated().sorted { ($0.element.endAtMs, $0.offset) < ($1.element.endAtMs, $1.offset) }.map(\.element)
  var segments: [WeatherBackfillSegment] = []
  for (index, ride) in rides.enumerated() where ride.avgSpeedSampleCount > 0 {
    var day = floorDay(ride.startAtMs)
    while day <= ride.endAtMs {
      let start = max(ride.startAtMs, day)
      let end = min(ride.endAtMs, day + WEATHER_BACKFILL_DAY_MS - 1)
      if try rideWeather(db, startMs: start, endMs: end) == nil,
         let fix = try Row.fetchOne(
           db,
           sql: """
             SELECT latitude_e7, longitude_e7 FROM ride_track_points
             WHERE fix_at_ms >= ? AND fix_at_ms <= ? AND accuracy_cm IS NOT NULL AND accuracy_cm <= ?
             ORDER BY fix_at_ms, id LIMIT 1
             """,
           arguments: [start, end, rideTrackPreciseAccuracyCm]
         ) {
        segments.append(WeatherBackfillSegment(
          ride: index, dayMs: day, startMs: start, endMs: end,
          latitude: Double(fix["latitude_e7"] as Int64) / 1e7, longitude: Double(fix["longitude_e7"] as Int64) / 1e7
        ))
      }
      day += WEATHER_BACKFILL_DAY_MS
    }
  }
  return WeatherBackfillPage(
    rides: rides.map { WeatherBackfillRide(startMs: $0.startAtMs, endMs: $0.endAtMs) },
    segments: segments,
    next: next,
    activeRetryAtMs: activeRetryAtMs
  )
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `storeWeatherBackfillImpl`
func storeWeatherBackfill(_ db: Database, segments: [WeatherBackfillSegment], samples: [WeatherObservation]) throws -> [Bool] {
  try segments.map { segment in
    if try rideWeather(db, startMs: segment.startMs, endMs: segment.endMs) != nil { return true }
    for row in weatherBackfillRows(samples, startMs: segment.startMs, endMs: segment.endMs) {
      try db.execute(
        sql: "INSERT OR IGNORE INTO weather_observations (observed_at_ms, temperature_c, weather_code, gust_kmh, is_day) VALUES (?, ?, ?, ?, ?)",
        arguments: [row.observedAtMs, row.temperatureC, row.weatherCode, row.gustKmh, row.isDay]
      )
    }
    return try rideWeather(db, startMs: segment.startMs, endMs: segment.endMs) != nil
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideWeatherBackfill.kt `RideWeatherJob`
final class RideWeatherJob: MaintenanceJob {
  static let shared = RideWeatherJob()

  let id = "rideWeather"
  let version = 1
  let requiresNetwork = true
  let inputKeys: Set<String> = []

  private var failedRuns = 0

  private var rateLimitedUntilMs = Int64.min

  func inputs(_ settings: [String: Any?]) -> String { "" }

  func hasWork(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> Bool {
    try pass(scope, settings: settings, fetch: false) != .completed
  }

  func begin(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {}

  func complete(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {}

  func run(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> MaintenanceJobOutcome {
    if scope.nowMs() < rateLimitedUntilMs { return .deferred(retryAtMs: rateLimitedUntilMs) }
    return try pass(scope, settings: settings, fetch: true)
  }

  private func pass(_ scope: MaintenanceJobScope, settings: [String: Any?], fetch: Bool) throws -> MaintenanceJobOutcome {
    let gapMs = Int64(telemetryInt(settings["rideSplitGapMinutes"] ?? nil) ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
    let stored = try scope.chunk { try storedMaintenanceFingerprint($0, id: id) }
    let start = parseWeatherBackfillWatermark(stored, version: version) ?? Int64.min
    var watermark = start
    var cursor: WeatherBackfillCursor? = WeatherBackfillCursor(
      bucketFromMs: saturatingMinus(start, WEATHER_BACKFILL_LOOKBACK_MS), ridesAfterMs: start
    )
    var blocked = false
    var temporaryMisses = 0
    var retryAfterMs: Int64?
    var stopped = false
    var rateLimited = false
    var activeRetryAtMs: Int64?
    var done = 0
    var total = 0
    while let current = cursor {
      let nowMs = scope.nowMs()
      let page = try scope.chunk { try weatherBackfillPage($0, cursor: current, nowMs: nowMs, gapMs: gapMs) }
      activeRetryAtMs = page.activeRetryAtMs
      if !fetch && !page.segments.isEmpty {
        let firstPending = page.segments.map(\.ride).min()!
        watermark = settle(page.rides.prefix(firstPending), watermark)
        if watermark != start { try publish(scope, watermark) }
        return .deferred(retryAtMs: scope.nowMs())
      }
      var resolved = page.segments.map { $0.dayMs < WEATHER_ARCHIVE_FIRST_DAY_MS }
      total += page.segments.count
      scope.progress(done, total)
      for window in planWeatherBackfillWindows(page.segments) {
        let members = page.segments.indices.filter { window.days.contains(page.segments[$0].dayMs) }
        if stopped { continue }
        let fetched: WeatherBackfillFetch
        do {
          fetched = classifyWeatherBackfillResponse(try scope.http.get(weatherBackfillUrl(window), isCancelled: scope.isCancelled))
        } catch is MaintenanceRunCancelled {
          throw MaintenanceRunCancelled()
        } catch {
          fetched = .failed(.temporary)
        }
        switch fetched {
        case .samples(let samples):
          let segments = members.map { page.segments[$0] }
          let filled = try scope.chunk { try storeWeatherBackfill($0, segments: segments, samples: samples) }
          scope.committed()
          for (i, index) in members.enumerated() {
            resolved[index] = filled[i] || scope.nowMs() - page.segments[index].endMs >= WEATHER_BACKFILL_RECENT_MS
            if !resolved[index] { temporaryMisses += 1 }
          }
        case .failed(let miss, let retryAfter, let stopRun):
          if miss == .permanent {
            for index in members { resolved[index] = true }
          } else {
            temporaryMisses += 1
            if let retryAfter { retryAfterMs = max(retryAfterMs ?? 0, retryAfter) }
            if stopRun { stopped = true; rateLimited = true }
          }
        }
        if temporaryMisses >= WEATHER_BACKFILL_MAX_TEMPORARY_MISSES { stopped = true }
        done += members.count
        scope.progress(done, total)
      }
      if !blocked {
        let firstUnresolved = page.segments.indices.filter { !resolved[$0] }.map { page.segments[$0].ride }.min()
        let settled = settle(page.rides.prefix(firstUnresolved ?? page.rides.count), watermark)
        if settled != watermark {
          watermark = settled
          try publish(scope, watermark)
        }
        blocked = firstUnresolved != nil
      }
      if blocked && stopped { break }
      cursor = page.next
    }
    if !fetch { return activeRetryAtMs.map { .deferred(retryAtMs: $0) } ?? .completed }
    if !blocked { failedRuns = 0; rateLimitedUntilMs = Int64.min }
    if blocked {
      failedRuns += 1
      let backoff = min(WEATHER_BACKFILL_BACKOFF_BASE_MS << Int64(min(failedRuns - 1, 20)), WEATHER_BACKFILL_BACKOFF_MAX_MS)
      let retryAtMs = scope.nowMs() + max(backoff, retryAfterMs ?? 0)
      if rateLimited { rateLimitedUntilMs = retryAtMs }
      return .deferred(retryAtMs: retryAtMs)
    }
    if let activeRetryAtMs { return .deferred(retryAtMs: activeRetryAtMs) }
    return .completed
  }

  private func settle(_ rides: ArraySlice<WeatherBackfillRide>, _ watermark: Int64) -> Int64 {
    rides.reduce(watermark) { max($0, $1.endMs) }
  }

  private func publish(_ scope: MaintenanceJobScope, _ doneThroughMs: Int64) throws {
    let nowMs = scope.nowMs()
    try scope.chunk {
      try publishMaintenanceFingerprint($0, id: id, fingerprint: weatherBackfillWatermarkValue(version: version, doneThroughMs: doneThroughMs), nowMs: nowMs)
    }
  }
}
