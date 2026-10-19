package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapGauges
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
    private val telemetryGroupEnabled: Boolean,
    private val telemetryRouteEnabled: Boolean,
    streetMapEnabled: Boolean,
    /** The rider's Map behind gauges percent, already snapped by [WatchMapGauges.percent]. */
    mapGaugesPercent: Int,
) {
    val navigation = if (frame.navBearing != null && frame.navDistanceM != null && routeStatus?.canDraw(routeId) != false)
        WatchMapNavigation(frame.navBearing, frame.navDistanceM) else null
    val hasNavigation: Boolean get() = navigation != null
    val notice = routeStatus?.notice(routeId, frame.navBearing != null && frame.navDistanceM != null && frame.riderEastM != null && frame.riderNorthM != null)
    val drawMap = !ambient
    /** The rider can turn the street map off; the route, trail and marks stay. */
    val drawStreetMap = drawMap && streetMapEnabled
    val target = WatchMapTarget(
        spanM = WatchMapSpan.clamp(if (!hasNavigation && group != null) group.spanM else frame.routeSpanM),
        courseDeg = (if (!hasNavigation && group != null) group.courseDeg else frame.courseDeg)?.toFloat(),
        position = frame.mapPosition,
    )

    fun trailAlpha(navFocus: Float): Float = layerAlpha(telemetryTrailEnabled, navFocus)

    /** Group Ride dots and edge triangles: full on the telemetry screen, else they fade in with nav focus. */
    fun groupAlpha(navFocus: Float): Float = layerAlpha(telemetryGroupEnabled, navFocus)

    /** Navigation route line: full on the telemetry screen, else it fades in with nav focus. The chevron and distance stay. */
    fun routeAlpha(navFocus: Float): Float = layerAlpha(telemetryRouteEnabled, navFocus)

    private val mapGaugesAlpha = mapGaugesPercent / 100f

    /**
     * The rider circle stays on the telemetry screen while any map layer there has something around
     * it. With trail, Group Ride, route line and map behind gauges all off, the gauges are clean and the circle
     * fades in with nav focus. The map page always shows it.
     */
    fun riderAlpha(navFocus: Float): Float =
        layerAlpha(telemetryTrailEnabled || telemetryGroupEnabled || telemetryRouteEnabled || (drawStreetMap && mapGaugesAlpha > 0f), navFocus)

    private fun layerAlpha(onTelemetry: Boolean, navFocus: Float): Float = when {
        !drawMap -> 0f
        onTelemetry -> 1f
        else -> navFocus.coerceIn(0f, 1f)
    }

    /** Street map: the rider's Map behind gauges opacity behind the gauges, full on the map page, absent in ambient or when off. */
    fun mapAlpha(navFocus: Float): Float =
        if (!drawStreetMap) 0f else mapGaugesAlpha + (1f - mapGaugesAlpha) * navFocus.coerceIn(0f, 1f)
}

internal data class WatchMapTarget(val spanM: Float, val courseDeg: Float?, val position: WatchMapPosition?)

internal data class WatchMapNavigation(val bearingDeg: Double, val distanceM: Double)
