import Foundation

/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_STALE_AFTER_MS`
let GROUP_RIDE_STALE_AFTER_MS: Int64 = 5_000

/// @parity /src/modules/group-ride/lib/riderColor.ts `RIDER_HUES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_RIDER_COLORS`
let GROUP_RIDE_RIDER_COLORS: [UInt32] = [
  0xFF06_B6D4,
  0xFF22_C55E,
  0xFFF5_9E0B,
  0xFFC0_84FC,
  0xFF38_BDF8,
]

/// @parity /src/modules/group-ride/lib/riderColor.ts `riderPaletteIndex`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `groupRideRiderPaletteIndex`
func groupRideRiderPaletteIndex(_ id: String) -> Int {
  var hash: UInt32 = 0x811C_9DC5
  for byte in id.utf8 {
    hash = (hash ^ UInt32(byte)) &* 0x0100_0193
  }
  return Int(hash % UInt32(GROUP_RIDE_RIDER_COLORS.count))
}

func groupRideRiderColor(_ id: String) -> UInt32 {
  GROUP_RIDE_RIDER_COLORS[groupRideRiderPaletteIndex(id)]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GroupRideRosterRider`
struct GroupRideRosterRider: Equatable {
  var id: String
  var name: String
  var position: WatchGeoPoint?
  var stale: Bool
  var away: Bool
  var lastSeenMs: Int64
  var soc: Double? = nil
  var motorTempC: Double? = nil
  var ctrlTempC: Double? = nil
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GroupRideRoster`
struct GroupRideRoster: Equatable {
  var ownRiderId: String?
  var riders: [GroupRideRosterRider]
}
