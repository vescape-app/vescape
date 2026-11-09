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

  private static func place(roster: GroupRideRoster, own: WatchGeoPoint, nowMs: Int64) -> [GroupRideFrameRider] {
    let placed: [GroupRideFrameRider] = roster.riders
      .filter { $0.id != roster.ownRiderId }
      .compactMap { rider in
        guard let position = rider.position else { return nil }
        let offset = watchOffsetMeters(origin: own, point: position)
        return GroupRideFrameRider(
          id: rider.id,
          name: rider.name,
          // Stale riders keep their slot; the wrist mutes them at draw time.
          colorArgb: groupRideRiderColor(rider.id),
          eastM: offset.east,
          northM: offset.north,
          stale: rider.stale || rider.away || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS,
          batteryPercent: rider.soc.flatMap { $0.isFinite ? Int((min(max($0, 0), 1) * 100).rounded()) : nil },
          batteryLevel: TelemetryThresholds.batteryLevel(rider.soc),
          heatLevel: TelemetryThresholds.heatLevel(motorTempC: rider.motorTempC, ctrlTempC: rider.ctrlTempC)
        )
      }
    return Array(placed.sorted { $0.distanceM < $1.distanceM }.prefix(GROUP_RIDE_FRAME_MAX_RIDERS))
  }
}
