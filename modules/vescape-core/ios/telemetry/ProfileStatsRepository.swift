import Foundation
import GRDB

/// Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
/// @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
internal let DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30
internal let DEFAULT_RIDE_SPLIT_GAP_MS = Int64(DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
internal let PROFILE_BREAK_BOUNDARIES: Set<String> = ["disconnected", "app_stop", "error"]

internal struct ProfileStatsMonth: Equatable, Hashable {
  let year: Int
  let month: Int
}

internal struct ProfileSessionAggregate {
  let deviceId: String
  var startAtMs: Int64
  var endAtMs: Int64
  var sampleCount: Int
  var avgSpeedSampleCount: Int
  var avgSpeedWeightedSum: Double
  var movingStartAtMs: Int64?
  var movingEndAtMs: Int64?
  var distanceM: Double?
  var topSpeedKmh: Double
  var batteryUsedWh: Double
  var batteryRegenWh: Double
}

/// Profile stats queries over precomputed Ride History buckets.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt
internal final class ProfileStatsRepository {
  static let shared = ProfileStatsRepository()
  private var pool: DatabasePool? { TelemetryDatabase.pool }

  private init() {}

  func getTotalProfileStats() -> [String: Any?] {
    let gapMs = rideSplitGapMs()
    let buckets = allBuckets()
    return computeProfileStatsForBuckets(
      buckets: buckets,
      markers: markersForBuckets(buckets, gapMs: gapMs),
      month: nil,
      gapMs: gapMs
    )
  }

  /// Rider-set ride split gap, so profile stats count the same rides the history list shows.
  private func rideSplitGapMs() -> Int64 {
    let minutes = telemetryInt(AppDataRepository.shared.getSettings()["rideSplitGapMinutes"] ?? nil)
    return Int64(minutes ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
  }

  func getMonthlyProfileStats(_ options: [String: Any]) -> [String: Any?] {
    guard let year = telemetryInt(options["year"]), let month = telemetryInt(options["month"]), (1...12).contains(month) else {
      return emptyProfileStats()
    }
    let gapMs = rideSplitGapMs()
    let buckets = allBuckets()
    return computeProfileStatsForBuckets(
      buckets: buckets,
      markers: markersForBuckets(buckets, gapMs: gapMs),
      month: ProfileStatsMonth(year: year, month: month),
      gapMs: gapMs
    )
  }

  func getProfileStatMonths() -> [[String: Any?]] {
    let gapMs = rideSplitGapMs()
    let buckets = allBuckets()
    return computeProfileStatMonthsForBuckets(
      buckets: buckets,
      markers: markersForBuckets(buckets, gapMs: gapMs),
      gapMs: gapMs
    ).map { ["year": $0.year, "month": $0.month] }
  }

  private func allBuckets() -> [Row] {
    guard let pool else { return [] }
    return (try? pool.read { db in
      try Row.fetchAll(db, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms ASC")
    }) ?? []
  }

  private func markersForBuckets(_ buckets: [Row], gapMs: Int64) -> [Row] {
    guard let pool, !buckets.isEmpty else { return [] }
    let fromMs = (buckets.map { $0["first_sample_at_ms"] as Int64 }.min() ?? 0) - gapMs
    let toMs = (buckets.map { $0["last_sample_at_ms"] as Int64 }.max() ?? 0) + TELEMETRY_BUCKET_SIZE_MS
    return (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? ORDER BY occurred_at_ms ASC",
        arguments: [fromMs, toMs]
      )
    }) ?? []
  }
}

internal func computeProfileStatsForBuckets(
  buckets: [Row],
  markers: [Row],
  month: ProfileStatsMonth?,
  calendar: Calendar = .current,
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) -> [String: Any?] {
  let sessions = groupProfileSessions(buckets: buckets, markers: markers, gapMs: gapMs)
    .filter { $0.avgSpeedSampleCount > 0 }
  let included = month.map { target in
    sessions.filter { profileMonth($0.startAtMs, calendar: calendar) == target }
  } ?? sessions
  guard !included.isEmpty else { return emptyProfileStats() }

  let totalDurationMs = included.reduce(Int64(0)) { total, session in
    let span: Int64
    if let start = session.movingStartAtMs, let end = session.movingEndAtMs {
      span = end - start
    } else {
      span = session.endAtMs - session.startAtMs
    }
    return total + max(0, span)
  }
  let distances = included.compactMap(\.distanceM)
  let avgSpeedSamples = included.reduce(0) { $0 + $1.avgSpeedSampleCount }
  let avgSpeedKmh = avgSpeedSamples > 0
    ? included.reduce(0.0) { $0 + $1.avgSpeedWeightedSum } / Double(avgSpeedSamples)
    : 0.0

  return [
    "distanceM": distances.isEmpty ? nil : distances.reduce(0.0, +),
    "rideCount": included.count,
    "rideTimeMs": totalDurationMs,
    "topSpeedKmh": included.map(\.topSpeedKmh).max() ?? 0.0,
    "avgSpeedKmh": avgSpeedKmh,
    "longestRideM": distances.max(),
    "batteryUsedWh": included.reduce(0.0) { $0 + $1.batteryUsedWh },
    "batteryRegenWh": included.reduce(0.0) { $0 + $1.batteryRegenWh },
  ]
}

internal func computeProfileStatMonthsForBuckets(
  buckets: [Row],
  markers: [Row],
  calendar: Calendar = .current,
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) -> [ProfileStatsMonth] {
  Array(Set(groupProfileSessions(buckets: buckets, markers: markers, gapMs: gapMs)
    .filter { $0.avgSpeedSampleCount > 0 }
    .map { profileMonth($0.startAtMs, calendar: calendar) }))
    .sorted {
      $0.year == $1.year ? $0.month > $1.month : $0.year > $1.year
    }
}

/// Group Ride History buckets into rides, by the same rules the Ride History list applies in JS.
///
/// @parity /src/modules/history/lib/sessions.ts `groupHistorySessions`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `groupProfileSessions`
internal func groupProfileSessions(
  buckets: [Row],
  markers: [Row],
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) -> [ProfileSessionAggregate] {
  guard !buckets.isEmpty else { return [] }
  var sessions: [ProfileSessionAggregate] = []
  var current: ProfileSessionAggregate?
  var previous: Row?

  for bucket in buckets.sorted(by: { ($0["first_sample_at_ms"] as Int64) < ($1["first_sample_at_ms"] as Int64) }) {
    if (bucket["sample_count"] as Int) <= 0 { continue }
    let boundary = markerBoundaryForProfileBucket(bucket, markers: markers)
    let deviceId = bucket["device_id"] as String
    let breakByDevice = current == nil || current?.deviceId != deviceId
    let breakByGap = previous.map { (bucket["first_sample_at_ms"] as Int64) - ($0["last_sample_at_ms"] as Int64) > gapMs } ?? false
    let breakByBoundary = boundary.map { PROFILE_BREAK_BOUNDARIES.contains($0) } ?? false

    if breakByDevice || breakByGap || breakByBoundary {
      if let current { sessions.append(current) }
      current = ProfileSessionAggregate(
        deviceId: deviceId,
        startAtMs: bucket["first_sample_at_ms"] as Int64,
        endAtMs: bucket["last_sample_at_ms"] as Int64,
        sampleCount: 0,
        avgSpeedSampleCount: 0,
        avgSpeedWeightedSum: 0,
        movingStartAtMs: nil,
        movingEndAtMs: nil,
        distanceM: nil,
        topSpeedKmh: 0,
        batteryUsedWh: 0,
        batteryRegenWh: 0
      )
    }

    if var aggregate = current {
      mergeProfileBucket(bucket, into: &aggregate)
      current = aggregate
    }
    previous = bucket
  }

  if let current { sessions.append(current) }
  return sessions
}

internal func markerBoundaryForProfileBucket(_ bucket: Row, markers: [Row]) -> String? {
  markers.last { marker in
    let occurred = marker["occurred_at_ms"] as Int64
    let markerDevice = marker["device_id"] as String? ?? ""
    let bucketDevice = bucket["device_id"] as String
    return occurred >= (bucket["first_sample_at_ms"] as Int64) - 5_000 &&
      occurred <= (bucket["first_sample_at_ms"] as Int64) + 1_000 &&
      markerDevice == bucketDevice
  }.map { $0["type"] as String }
}

internal func mergeProfileBucket(_ bucket: Row, into session: inout ProfileSessionAggregate) {
  session.startAtMs = min(session.startAtMs, bucket["first_sample_at_ms"] as Int64)
  session.endAtMs = max(session.endAtMs, bucket["last_sample_at_ms"] as Int64)
  session.sampleCount += bucket["sample_count"] as Int

  if let movingCount = bucket["moving_speed_sample_count"] as Int? {
    session.avgSpeedSampleCount += movingCount
    session.avgSpeedWeightedSum += Double((bucket["sum_moving_abs_speed_centi_kmh"] as Int64?) ?? 0) / 100.0
  } else {
    session.avgSpeedSampleCount += bucket["sample_count"] as Int
    session.avgSpeedWeightedSum += Double(bucket["sum_abs_speed_centi_kmh"] as Int64) / 100.0
  }

  if let first = bucket["first_moving_at_ms"] as Int64? {
    session.movingStartAtMs = session.movingStartAtMs.map { min($0, first) } ?? first
  }
  if let last = bucket["last_moving_at_ms"] as Int64? {
    session.movingEndAtMs = session.movingEndAtMs.map { max($0, last) } ?? last
  }

  session.topSpeedKmh = max(session.topSpeedKmh, Double(bucket["max_abs_speed_centi_kmh"] as Int) / 100.0)
  session.batteryUsedWh += Double(bucket["battery_used_wh_milli"] as Int64) / 1000.0
  session.batteryRegenWh += Double(bucket["battery_regen_wh_milli"] as Int64) / 1000.0

  if let distance = profileDistanceDeltaM(bucket) {
    session.distanceM = (session.distanceM ?? 0) + distance
  }
}

internal func profileDistanceDeltaM(_ bucket: Row) -> Double? {
  guard let first = bucket["first_odometer_cm"] as Int64?, let last = bucket["last_odometer_cm"] as Int64? else {
    return nil
  }
  return Double(max(0, last - first)) / 100.0
}

internal func profileMonth(_ atMs: Int64, calendar: Calendar) -> ProfileStatsMonth {
  let date = Date(timeIntervalSince1970: Double(atMs) / 1000.0)
  let components = calendar.dateComponents([.year, .month], from: date)
  return ProfileStatsMonth(year: components.year ?? 1970, month: components.month ?? 1)
}

internal func emptyProfileStats() -> [String: Any?] {
  [
    "distanceM": nil,
    "rideCount": 0,
    "rideTimeMs": 0,
    "topSpeedKmh": 0,
    "avgSpeedKmh": 0,
    "longestRideM": nil,
    "batteryUsedWh": nil,
    "batteryRegenWh": nil,
  ]
}
