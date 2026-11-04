import Foundation
import GRDB

/// Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
/// @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
internal let DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30
internal let DEFAULT_RIDE_SPLIT_GAP_MS = Int64(DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000

internal struct ProfileStatsMonth: Equatable, Hashable {
  let year: Int
  let month: Int
}

/// Profile stats queries over precomputed Ride History buckets.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt
internal final class ProfileStatsRepository {
  static let shared = ProfileStatsRepository()
  private let poolProvider: () throws -> DatabasePool
  private let gapMsProvider: () throws -> Int64

  internal init(
    poolProvider: @escaping () throws -> DatabasePool = { try VescapeDatabase.requirePool() },
    gapMsProvider: @escaping () throws -> Int64 = {
      let minutes = telemetryInt(try AppDataRepository.shared.getSettings()["rideSplitGapMinutes"] ?? nil)
      return Int64(minutes ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
    }
  ) {
    self.poolProvider = poolProvider
    self.gapMsProvider = gapMsProvider
  }

  /// Lifetime, available months, and selected-month stats from one read/grouping pass.
  /// @parity /modules/vescape-core/src/index.ts `ProfileStatsSnapshot`
  func getProfileStatsSnapshot(_ options: [String: Any]) throws -> [String: Any?] {
    profileStatsSnapshot(sessions: try readSessions(), options: options)
  }

  /// Stats of the rides that started on one local calendar day.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `readProfileDayStats`
  /// @parity /modules/vescape-core/src/index.ts `getDayStats`
  func getDayStats(_ options: [String: Any]) throws -> [String: Any?] {
    let calendar = Calendar.current
    let day = DateComponents(
      year: telemetryInt(options["year"]),
      month: telemetryInt(options["month"]),
      day: telemetryInt(options["day"])
    )
    return computeProfileStatsForSessions(try readSessions().filter { session in
      let date = Date(timeIntervalSince1970: Double(session.startAtMs) / 1000.0)
      let parts = calendar.dateComponents([.year, .month, .day], from: date)
      return parts.year == day.year && parts.month == day.month && parts.day == day.day
    })
  }

  /// Stats of the rides still going on or finished at or after `sinceMs`, so a ride that crosses
  /// midnight keeps counting as the one being ridden.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `readProfileRecentStats`
  /// @parity /modules/vescape-core/src/index.ts `getRecentRideStats`
  func getRecentRideStats(sinceMs: Int64) throws -> [String: Any?] {
    computeProfileStatsForSessions(try readSessions().filter { $0.endAtMs >= sinceMs })
  }

  private func readSessions() throws -> [RideSessionAggregate] {
    let gapMs = try gapMsProvider()
    let pool = try poolProvider()
    return try pool.read { db in
      let buckets = try Row.fetchAll(db, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms ASC")
      let markers: [Row]
      if buckets.isEmpty {
        markers = []
      } else {
        let fromMs = (buckets.map { $0["first_sample_at_ms"] as Int64 }.min() ?? 0) - gapMs
        let toMs = (buckets.map { $0["last_sample_at_ms"] as Int64 }.max() ?? 0) + TELEMETRY_BUCKET_SIZE_MS
        markers = try Row.fetchAll(
          db,
          sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? ORDER BY occurred_at_ms ASC",
          arguments: [fromMs, toMs]
        )
      }
      return try groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
        .filter { $0.avgSpeedSampleCount > 0 }
    }
  }

  private func profileStatsSnapshot(
    sessions: [RideSessionAggregate],
    options: [String: Any]
  ) -> [String: Any?] {
    let months = profileMonthsForSessions(sessions)
    let now = profileMonth(telemetryNowMs(), calendar: .current)
    let selected = ProfileStatsMonth(
      year: telemetryInt(options["year"]) ?? months.first?.year ?? now.year,
      month: telemetryInt(options["month"]) ?? months.first?.month ?? now.month
    )
    return [
      "total": computeProfileStatsForSessions(sessions),
      "monthly": computeProfileStatsForSessions(
        sessions.filter { profileMonth($0.startAtMs, calendar: .current) == selected }
      ),
      "months": months.map { ["year": $0.year, "month": $0.month] },
      "selectedMonth": ["year": selected.year, "month": selected.month],
    ]
  }
}

internal func computeProfileStatsForBuckets(
  buckets: [Row],
  markers: [Row],
  month: ProfileStatsMonth?,
  calendar: Calendar = .current,
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) throws -> [String: Any?] {
  let sessions = try groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
    .filter { $0.avgSpeedSampleCount > 0 }
  return computeProfileStatsForSessions(month.map { target in
    sessions.filter { profileMonth($0.startAtMs, calendar: calendar) == target }
  } ?? sessions)
}

private func computeProfileStatsForSessions(_ included: [RideSessionAggregate]) -> [String: Any?] {
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
  let topSpeedRide = included.max { $0.topSpeedKmh < $1.topSpeedKmh }
  let longestRide = included.filter { $0.distanceM != nil }.max { $0.distanceM! < $1.distanceM! }
  let avgSpeedSamples = included.reduce(0) { $0 + $1.avgSpeedSampleCount }
  let avgSpeedKmh = avgSpeedSamples > 0
    ? included.reduce(0.0) { $0 + $1.avgSpeedWeightedSum } / Double(avgSpeedSamples)
    : 0.0

  return [
    "distanceM": distances.isEmpty ? nil : distances.reduce(0.0, +),
    "rideCount": included.count,
    "rideTimeMs": totalDurationMs,
    "topSpeedKmh": topSpeedRide?.topSpeedKmh ?? 0.0,
    "avgSpeedKmh": avgSpeedKmh,
    "longestRideM": longestRide?.distanceM,
    "batteryUsedWh": included.reduce(0.0) { $0 + $1.batteryUsedWh },
    "batteryRegenWh": included.reduce(0.0) { $0 + $1.batteryRegenWh },
    "topSpeedRideId": topSpeedRide.map(rideSessionId),
    "longestRideId": longestRide.map(rideSessionId),
  ]
}

internal func computeProfileStatMonthsForBuckets(
  buckets: [Row],
  markers: [Row],
  calendar: Calendar = .current,
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) throws -> [ProfileStatsMonth] {
  profileMonthsForSessions(
    try groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
      .filter { $0.avgSpeedSampleCount > 0 },
    calendar: calendar
  )
}

private func profileMonthsForSessions(
  _ sessions: [RideSessionAggregate],
  calendar: Calendar = .current
) -> [ProfileStatsMonth] {
  Array(Set(sessions.map { profileMonth($0.startAtMs, calendar: calendar) }))
    .sorted {
      $0.year == $1.year ? $0.month > $1.month : $0.year > $1.year
    }
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
    "topSpeedRideId": nil,
    "longestRideId": nil,
  ]
}
