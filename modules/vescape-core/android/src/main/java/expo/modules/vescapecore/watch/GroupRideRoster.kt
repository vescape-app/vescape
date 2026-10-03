package expo.modules.vescapecore.watch

/**
 * Client-side presence ageing, the same rule the phone roster applies: a Rider unheard for
 * [GROUP_RIDE_STALE_AFTER_MS] is stale, and one unheard for [GROUP_RIDE_DROP_AFTER_MS] is gone.
 *
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_STALE_AFTER_MS`
 */
internal const val GROUP_RIDE_STALE_AFTER_MS = 5_000L

/**
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_DROP_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_DROP_AFTER_MS`
 */
internal const val GROUP_RIDE_DROP_AFTER_MS = 30_000L

/**
 * Fallback tints for a Rider who has not picked a colour, by their index in the phone roster.
 *
 * @parity /src/modules/group-ride/lib/riderColor.ts `riderFallbackColors`
 * @parity /src/modules/group-ride/lib/roster.ts `riderRoster`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_FALLBACK_COLORS`
 */
internal val GROUP_RIDE_FALLBACK_COLORS = intArrayOf(
    0xFF06B6D4.toInt(), // cyan
    0xFF22C55E.toInt(), // green
    0xFFF59E0B.toInt(), // amber
    0xFFC084FC.toInt(), // fuchsia
    0xFF38BDF8.toInt(), // sky
)

/**
 * One roster entry as native keeps it for the wrist: the relay's `RiderView` reduced to what the
 * Group Ride Frame needs.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GroupRideRosterRider`
 */
internal data class GroupRideRosterRider(
    val id: String,
    val name: String,
    /** `#RRGGBB` as the Rider picked it, or null. */
    val color: String?,
    /** Latest presence position; null for a Rider who has not shared one yet. */
    val position: GeoPoint?,
    val stale: Boolean,
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
