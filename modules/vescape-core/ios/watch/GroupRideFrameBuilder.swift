import Foundation

/// Map span the wrist uses until the phone map has published its own. Same fallback as the route.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
/// @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
let GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/// Pure roster -> Group Ride Frame builder. Every other Rider with a position becomes an east/north
/// offset from the Rider's latest GPS Fix, nearest first; the Rider's own entry never does.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GroupRideFrameBuilder`
enum GroupRideFrameBuilder {
  static func build(
    roster: GroupRideRoster,
    own: WatchGeoPoint?,
    courseDeg: Double?,
    spanM: Double?,
    nowMs: Int64
  ) -> GroupRideFrame {
    let riders = own.map { place(roster: roster, own: $0, nowMs: nowMs) } ?? []
    let span = spanM.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? GROUP_RIDE_DEFAULT_SPAN_M
    return GroupRideFrame(courseDeg: courseDeg, spanM: span, riders: riders)
  }

  private struct Entry {
    let rider: GroupRideRosterRider
    let offset: (east: Double, north: Double)?
    let stale: Bool
    var distanceM: Double? { offset.map { ($0.east * $0.east + $0.north * $0.north).squareRoot() } }
  }

  private static func place(roster: GroupRideRoster, own: WatchGeoPoint, nowMs: Int64) -> [GroupRideFrameRider] {
    let fresh = roster.riders.filter { nowMs - $0.lastSeenMs < GROUP_RIDE_DROP_AFTER_MS }
    let entries = fresh
      .filter { $0.id != roster.ownRiderId }
      .map { rider in
        Entry(
          rider: rider,
          offset: rider.position.map { watchOffsetMeters(origin: own, point: $0) },
          stale: rider.stale || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS
        )
      }
      // The phone map's roster order, which is what its fallback tints are indexed by: fresh before
      // stale, nearest first, the unplaced last by name.
      .sorted { a, b in
        if a.stale != b.stale { return !a.stale }
        switch (a.distanceM, b.distanceM) {
        case let (x?, y?) where x != y: return x < y
        case (nil, _?): return false
        case (_?, nil): return true
        default: return a.rider.name < b.rider.name
        }
      }
    // The phone roster pins the Rider's own entry first, so everyone else's index starts after it.
    let first = fresh.contains { $0.id == roster.ownRiderId } ? 1 : 0
    let placed: [GroupRideFrameRider] = entries.enumerated().compactMap { index, entry in
      guard let offset = entry.offset else { return nil }
      return GroupRideFrameRider(
        id: entry.rider.id,
        name: entry.rider.name,
        colorArgb: parseRiderColor(entry.rider.color)
          ?? GROUP_RIDE_FALLBACK_COLORS[(first + index) % GROUP_RIDE_FALLBACK_COLORS.count],
        eastM: offset.east,
        northM: offset.north,
        stale: entry.stale,
        batteryPercent: entry.rider.soc.flatMap { $0.isFinite ? Int((min(max($0, 0), 1) * 100).rounded()) : nil },
        batteryLevel: TelemetryThresholds.batteryLevel(entry.rider.soc),
        heatLevel: TelemetryThresholds.heatLevel(motorTempC: entry.rider.motorTempC, ctrlTempC: entry.rider.ctrlTempC)
      )
    }
    return Array(placed.sorted { $0.distanceM < $1.distanceM }.prefix(GROUP_RIDE_FRAME_MAX_RIDERS))
  }

  /// `#RRGGBB` -> opaque ARGB; anything else is no colour.
  private static func parseRiderColor(_ color: String?) -> UInt32? {
    guard var hex = color else { return nil }
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return nil }
    return 0xFF00_0000 | rgb
  }
}
