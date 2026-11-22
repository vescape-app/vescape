package expo.modules.vescapecore.watch

/**
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_STALE_AFTER_MS`
 */
internal const val GROUP_RIDE_STALE_AFTER_MS = 5_000L

/**
 * @parity /src/modules/group-ride/lib/riderColor.ts `RIDER_HUES`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_RIDER_COLORS`
 */
internal val GROUP_RIDE_RIDER_COLORS = intArrayOf(
    0xFF06B6D4.toInt(),
    0xFF22C55E.toInt(),
    0xFFF59E0B.toInt(),
    0xFFC084FC.toInt(),
    0xFF38BDF8.toInt(),
)

/**
 * @parity /src/modules/group-ride/lib/riderColor.ts `riderPaletteIndex`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `groupRideRiderPaletteIndex`
 */
internal fun groupRideRiderPaletteIndex(id: String): Int {
    var hash = FNV_OFFSET_BASIS
    for (byte in id.toByteArray(Charsets.UTF_8)) {
        hash = (hash xor (byte.toInt() and 0xFF)) * FNV_PRIME
    }
    return (hash.toUInt() % GROUP_RIDE_RIDER_COLORS.size.toUInt()).toInt()
}

internal fun groupRideRiderColor(id: String): Int = GROUP_RIDE_RIDER_COLORS[groupRideRiderPaletteIndex(id)]

private const val FNV_OFFSET_BASIS = 0x811C9DC5.toInt()
private const val FNV_PRIME = 0x01000193

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GroupRideRosterRider`
 */
internal data class GroupRideRosterRider(
    val id: String,
    val name: String,
    val position: GeoPoint?,
    val stale: Boolean,
    val away: Boolean,
    val lastSeenMs: Long,
    val soc: Double? = null,
    val motorTempC: Double? = null,
    val ctrlTempC: Double? = null,
)

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GroupRideRoster`
 */
internal data class GroupRideRoster(
    val ownRiderId: String?,
    val riders: List<GroupRideRosterRider>,
)
