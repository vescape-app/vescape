import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
/// @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
let GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_NEARBY_RIDER_LIMIT`
let GROUP_RIDE_NEARBY_RIDER_LIMIT = 10

/// @parity /src/modules/group-ride/lib/roster.ts `NEARBY_RIDER_BAND_M`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_NEARBY_BAND_M`
let GROUP_RIDE_NEARBY_BAND_M = 250.0

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
          colorArgb: groupRideRiderColor(rider.id),
          eastM: offset.east,
          northM: offset.north,
          stale: rider.stale || rider.away || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS,
          batteryPercent: rider.soc.flatMap { $0.isFinite ? Int((min(max($0, 0), 1) * 100).rounded()) : nil },
          batteryLevel: TelemetryThresholds.batteryLevel(rider.soc),
          heatLevel: TelemetryThresholds.heatLevel(motorTempC: rider.motorTempC, ctrlTempC: rider.ctrlTempC)
        )
      }
    return nearbyOrder(placed)
  }

  /// @parity /src/modules/group-ride/lib/roster.ts `publicRiderRoster`
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `nearbyOrder`
  private static func nearbyOrder(_ placed: [GroupRideFrameRider]) -> [GroupRideFrameRider] {
    let nearest = placed.enumerated()
      .sorted { $0.element.distanceM != $1.element.distanceM ? $0.element.distanceM < $1.element.distanceM : $0.offset < $1.offset }
      .prefix(GROUP_RIDE_NEARBY_RIDER_LIMIT)
      .map(\.element)
    func band(_ rider: GroupRideFrameRider) -> Double { (rider.distanceM / GROUP_RIDE_NEARBY_BAND_M).rounded(.down) }
    return nearest.sorted { band($0) != band($1) ? band($0) < band($1) : $0.id < $1.id }
  }
}
