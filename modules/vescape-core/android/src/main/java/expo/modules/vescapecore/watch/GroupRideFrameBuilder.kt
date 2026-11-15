package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryThresholds
import kotlin.math.roundToInt

/**
 * Map span the wrist uses until the phone map has published its own. Same fallback as the route.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_DEFAULT_SPAN_M`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapSpan`
 */
internal const val GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/**
 * Most nearby public riders the wrist shows; smaller than the phone's list, a glance holds fewer.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_NEARBY_RIDER_LIMIT`
 */
internal const val GROUP_RIDE_NEARBY_RIDER_LIMIT = 10

/**
 * Distance band for the nearby order, the phone list's: riders inside one band keep a fixed order.
 *
 * @parity /src/modules/group-ride/lib/roster.ts `NEARBY_RIDER_BAND_M`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_NEARBY_BAND_M`
 */
internal const val GROUP_RIDE_NEARBY_BAND_M = 250.0

/**
 * Pure roster -> Group Ride Frame builder. Every other Rider with a position becomes an east/north
 * offset from the Rider's latest GPS Fix, nearest first; the Rider's own entry never does.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GroupRideFrameBuilder`
 */
internal object GroupRideFrameBuilder {
    fun build(
        roster: GroupRideRoster,
        /** The Rider's latest GPS Fix. Without one there is nothing to measure from. */
        own: GeoPoint?,
        courseDeg: Double?,
        spanM: Double?,
        nowMs: Long,
    ): GroupRideFrame {
        val riders = if (own == null) emptyList() else place(roster, own, nowMs)
        return GroupRideFrame(
            courseDeg = courseDeg,
            spanM = spanM?.takeIf { it.isFinite() && it > 0.0 } ?: GROUP_RIDE_DEFAULT_SPAN_M,
            riders = riders,
        )
    }

    private fun place(roster: GroupRideRoster, own: GeoPoint, nowMs: Long): List<GroupRideFrameRider> =
        roster.riders
            .filter { it.id != roster.ownRiderId }
            .mapNotNull { rider ->
                val (east, north) = rider.position?.let { offsetMeters(own, it) } ?: return@mapNotNull null
                GroupRideFrameRider(
                    id = rider.id,
                    name = rider.name,
                    // Stale riders keep their slot; the wrist mutes them at draw time.
                    colorArgb = groupRideRiderColor(rider.id),
                    eastM = east,
                    northM = north,
                    stale = rider.stale || rider.away || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS,
                    batteryPercent = rider.soc?.takeIf { it.isFinite() }?.let { (it.coerceIn(0.0, 1.0) * 100).roundToInt() },
                    batteryLevel = TelemetryThresholds.batteryLevel(rider.soc),
                    heatLevel = TelemetryThresholds.heatLevel(rider.motorTempC, rider.ctrlTempC),
                )
            }
            .let { placed -> if (roster.nearby) nearbyOrder(placed) else placed.sortedBy { it.distanceM }.take(GROUP_RIDE_FRAME_MAX_RIDERS) }

    /**
     * The phone's nearby rule: the [GROUP_RIDE_NEARBY_RIDER_LIMIT] nearest by exact distance (relay
     * order breaks ties), then nearest band first and account id inside a band, so a rider moves only
     * when they cross a band. Unplaced riders never reach here.
     *
     * @parity /src/modules/group-ride/lib/roster.ts `publicRiderRoster`
     * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `nearbyOrder`
     */
    private fun nearbyOrder(placed: List<GroupRideFrameRider>): List<GroupRideFrameRider> =
        placed
            .sortedBy { it.distanceM }
            .take(GROUP_RIDE_NEARBY_RIDER_LIMIT)
            .sortedWith(compareBy<GroupRideFrameRider> { kotlin.math.floor(it.distanceM / GROUP_RIDE_NEARBY_BAND_M) }.thenBy { it.id })
}
