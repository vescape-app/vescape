package expo.modules.vescapecore.watch

/**
 * Client-side presence ageing, the same rule the phone roster applies: a Rider unheard for
 * [GROUP_RIDE_STALE_AFTER_MS] is stale. Nobody is dropped client-side; the relay's roster decides
 * who is in the ride.
 *
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_STALE_AFTER_MS`
 */
internal const val GROUP_RIDE_STALE_AFTER_MS = 5_000L

/**
 * The Rider palette in slot order, as the phone's dark accents. A Rider id owns one slot everywhere.
 *
 * @parity /src/modules/group-ride/lib/riderColor.ts `RIDER_HUES`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_RIDER_COLORS`
 */
internal val GROUP_RIDE_RIDER_COLORS = intArrayOf(
    0xFF06B6D4.toInt(), // cyan
    0xFF22C55E.toInt(), // green
    0xFFF59E0B.toInt(), // amber
    0xFFC084FC.toInt(), // fuchsia
    0xFF38BDF8.toInt(), // sky
)

/**
 * The palette slot a Rider id owns: FNV-1a 32-bit over the id's UTF-8 bytes, modulo the palette
 * size. Depends on the id alone, so distance, stale and away never move it.
 *
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

/** The opaque ARGB colour a Rider id owns. */
internal fun groupRideRiderColor(id: String): Int = GROUP_RIDE_RIDER_COLORS[groupRideRiderPaletteIndex(id)]

private const val FNV_OFFSET_BASIS = 0x811C9DC5.toInt()
private const val FNV_PRIME = 0x01000193

/**
 * One roster entry as native keeps it for the wrist: the relay's `RiderView` reduced to what the
 * Group Ride Frame needs.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GroupRideRosterRider`
 */
internal data class GroupRideRosterRider(
    val id: String,
    val name: String,
    /** Latest presence position; null for a Rider who has not shared one yet. */
    val position: GeoPoint?,
    val stale: Boolean,
    /** The Rider's link to the relay closed; they stay in the ride, frozen at their last presence. */
    val away: Boolean,
    /** Relay wall-clock time of the Rider's last presence, epoch ms. */
    val lastSeenMs: Long,
    /** Battery SoC Estimate as a 0-1 fraction; null without a Board Session. */
    val soc: Double? = null,
    val motorTempC: Double? = null,
    val ctrlTempC: Double? = null,
)

/**
 * The joined Group Ride as native holds it: who the Rider is and everyone in the ride.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GroupRideRoster`
 */
internal data class GroupRideRoster(val ownRiderId: String?, val riders: List<GroupRideRosterRider>)
