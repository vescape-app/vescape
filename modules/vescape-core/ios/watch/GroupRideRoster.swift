import Foundation

/// Client-side presence ageing, the same rule the phone roster applies. Nobody is dropped
/// client-side; the relay's roster decides who is in the ride.
///
/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_STALE_AFTER_MS`
let GROUP_RIDE_STALE_AFTER_MS: Int64 = 5_000

/// The Rider palette in slot order, as the phone's dark accents. A Rider id owns one slot everywhere.
///
/// @parity /src/modules/group-ride/lib/riderColor.ts `RIDER_HUES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_RIDER_COLORS`
let GROUP_RIDE_RIDER_COLORS: [UInt32] = [
  0xFF06_B6D4, // cyan
  0xFF22_C55E, // green
  0xFFF5_9E0B, // amber
  0xFFC0_84FC, // fuchsia
  0xFF38_BDF8, // sky
]

/// The palette slot a Rider id owns: FNV-1a 32-bit over the id's UTF-8 bytes, modulo the palette
/// size. Depends on the id alone, so distance, stale and away never move it.
///
/// @parity /src/modules/group-ride/lib/riderColor.ts `riderPaletteIndex`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `groupRideRiderPaletteIndex`
func groupRideRiderPaletteIndex(_ id: String) -> Int {
  var hash: UInt32 = 0x811C_9DC5
  for byte in id.utf8 {
    hash = (hash ^ UInt32(byte)) &* 0x0100_0193
  }
  return Int(hash % UInt32(GROUP_RIDE_RIDER_COLORS.count))
}

/// The opaque ARGB colour a Rider id owns.
func groupRideRiderColor(_ id: String) -> UInt32 {
  GROUP_RIDE_RIDER_COLORS[groupRideRiderPaletteIndex(id)]
}

/// One roster entry as native keeps it for the wrist: the relay's `RiderView` reduced to what the
/// Group Ride Frame needs.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GroupRideRosterRider`
struct GroupRideRosterRider: Equatable {
  var id: String
  var name: String
  /// Latest presence position; nil for a Rider who has not shared one yet.
  var position: WatchGeoPoint?
  var stale: Bool
  /// The Rider's link to the relay closed; they stay in the ride, frozen at their last presence.
  var away: Bool
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
