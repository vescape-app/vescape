import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRide`
struct WatchGroupRide: Equatable {
  var courseDeg: Double
  var spanM: Double
  var riders: [GroupRideFrameRider]

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `GROUP_RIDE_TIMEOUT_MS`
  static let timeoutMs: Int64 = 3_500

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `accepting`
  static func accepting(_ frame: GroupRideFrame, previous: WatchGroupRide?) -> WatchGroupRide {
    WatchGroupRide(
      courseDeg: frame.courseDeg ?? previous?.courseDeg ?? 0,
      spanM: frame.spanM,
      riders: frame.riders
    )
  }

  func bearingDeg(of rider: GroupRideFrameRider) -> Double {
    relativeBearingDeg(eastM: rider.eastM, northM: rider.northM, courseDeg: courseDeg)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `roster`
  func roster() -> [WatchGroupRideRow] {
    riders
      .sorted { $0.distanceM != $1.distanceM ? $0.distanceM < $1.distanceM : $0.id < $1.id }
      .map { rider in
        WatchGroupRideRow(
          rider: rider,
          name: String(String.UnicodeScalarView(rider.name.unicodeScalars.prefix(GROUP_ROW_NAME_CHARS))),
          bearingDeg: bearingDeg(of: rider),
          status: groupRideStatus(rider)
        )
      }
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRideRow`
struct WatchGroupRideRow: Equatable {
  let rider: GroupRideFrameRider
  let name: String
  let bearingDeg: Double
  let status: WatchGroupRideStatus
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRideStatus`
enum WatchGroupRideStatus: Equatable {
  case stale
  case hot(TelemetryLevel)
  case battery(percent: Int, level: TelemetryLevel)
  case noBoard
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideStatus`
func groupRideStatus(_ rider: GroupRideFrameRider) -> WatchGroupRideStatus {
  if rider.stale { return .stale }
  if rider.heatLevel != .normal { return .hot(rider.heatLevel) }
  guard let percent = rider.batteryPercent else { return .noBoard }
  return .battery(percent: percent, level: rider.batteryLevel)
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideLabelFlag`
func groupRideLabelFlag(_ rider: GroupRideFrameRider) -> WatchGroupRideStatus? {
  let status = groupRideStatus(rider)
  switch status {
  case .hot: return status
  case .battery(_, let level) where level != .normal: return status
  default: return nil
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `GROUP_ROW_NAME_CHARS`
private let GROUP_ROW_NAME_CHARS = 5

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideDistanceLabel`
func groupRideDistanceLabel(_ distanceM: Double, distanceUnit: String) -> String {
  UnitPresentation.distance(distanceM, distanceUnit: distanceUnit).replacingOccurrences(of: " ", with: "")
}
