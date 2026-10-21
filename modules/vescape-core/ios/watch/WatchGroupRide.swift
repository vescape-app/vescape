import Foundation

/// The joined Group Ride as the wrist knows it: the latest Group Ride Frame, with the Rider's course
/// held across frames that carry none, so a stopped Rider keeps the last heading-up direction.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRide`
struct WatchGroupRide: Equatable {
  /// The Rider's course, degrees clockwise from north; 0 (north-up) until one has ever arrived.
  var courseDeg: Double
  var spanM: Double
  var riders: [GroupRideFrameRider]

  /// Three missed 1 Hz frames and the group is gone from the wrist.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `GROUP_RIDE_TIMEOUT_MS`
  static let timeoutMs: Int64 = 3_500

  /// The next state for an arriving frame, keeping `previous`'s course when the frame has none.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `accepting`
  static func accepting(_ frame: GroupRideFrame, previous: WatchGroupRide?) -> WatchGroupRide {
    WatchGroupRide(
      courseDeg: frame.courseDeg ?? previous?.courseDeg ?? 0,
      spanM: frame.spanM,
      riders: frame.riders
    )
  }

  /// Where `rider` is relative to the Rider's travel direction: 0 ahead, 90 right, 180 behind.
  func bearingDeg(of rider: GroupRideFrameRider) -> Double {
    relativeBearingDeg(eastM: rider.eastM, northM: rider.northM, courseDeg: courseDeg)
  }

  /// The Group Ride page's rows: every other Rider, nearest first, ties by id so rows never swap.
  ///
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

/// One Group Ride page row. `name` is cut to `GROUP_ROW_NAME_CHARS` Unicode scalars.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRideRow`
struct WatchGroupRideRow: Equatable {
  let rider: GroupRideFrameRider
  let name: String
  let bearingDeg: Double
  let status: WatchGroupRideStatus
}

/// A row's one status slot.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `WatchGroupRideStatus`
enum WatchGroupRideStatus: Equatable {
  /// The Rider's readings are as old as their place, so none is shown; the slot reads "lost".
  case stale
  /// Running hot, at the heat level: a thermometer.
  case hot(TelemetryLevel)
  /// Battery SoC Estimate, coloured by its level.
  case battery(percent: Int, level: TelemetryLevel)
  /// No Board Session: a dash.
  case noBoard
}

/// The status slot, first match wins: stale ("lost"), thermometer when hot, dash without a Board,
/// else battery %. The phone classified the levels; nothing is thresholded here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideStatus`
func groupRideStatus(_ rider: GroupRideFrameRider) -> WatchGroupRideStatus {
  if rider.stale { return .stale }
  if rider.heatLevel != .normal { return .hot(rider.heatLevel) }
  guard let percent = rider.batteryPercent else { return .noBoard }
  return .battery(percent: percent, level: rider.batteryLevel)
}

/// A nav-focus label's flag: the `groupRideStatus` slot when it warns — `.hot`, or `.battery` at a
/// level above normal — else nil. A stale Rider has none.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideLabelFlag`
func groupRideLabelFlag(_ rider: GroupRideFrameRider) -> WatchGroupRideStatus? {
  let status = groupRideStatus(rider)
  switch status {
  case .hot: return status
  case .battery(_, let level) where level != .normal: return status
  default: return nil
  }
}

/// A Group Ride page name is cut to this many characters.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `GROUP_ROW_NAME_CHARS`
private let GROUP_ROW_NAME_CHARS = 5

/// A Rider's compact distance: "680m", "2.1km" in the Rider's units. The wrist's own distance
/// formatting without the space, so the label stays short beside its mark.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `groupRideDistanceLabel`
func groupRideDistanceLabel(_ distanceM: Double, unitSystem: String) -> String {
  UnitPresentation.distance(distanceM, unitSystem: unitSystem).replacingOccurrences(of: " ", with: "")
}
