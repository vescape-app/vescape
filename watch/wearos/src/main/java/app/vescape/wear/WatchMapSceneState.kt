package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchMapSpan
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
    streetMapEnabled: Boolean,
) {
    val navigation = if (frame.navBearing != null && frame.navDistanceM != null && routeStatus?.canDraw(routeId) != false)
        WatchMapNavigation(frame.navBearing, frame.navDistanceM) else null
    val hasNavigation: Boolean get() = navigation != null
    val notice = routeStatus?.notice(routeId, frame.navBearing != null && frame.navDistanceM != null && frame.riderEastM != null && frame.riderNorthM != null)
    val drawMap = !ambient
    /** The rider can turn the street map off; the route, trail and marks stay. */
    val drawStreetMap = drawMap && streetMapEnabled
    val showAbsentHint = !hasNavigation && notice == null && group == null && frame.trail.isEmpty()
    val target = WatchMapTarget(
        spanM = WatchMapSpan.clamp(if (!hasNavigation && group != null) group.spanM else frame.routeSpanM),
        courseDeg = (if (!hasNavigation && group != null) group.courseDeg else frame.courseDeg)?.toFloat(),
        position = frame.mapPosition,
    )

    fun trailAlpha(navFocus: Float): Float = when {
        !drawMap -> 0f
        telemetryTrailEnabled -> 1f
        else -> navFocus.coerceIn(0f, 1f)
    }

    /** Street map: dimmed behind the gauges, full on the map page, absent in ambient or when off. */
    fun mapAlpha(navFocus: Float): Float =
        if (!drawStreetMap) 0f else MAP_GAUGES_ALPHA + (1f - MAP_GAUGES_ALPHA) * navFocus.coerceIn(0f, 1f)
}

/** @parity /modules/vescape-core/ios/watch/WatchMapSceneState.swift `mapGaugesAlpha` */
internal const val MAP_GAUGES_ALPHA = 0.6f

internal data class WatchMapTarget(val spanM: Float, val courseDeg: Float?, val position: WatchMapPosition?)

internal data class WatchMapNavigation(val bearingDeg: Double, val distanceM: Double)
