package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/** About once a second: Rider Presence itself moves no faster (ADR-0039). */
internal const val GROUP_RIDE_FRAME_INTERVAL_MS = 1_000L

/** Map span the wrist uses until the phone map has published its own. Same fallback as the route. */
internal const val GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/**
 * Client-side presence ageing, the same rule the phone roster applies: a Rider unheard for
 * [GROUP_RIDE_STALE_AFTER_MS] is stale, and one unheard for [GROUP_RIDE_DROP_AFTER_MS] is gone.
 *
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_STALE_AFTER_MS`
 */
internal const val GROUP_RIDE_STALE_AFTER_MS = 5_000L

/**
 * @parity /src/modules/group-ride/lib/roster.ts `RIDER_DROP_AFTER_MS`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_DROP_AFTER_MS`
 */
internal const val GROUP_RIDE_DROP_AFTER_MS = 30_000L

/**
 * Fallback tints for a Rider who has not picked a colour, by roster position.
 *
 * @parity /src/modules/group-ride/lib/riderColor.ts `riderFallbackColors`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_FALLBACK_COLORS`
 */
private val GROUP_RIDE_FALLBACK_COLORS = intArrayOf(
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
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GroupRideRosterRider`
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
)

/**
 * The joined Group Ride as native holds it: who the Rider is and everyone in the ride.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GroupRideRoster`
 */
internal data class GroupRideRoster(val ownRiderId: String?, val riders: List<GroupRideRosterRider>)

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
        val riders = if (own == null) {
            emptyList()
        } else {
            roster.riders
                .filter { it.id != roster.ownRiderId }
                .mapIndexedNotNull { index, rider ->
                    val position = rider.position ?: return@mapIndexedNotNull null
                    val silentMs = nowMs - rider.lastSeenMs
                    if (silentMs >= GROUP_RIDE_DROP_AFTER_MS) return@mapIndexedNotNull null
                    val (east, north) = offsetMeters(own, position)
                    GroupRideFrameRider(
                        id = rider.id,
                        name = rider.name,
                        colorArgb = parseRiderColor(rider.color)
                            ?: GROUP_RIDE_FALLBACK_COLORS[index % GROUP_RIDE_FALLBACK_COLORS.size],
                        eastM = east,
                        northM = north,
                        stale = rider.stale || silentMs >= GROUP_RIDE_STALE_AFTER_MS,
                    )
                }
                .sortedBy { it.distanceM }
                .take(GROUP_RIDE_FRAME_MAX_RIDERS)
        }
        return GroupRideFrame(
            courseDeg = courseDeg,
            spanM = spanM?.takeIf { it.isFinite() && it > 0.0 } ?: GROUP_RIDE_DEFAULT_SPAN_M,
            riders = riders,
        )
    }

    /** `#RRGGBB` -> opaque ARGB; anything else is no colour. */
    private fun parseRiderColor(color: String?): Int? {
        val hex = color?.removePrefix("#")?.takeIf { it.length == 6 } ?: return null
        val rgb = hex.toIntOrNull(16) ?: return null
        return (0xFF000000.toInt()) or rgb
    }
}

/**
 * The Group Ride Frame's own 1 Hz tick, beside the Watch Frame's [WatchTick] rather than inside it:
 * the two streams have their own sources and cadences (ADR-0039).
 *
 * It pushes only while all three hold: the Watch Frame could be pushed at all ([canPushWatchFrame]),
 * the wrist says it is awake and not in ambient, and the Rider is joined ([frame] non-null). A wrist
 * that never reports its wake level is too old to know this path, so it gets nothing.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GroupRideFrameTick`
 */
internal class GroupRideFrameTick(
    private val scheduler: Scheduler,
    private val canPushWatchFrame: () -> Boolean,
    private val wakeLevel: () -> WatchMirrorWakeLevel,
    private val frame: () -> GroupRideFrame?,
    private val push: (ByteArray) -> Unit,
) {
    private var handle: Cancellable? = null

    fun start() {
        if (handle == null) schedule()
    }

    fun stop() {
        handle?.cancel()
        handle = null
    }

    private fun schedule() {
        handle = scheduler.postDelayed(GROUP_RIDE_FRAME_INTERVAL_MS) {
            if (wakeLevel() == WatchMirrorWakeLevel.ACTIVE && canPushWatchFrame()) {
                frame()?.let { push(GroupRideFrameCodec.encode(it)) }
            }
            schedule()
        }
    }
}
