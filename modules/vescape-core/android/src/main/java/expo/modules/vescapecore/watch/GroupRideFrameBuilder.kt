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
            .sortedBy { it.distanceM }
            .take(GROUP_RIDE_FRAME_MAX_RIDERS)
}
