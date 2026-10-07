package app.vescape.wear

import expo.modules.vescapecore.watch.WatchRouteNotice
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.roundToInt

/**
 * Owns the map's policy, shared camera and drawing order. The telemetry shell supplies gauge and
 * readout slots, without knowing whether Navigation, Group Ride or the rider's trail drives the map.
 * Pager progress stays in draw/layer lambdas; an animated map does not recompose the gauges.
 *
 * @parity /watch/watchos/WatchMapScene.swift `WatchMapScene`
 */
@Composable
internal fun WatchMapScene(
    frame: WatchFrame,
    muted: Boolean,
    ambient: AmbientMode,
    focus: () -> Float,
    awayFocus: () -> Float,
    readoutFocus: () -> Float,
    gauges: @Composable BoxScope.() -> Unit,
    readouts: @Composable BoxScope.() -> Unit,
) {
    val group = GroupRideState.group.value
    val route = RouteState.route.value
    val settings = SettingsState.settings.value
    val scene = WatchMapSceneState(frame, route?.routeId, RouteState.status.value, group, ambient.active,
        settings.telemetryTrailEnabled, settings.telemetryGroupEnabled, settings.telemetryRouteEnabled, settings.streetMapEnabled, settings.mapGaugesPercent)
    val navStackAlpha = { fadeOut(awayFocus()) }
    val groupAlpha = { navStackAlpha() * scene.groupAlpha(focus()) }
    val loading by remember(scene.notice, awayFocus) {
        derivedStateOf { scene.notice != null && scene.notice != WatchRouteNotice.FAILED && navStackAlpha() > 0f }
    }
    val navigation = scene.navigation
    val tiltColor = ambient.readout(if (muted) DimText else TiltColor)
    val offset = ambient.burnInOffset()
    val mapView = rememberWatchMapView(
        targetSpanM = scene.target.spanM,
        targetCourseDeg = scene.target.courseDeg,
        animate = scene.drawMap,
        position = scene.target.position,
    )
    Box(Modifier.fillMaxSize()) {
        if (scene.drawMap) {
            // Layer order: street map, trail and route, Group Ride marks, gauges.
            if (scene.drawStreetMap) {
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() * scene.mapAlpha(focus()) }) {
                    MapTileLayer(mapView)
                }
            }
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() }) {
                if (scene.hasNavigation) {
                    Box(Modifier.fillMaxSize().graphicsLayer { alpha = scene.routeAlpha(focus()) }) {
                        NavRoute(frame, route, mapView, muted, focus)
                    }
                }
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = scene.trailAlpha(focus()) }) {
                    RiderTrail(frame.trail, mapView, if (muted) DimText else trailColor())
                }
            }
            if (group != null) GroupRideLayer(group = group, mapView = mapView, navFocus = focus, alpha = groupAlpha)
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() * scene.riderAlpha(focus()) }) {
                RiderPosition(if (muted) DimText else navColor(), loading = loading)
            }
        }
        gauges()
        // Navigation, only while the phone is sending it: chevron on the rim + distance above the
        // battery %. No destination means no nav lanes, and the frame renders exactly as before.
        if (scene.notice != null) {
            if (!ambient.active && scene.notice == WatchRouteNotice.FAILED) RouteFailureNotice(navStackAlpha)
        } else if (navigation != null) {
            NavPointer(
                bearingDeg = navigation.bearingDeg,
                distanceM = navigation.distanceM,
                muted = muted || ambient.active,
                focus = focus,
                stackAlpha = navStackAlpha,
                trailing = { TiltBadge(frame.remoteTilt, tiltColor, Modifier.padding(start = TILT_BADGE_GAP)) },
            )
        } else {
            // No navigation: the badge keeps the distance's slot to itself.
            TiltBadge(
                frame.remoteTilt,
                tiltColor,
                Modifier
                    .align(Alignment.BottomCenter)
                    .offset(offset.x, offset.y)
                    .padding(bottom = NAV_READOUT_BOTTOM_PAD)
                    .graphicsLayer { alpha = fadeOut(readoutFocus()) },
            )
        }

        readouts()
        if (scene.drawMap && group != null) {
            GroupRideEdgeLayer(group = group, mapView = mapView, navFocus = focus, alpha = groupAlpha)
        }
    }
}

/**
 * A locked Remote Tilt, on the navigation distance's line. A lock outlives the Tilt page on purpose,
 * so the gauges are where a rider needs reminding that the board is still being tilted. Nothing at
 * neutral.
 */
@Composable
private fun TiltBadge(value: Int?, color: Color, modifier: Modifier = Modifier) {
    val percent = value?.let(::tiltPercent) ?: return
    if (percent.roundToInt() == 0) return
    Text(
        text = "\u2220${formatTilt(percent)}",
        style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = NAV_READOUT_FONT_SIZE)),
        color = color,
        modifier = modifier,
    )
}

private val TILT_BADGE_GAP = 10.dp

/** Loading lives around the rider; only an actionable failure needs visible text.
 * @parity /watch/watchos/NavPointer.swift `RouteFailureNotice`
 */
@Composable
private fun RouteFailureNotice(stackAlpha: () -> Float) {
    Box(
        modifier = Modifier.fillMaxSize().graphicsLayer { alpha = stackAlpha() },
        contentAlignment = Alignment.Center,
    ) {
        Text("Route unavailable", color = PrimaryText, style = MaterialTheme.typography.caption2)
    }
}
