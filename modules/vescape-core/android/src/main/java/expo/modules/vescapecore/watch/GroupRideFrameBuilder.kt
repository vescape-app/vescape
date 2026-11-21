package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryThresholds
import kotlin.math.roundToInt

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_DEFAULT_SPAN_M`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapSpan`
 */
internal const val GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_NEARBY_RIDER_LIMIT`
 */
internal const val GROUP_RIDE_NEARBY_RIDER_LIMIT = 10

/**
 * @parity /src/modules/group-ride/lib/roster.ts `NEARBY_RIDER_BAND_M`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_NEARBY_BAND_M`
 */
internal const val GROUP_RIDE_NEARBY_BAND_M = 250.0

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GroupRideFrameBuilder`
 */
internal object GroupRideFrameBuilder {
    fun build(
        roster: GroupRideRoster,
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
                    colorArgb = groupRideRiderColor(rider.id),
                    eastM = east,
                    northM = north,
                    stale = rider.stale || rider.away || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS,
                    batteryPercent = rider.soc?.takeIf { it.isFinite() }?.let { (it.coerceIn(0.0, 1.0) * 100).roundToInt() },
                    batteryLevel = TelemetryThresholds.batteryLevel(rider.soc),
                    heatLevel = TelemetryThresholds.heatLevel(rider.motorTempC, rider.ctrlTempC),
                )
            }
            .let(::nearbyOrder)

    /**
     * @parity /src/modules/group-ride/lib/roster.ts `publicRiderRoster`
     * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `nearbyOrder`
     */
    private fun nearbyOrder(placed: List<GroupRideFrameRider>): List<GroupRideFrameRider> =
        placed
            .sortedBy { it.distanceM }
            .take(GROUP_RIDE_NEARBY_RIDER_LIMIT)
            .sortedWith(compareBy<GroupRideFrameRider> { kotlin.math.floor(it.distanceM / GROUP_RIDE_NEARBY_BAND_M) }.thenBy { it.id })
}
