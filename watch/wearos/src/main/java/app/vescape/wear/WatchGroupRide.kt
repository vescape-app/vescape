package app.vescape.wear

import androidx.compose.runtime.mutableStateOf
import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRide`
 */
internal data class WatchGroupRide(
    val courseDeg: Double,
    val spanM: Double,
    val riders: List<GroupRideFrameRider>,
) {
    companion object {
        /**
         * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `accepting`
         */
        fun accepting(frame: GroupRideFrame, previous: WatchGroupRide?) = WatchGroupRide(
            courseDeg = frame.courseDeg ?: previous?.courseDeg ?: 0.0,
            spanM = frame.spanM,
            riders = frame.riders,
        )
    }

    fun bearingDeg(rider: GroupRideFrameRider): Double =
        relativeBearingDeg(rider.eastM, rider.northM, courseDeg)

    /**
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
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRideRow`
 */
internal data class WatchGroupRideRow(
    val rider: GroupRideFrameRider,
    val name: String,
    val bearingDeg: Double,
    val status: WatchGroupRideStatus,
)

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `WatchGroupRideStatus`
 */
internal sealed interface WatchGroupRideStatus {
    data object Stale : WatchGroupRideStatus

    data class Hot(val level: TelemetryLevel) : WatchGroupRideStatus

    data class Battery(val percent: Int, val level: TelemetryLevel) : WatchGroupRideStatus

    data object NoBoard : WatchGroupRideStatus
}

/**
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

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `groupRideLabelFlag`
 */
internal fun groupRideLabelFlag(rider: GroupRideFrameRider): WatchGroupRideStatus? =
    when (val status = groupRideStatus(rider)) {
        is WatchGroupRideStatus.Hot -> status
        is WatchGroupRideStatus.Battery -> status.takeIf { it.level != TelemetryLevel.NORMAL }
        else -> null
    }

private fun String.takeCodePoints(count: Int): String =
    substring(0, offsetByCodePoints(0, minOf(count, codePointCount(0, length))))

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `GROUP_ROW_NAME_CHARS`
 */
private const val GROUP_ROW_NAME_CHARS = 5

/**
 * @parity /watch/watchos/PhoneLink.swift `groupRide`
 */
internal object GroupRideState {
    val group = mutableStateOf<WatchGroupRide?>(null)
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `timeoutMs`
 */
internal const val GROUP_RIDE_TIMEOUT_MS = 3_500L

/**
 * @parity /modules/vescape-core/ios/watch/WatchGroupRide.swift `groupRideDistanceLabel`
 */
internal fun groupRideDistanceLabel(distanceM: Double, distanceUnit: String): String =
    UnitPresentation.distance(distanceM, distanceUnit).replace(" ", "")
