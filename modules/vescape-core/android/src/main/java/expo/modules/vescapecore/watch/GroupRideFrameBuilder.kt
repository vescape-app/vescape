package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryThresholds
import kotlin.math.hypot
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

    private class Entry(val rider: GroupRideRosterRider, val offset: Pair<Double, Double>?, val stale: Boolean) {
        val distanceM: Double? = offset?.let { (east, north) -> hypot(east, north) }
    }

    private fun place(roster: GroupRideRoster, own: GeoPoint, nowMs: Long): List<GroupRideFrameRider> {
        fun silentMs(rider: GroupRideRosterRider) = nowMs - rider.lastSeenMs
        val fresh = roster.riders.filter { silentMs(it) < GROUP_RIDE_DROP_AFTER_MS }
        val entries = fresh
            .filter { it.id != roster.ownRiderId }
            .map { rider ->
                Entry(
                    rider,
                    rider.position?.let { offsetMeters(own, it) },
                    stale = rider.stale || silentMs(rider) >= GROUP_RIDE_STALE_AFTER_MS,
                )
            }
            // The phone map's roster order, which is what its fallback tints are indexed by: fresh
            // before stale, nearest first, the unplaced last by name.
            .sortedWith(
                compareBy<Entry> { it.stale }
                    .thenBy { it.distanceM == null }
                    .thenBy { it.distanceM ?: 0.0 }
                    .thenBy { it.rider.name },
            )
        // The phone roster pins the Rider's own entry first, so everyone else's index starts after it.
        val first = if (fresh.any { it.id == roster.ownRiderId }) 1 else 0
        return entries
            .mapIndexedNotNull { index, entry ->
                val (east, north) = entry.offset ?: return@mapIndexedNotNull null
                GroupRideFrameRider(
                    id = entry.rider.id,
                    name = entry.rider.name,
                    colorArgb = parseRiderColor(entry.rider.color)
                        ?: GROUP_RIDE_FALLBACK_COLORS[(first + index) % GROUP_RIDE_FALLBACK_COLORS.size],
                    eastM = east,
                    northM = north,
                    stale = entry.stale,
                    batteryPercent = entry.rider.soc?.takeIf { it.isFinite() }?.let { (it.coerceIn(0.0, 1.0) * 100).roundToInt() },
                    batteryLevel = TelemetryThresholds.batteryLevel(entry.rider.soc),
                    heatLevel = TelemetryThresholds.heatLevel(entry.rider.motorTempC, entry.rider.ctrlTempC),
                )
            }
            .sortedBy { it.distanceM }
            .take(GROUP_RIDE_FRAME_MAX_RIDERS)
    }

    /** `#RRGGBB` -> opaque ARGB; anything else is no colour. */
    private fun parseRiderColor(color: String?): Int? {
        val hex = color?.removePrefix("#")?.takeIf { it.length == 6 } ?: return null
        val rgb = hex.toIntOrNull(16) ?: return null
        return (0xFF000000.toInt()) or rgb
    }
}
