package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchRouteStatus

/** A coherent map decision for one frame, independent of Compose and its animation clock.
 * Navigation owns the camera while drawable; otherwise Group Ride takes over, then standalone GPS.
 * @parity /modules/vescape-core/ios/watch/WatchMapSceneState.swift
 */
internal class WatchMapSceneState(
    frame: WatchFrame,
    routeId: Long?,
    routeStatus: WatchRouteStatus?,
    group: WatchGroupRide?,
    ambient: Boolean,
    private val telemetryTrailEnabled: Boolean,
) {
    val navigation = if (frame.navBearing != null && frame.navDistanceM != null && routeStatus?.canDraw(routeId) != false)
        WatchMapNavigation(frame.navBearing, frame.navDistanceM) else null
    val hasNavigation: Boolean get() = navigation != null
    val notice = routeStatus?.notice(routeId, frame.navBearing != null && frame.navDistanceM != null && frame.riderEastM != null && frame.riderNorthM != null)
    val drawMap = !ambient
    val showAbsentHint = !hasNavigation && notice == null && group == null && frame.trail.isEmpty()
    val target = WatchMapTarget(
        spanM = WatchMapProjection.clampRouteSpanM(if (!hasNavigation && group != null) group.spanM else frame.routeSpanM),
        courseDeg = (if (!hasNavigation && group != null) group.courseDeg else frame.courseDeg)?.toFloat(),
        position = frame.mapPosition,
    )

    fun trailAlpha(navFocus: Float): Float = when {
        !drawMap -> 0f
        telemetryTrailEnabled -> 1f
        else -> navFocus.coerceIn(0f, 1f)
    }
}

internal data class WatchMapTarget(val spanM: Float, val courseDeg: Float?, val position: WatchMapPosition?)

internal data class WatchMapNavigation(val bearingDeg: Double, val distanceM: Double)
