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
  private var pool: DatabasePool? { TelemetryDatabase.pool }

  private init() {}

  /// Rider-set ride split gap, so profile stats count the same rides the history list shows.
  private func rideSplitGapMs() -> Int64 {
    let minutes = telemetryInt(AppDataRepository.shared.getSettings()["rideSplitGapMinutes"] ?? nil)
    return Int64(minutes ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
  }

  /// Lifetime, available months, and selected-month stats from one read/grouping pass.
  /// @parity /modules/vescape-core/src/index.ts `ProfileStatsSnapshot`
  func getProfileStatsSnapshot(_ options: [String: Any]) -> [String: Any?] {
    let gapMs = rideSplitGapMs()
    guard let pool else { return emptyProfileStatsSnapshot(options) }
    return (try? pool.read { db in
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
      let sessions = groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
        .filter { $0.avgSpeedSampleCount > 0 }
      return profileStatsSnapshot(sessions: sessions, options: options)
    }) ?? emptyProfileStatsSnapshot(options)
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
      "total": computeProfileStatsForSessions(sessions, month: nil),
      "monthly": computeProfileStatsForSessions(sessions, month: selected),
      "months": months.map { ["year": $0.year, "month": $0.month] },
      "selectedMonth": ["year": selected.year, "month": selected.month],
    ]
  }

  private func emptyProfileStatsSnapshot(_ options: [String: Any]) -> [String: Any?] {
    profileStatsSnapshot(sessions: [], options: options)
  }
}

internal func computeProfileStatsForBuckets(
  buckets: [Row],
  markers: [Row],
  month: ProfileStatsMonth?,
  calendar: Calendar = .current,
  gapMs: Int64 = DEFAULT_RIDE_SPLIT_GAP_MS
) -> [String: Any?] {
  let sessions = groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
    .filter { $0.avgSpeedSampleCount > 0 }
  return computeProfileStatsForSessions(sessions, month: month, calendar: calendar)
}

private func computeProfileStatsForSessions(
  _ sessions: [RideSessionAggregate],
  month: ProfileStatsMonth?,
  calendar: Calendar = .current
) -> [String: Any?] {
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
  profileMonthsForSessions(
    groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs)
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
  ]
}
