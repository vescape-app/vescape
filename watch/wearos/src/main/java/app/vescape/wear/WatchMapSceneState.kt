package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapGauges
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchMapSpan
import expo.modules.vescapecore.watch.WatchRouteStatus

/**
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
    mapGaugesPercent: Int,
) {
    val navigation = if (frame.navBearingDeg != null && frame.navDistanceM != null && routeStatus?.canDraw(routeId) != false)
        WatchMapNavigation(frame.navBearingDeg, frame.navDistanceM) else null
    val hasNavigation: Boolean get() = navigation != null
    val notice = routeStatus?.notice(routeId, frame.navBearingDeg != null && frame.navDistanceM != null && frame.riderEastM != null && frame.riderNorthM != null)
    val drawMap = !ambient
    val drawStreetMap = drawMap && streetMapEnabled
    val target = WatchMapTarget(
        spanM = WatchMapSpan.clamp(if (!hasNavigation && group != null) group.spanM else frame.routeSpanM),
        courseDeg = (if (!hasNavigation && group != null) group.courseDeg else frame.courseDeg)?.toFloat(),
        position = frame.mapPosition,
    )

    fun trailAlpha(navFocus: Float): Float = layerAlpha(telemetryTrailEnabled, navFocus)

    fun groupAlpha(navFocus: Float): Float = layerAlpha(telemetryGroupEnabled, navFocus)

    fun routeAlpha(navFocus: Float): Float = layerAlpha(telemetryRouteEnabled, navFocus)

    private val mapGaugesAlpha = mapGaugesPercent / 100f

    fun riderAlpha(navFocus: Float): Float =
        layerAlpha(telemetryTrailEnabled || telemetryGroupEnabled || telemetryRouteEnabled || (drawStreetMap && mapGaugesAlpha > 0f), navFocus)

    private fun layerAlpha(onTelemetry: Boolean, navFocus: Float): Float = when {
        !drawMap -> 0f
        onTelemetry -> 1f
        else -> navFocus.coerceIn(0f, 1f)
    }

    fun mapAlpha(navFocus: Float): Float =
        if (!drawStreetMap) 0f else mapGaugesAlpha + (1f - mapGaugesAlpha) * navFocus.coerceIn(0f, 1f)
}

internal data class WatchMapTarget(val spanM: Float, val courseDeg: Float?, val position: WatchMapPosition?)

internal data class WatchMapNavigation(val bearingDeg: Double, val distanceM: Double)
