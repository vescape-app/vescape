import Foundation

/// Client-side presence ageing, the same rule the phone roster applies.
///
/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_STALE_AFTER_MS`
let GROUP_RIDE_STALE_AFTER_MS: Int64 = 5_000

/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_DROP_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_DROP_AFTER_MS`
let GROUP_RIDE_DROP_AFTER_MS: Int64 = 30_000

/// Fallback tints for a Rider who has not picked a colour, by their index in the phone roster.
///
/// @parity /src/modules/group-ride/lib/riderColor.ts `riderFallbackColors`
/// @parity /src/modules/group-ride/lib/roster.ts `riderRoster`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_FALLBACK_COLORS`
let GROUP_RIDE_FALLBACK_COLORS: [UInt32] = [
  0xFF06_B6D4, // cyan
  0xFF22_C55E, // green
  0xFFF5_9E0B, // amber
  0xFFC0_84FC, // fuchsia
  0xFF38_BDF8, // sky
]

/// One roster entry as native keeps it for the wrist: the relay's `RiderView` reduced to what the
/// Group Ride Frame needs.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GroupRideRosterRider`
struct GroupRideRosterRider: Equatable {
  var id: String
  var name: String
  /// `#RRGGBB` as the Rider picked it, or nil.
  var color: String?
  /// Latest presence position; nil for a Rider who has not shared one yet.
  var position: WatchGeoPoint?
  var stale: Bool
  /// Relay wall-clock time of the Rider's last presence, epoch ms.
  var lastSeenMs: Int64
  /// Battery SoC Estimate as a 0-1 fraction; nil without a Board Session.
  var soc: Double? = nil
  var motorTempC: Double? = nil
  var ctrlTempC: Double? = nil
}

/// The joined Group Ride as native holds it: who the Rider is and everyone in the ride.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GroupRideRoster`
struct GroupRideRoster: Equatable {
  var ownRiderId: String?
  var riders: [GroupRideRosterRider]
}
