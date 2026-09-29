package app.vescape.wear

import android.os.SystemClock
import androidx.compose.runtime.mutableStateOf
import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider

/**
 * The joined Group Ride as the wrist knows it: the latest Group Ride Frame, with the Rider's course
 * held across frames that carry none, so a stopped Rider keeps the last heading-up direction.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRide`
 */
internal data class WatchGroupRide(
    /** The Rider's course, degrees clockwise from north; 0 (north-up) until one has ever arrived. */
    val courseDeg: Double,
    val spanM: Double,
    val riders: List<GroupRideFrameRider>,
) {
    /** Where [rider] is relative to the Rider's travel direction: 0 ahead, 90 right, 180 behind. */
    fun bearingDeg(rider: GroupRideFrameRider): Double =
        relativeBearingDeg(rider.eastM, rider.northM, courseDeg)

    /**
     * The Group Ride page's rows: every other Rider, nearest first, ties by id so rows never swap.
     *
     * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `roster`
     */
    fun roster(): List<WatchGroupRideRow> =
        riders.sortedWith(compareBy({ it.distanceM }, { it.id })).map { rider ->
            WatchGroupRideRow(
                rider = rider,
                name = rider.name.takeCodePoints(GROUP_ROW_NAME_CHARS),
                bearingDeg = bearingDeg(rider),
                status = groupRideStatus(rider),
            )
        }
}

/**
 * One Group Ride page row. [name] is cut to [GROUP_ROW_NAME_CHARS] characters.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRideRow`
 */
internal data class WatchGroupRideRow(
    val rider: GroupRideFrameRider,
    val name: String,
    val bearingDeg: Double,
    val status: WatchGroupRideStatus,
)

/**
 * A row's one status slot.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRideStatus`
 */
internal sealed interface WatchGroupRideStatus {
    /** The Rider's readings are as old as their place, so none is shown; the slot reads "lost". */
    data object Stale : WatchGroupRideStatus

    /** Running hot, at the heat level: a thermometer. */
    data class Hot(val level: TelemetryLevel) : WatchGroupRideStatus

    /** Battery SoC Estimate, coloured by its level. */
    data class Battery(val percent: Int, val level: TelemetryLevel) : WatchGroupRideStatus

    /** No Board Session: a dash. */
    data object NoBoard : WatchGroupRideStatus
}

/**
 * The status slot, first match wins: stale ("lost"), thermometer when hot, dash without a Board,
 * else battery %. The phone classified the levels; nothing is thresholded here.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `groupRideStatus`
 */
internal fun groupRideStatus(rider: GroupRideFrameRider): WatchGroupRideStatus {
    val battery = rider.batteryPercent
    return when {
        rider.stale -> WatchGroupRideStatus.Stale
        rider.heatLevel != TelemetryLevel.NORMAL -> WatchGroupRideStatus.Hot(rider.heatLevel)
        battery == null -> WatchGroupRideStatus.NoBoard
        else -> WatchGroupRideStatus.Battery(battery, rider.batteryLevel)
    }
}

/** First [count] Unicode scalars, so a cut never splits a surrogate pair. */
private fun String.takeCodePoints(count: Int): String =
    substring(0, offsetByCodePoints(0, minOf(count, codePointCount(0, length))))

/**
 * A Group Ride page name is cut to this many characters.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `GROUP_ROW_NAME_CHARS`
 */
internal const val GROUP_ROW_NAME_CHARS = 5

/**
 * Wrist-side Group Ride state. A frame lands here from [MainActivity]; [refresh] drops the group once
 * frames stop, which is also how leaving the ride, the phone losing the wrist and ambient all clear
 * it — the phone simply stops sending.
 *
 * @parity /watch/watchos/PhoneLink.swift `groupRide`
 */
internal object GroupRideState {
    val group = mutableStateOf<WatchGroupRide?>(null)
    private var lastFrameAtMs: Long? = null

    fun accept(frame: GroupRideFrame, nowMs: Long = SystemClock.elapsedRealtime()) {
        group.value = WatchGroupRide(
            courseDeg = frame.courseDeg ?: group.value?.courseDeg ?: 0.0,
            spanM = frame.spanM,
            riders = frame.riders,
        )
        lastFrameAtMs = nowMs
    }

    /** @parity /watch/watchos/PhoneLink.swift `refresh` */
    fun refresh(nowMs: Long = SystemClock.elapsedRealtime()) {
        val at = lastFrameAtMs ?: return
        if (nowMs - at > GROUP_RIDE_TIMEOUT_MS) {
            group.value = null
            lastFrameAtMs = null
        }
    }
}

/**
 * Three missed 1 Hz frames and the group is gone from the wrist.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `GROUP_RIDE_TIMEOUT_MS`
 */
private const val GROUP_RIDE_TIMEOUT_MS = 3_500L

/**
 * A Rider's compact distance: "680m", "2.1km" in the Rider's units. The wrist's own distance
 * formatting without the space, so the label stays short beside its mark.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `groupRideDistanceLabel`
 */
internal fun groupRideDistanceLabel(distanceM: Double, unitSystem: String): String =
    UnitPresentation.distance(distanceM, unitSystem).replace(" ", "")
