package app.vescape.wear

import expo.modules.vescapecore.watch.WatchRouteNotice
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
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
    val scene = WatchMapSceneState(frame, route?.routeId, RouteState.status.value, group, ambient.active, settings.telemetryTrailEnabled)
    val navStackAlpha = { fadeOut(awayFocus()) }
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
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() }) {
                if (scene.hasNavigation) NavRoute(frame, route, mapView, muted, focus)
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = scene.trailAlpha(focus()) }) {
                    RiderTrail(frame.trail, mapView, if (muted) DimText else trailColor())
                }
            }
            if (group != null) GroupRideLayer(group = group, mapView = mapView, navFocus = focus, alpha = navStackAlpha)
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() }) {
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
            // Nav focus with nothing to show would be a blank circle. Say why, but only once the
            // drag is nearly done, so it never flickers under the departing readouts.
            // A joined Group Ride is something to show on the map page: no "no navigation" over it.
            if (scene.showAbsentHint) NavAbsentHint(focus = focus, stackAlpha = navStackAlpha)
        }

        readouts()
        if (scene.drawMap && group != null) {
            GroupRideEdgeLayer(group = group, mapView = mapView, navFocus = focus, alpha = navStackAlpha)
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

/**
 * What the nav focus page shows when the phone is not navigating: a centred, dim two-liner that
 * fades in as the readouts leave. Alpha is read inside the graphics layer so the drag never
 * recomposes.
 *
 * @parity /watch/watchos/NavPointer.swift `NavAbsentHint`
 */
@Composable
private fun NavAbsentHint(focus: () -> Float, stackAlpha: () -> Float) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp)
            .graphicsLayer { alpha = fadeIn(focus()) * stackAlpha() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_ph_map_pin),
            contentDescription = null,
            tint = DimText,
            modifier = Modifier.size(HINT_ICON_SIZE),
        )
        Text(
            text = "No navigation",
            style = MaterialTheme.typography.title3.copy(fontSize = 15.sp),
            color = SecondaryText,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            text = "Set a destination on your phone",
            style = MaterialTheme.typography.caption2.copy(fontSize = HINT_FONT_SIZE),
            color = DimText,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

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

private val HINT_FONT_SIZE = 11.sp
private val HINT_ICON_SIZE = 22.dp

/** The no-nav hint arrives only after the readouts are gone, so the two never overlap. */
private fun fadeIn(focus: Float): Float =
    ((focus - HINT_FADE_ONSET) / (1f - HINT_FADE_ONSET)).coerceIn(0f, 1f)

private const val HINT_FADE_ONSET = 0.6f
