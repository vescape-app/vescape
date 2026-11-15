import Foundation

/// Map span the wrist uses until the phone map has published its own. Same fallback as the route.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
/// @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
let GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/// Most nearby public riders the wrist shows; smaller than the phone's list, a glance holds fewer.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_NEARBY_RIDER_LIMIT`
let GROUP_RIDE_NEARBY_RIDER_LIMIT = 10

/// Distance band for the nearby order, the phone list's: riders inside one band keep a fixed order.
///
/// @parity /src/modules/group-ride/lib/roster.ts `NEARBY_RIDER_BAND_M`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_NEARBY_BAND_M`
let GROUP_RIDE_NEARBY_BAND_M = 250.0

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
    return nearbyOrder(placed)
  }

  /// The phone's nearby rule: the `GROUP_RIDE_NEARBY_RIDER_LIMIT` nearest by exact distance (relay
  /// order breaks ties), then nearest band first and account id inside a band, so a rider moves only
  /// when they cross a band. Unplaced riders never reach here.
  ///
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
