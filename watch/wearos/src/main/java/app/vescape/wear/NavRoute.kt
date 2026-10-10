package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp

/**
 * Route polyline under the gauges, drawn heading-up with the rider pinned near the watch centre.
 * Sits at the bottom of the frame's layer stack so gauges, readouts and the nav chevron draw over it.
 *
 * One source: the real polyline the phone pushed on [ROUTE_PATH], placed by the frame's rider lanes.
 * Until those arrive, no route line draws. The independent RiderPosition layer keeps the ring visible.
 *
 * @parity /watch/watchos/NavRoute.swift `NavRoute`
 */
@Composable
internal fun NavRoute(frame: WatchFrame, route: WatchRoute?, mapView: WatchMapView, muted: Boolean, navFocus: () -> Float = { 0f }) {
    val color = if (muted) DimText else navColor()
    val east = frame.riderEastM
    val north = frame.riderNorthM

    if (route != null && east != null && north != null) {
        RouteLayer(
            route = route,
            riderEastM = east.toFloat(),
            riderNorthM = north.toFloat(),
            mapView = mapView,
            color = color,
            navFocus = navFocus,
        )
    }
}

/**
 * "You are here": a ring in the route's own colour, punched out to black so whatever passes under
 * it never reads as passing through the rider. Shared with the radar page — the two are the same
 * map seen at different scales, and a rider that looked different on each would say otherwise.
 *
 * @parity /watch/watchos/NavRoute.swift `drawRiderDot`
 */
internal fun DrawScope.drawRiderDot(center: Offset, color: Color) {
    drawCircle(Color.Black, radius = RIDER_DOT_R.toPx(), center = center)
    drawCircle(
        color,
        radius = RIDER_DOT_R.toPx(),
        center = center,
        style = Stroke(width = RIDER_RING_W.toPx()),
    )
}

@Composable
private fun RouteLayer(
    route: WatchRoute,
    riderEastM: Float,
    riderNorthM: Float,
    mapView: WatchMapView,
    color: Color,
    navFocus: () -> Float,
) {
    // A route runs for kilometres and Compose does not clip by default, so without this the line
    // reaches past the frame and draws over whatever page sits next to it. On a round watch the
    // bounds are still square, so it stops inside the gauge ring instead: the line belongs under the
    // gauges, never crossing them out to the bezel.
    val isRound = LocalConfiguration.current.isScreenRound
    Canvas(modifier = Modifier.fillMaxSize()) {
        // Read in the draw scope: the line thickens as the map page takes over, without
        // recomposing anything. Only there — a wider line under the readouts would fight the
        // gauge fills, but on the map it is the whole page and has to survive sunlight.
        val focus = navFocus().coerceIn(0f, 1f)
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        val offset = mapView.positionOffset
        val path = routePath(route, Offset(riderEastM - offset.eastM.toFloat(), riderNorthM - offset.northM.toFloat()), center, scale)
        clipPath(mapFaceClip(isRound)) {
            // Heading-up, taking the shortest turn across the 0°/360° boundary.
            rotate(degrees = -mapView.courseDeg, pivot = center) {
                drawRoute(path, color, focus)
            }
        }
    }
}

/** Route points (metres east/north of the route origin) into screen pixels around the rider. */
private fun routePath(route: WatchRoute, rider: Offset, center: Offset, scale: Float): Path =
    polyline(
        route.points.map { point ->
            Offset(
                center.x + (point.eastM - rider.x) * scale,
                // Screen y grows downward; north is up.
                center.y - (point.northM - rider.y) * scale,
            )
        },
    )

/** One flat stroke: a casing glow under the line only muddied it against the gauge fills. */
private fun DrawScope.drawRoute(path: Path, color: Color, focus: Float) {
    val width = ROUTE_W.toPx() + (ROUTE_FOCUS_W - ROUTE_W).toPx() * focus
    val alpha = ROUTE_ALPHA + (ROUTE_FOCUS_ALPHA - ROUTE_ALPHA) * focus
    drawPath(path, color.copy(alpha = alpha), style = routeStroke(width))
}

private fun polyline(points: List<Offset>): Path = Path().apply {
    moveTo(points[0].x, points[0].y)
    for (index in 1 until points.size) lineTo(points[index].x, points[index].y)
}

private fun routeStroke(width: Float) = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round)

/** Half the widest gauge guide stroke: the route clip stops at the inner side of that line. */
private val GUIDE_HALF_WIDTH = 1.dp
private val ROUTE_W = 2.dp

/** Width and opacity on the map page, where the line is the page and has to read in daylight. */
private val ROUTE_FOCUS_W = 3.5.dp
private const val ROUTE_ALPHA = 0.55f
private const val ROUTE_FOCUS_ALPHA = 0.85f
private val RIDER_DOT_R = 4.dp
/** Same weight as the route line, so the rider reads as part of it rather than an added marker. */
private val RIDER_RING_W = ROUTE_W

/** The map stays inside the rim gauges. Shared by route and ridden trail. */
internal fun DrawScope.mapFaceClip(isRound: Boolean): Path {
    val faceCenter = Offset(size.width / 2f, size.height / 2f)
    // One pixel inside the gauge circle's guide line, so the route stops just short of it.
    val faceRadius = size.minDimension / 2f - GAUGE_RIM_INSET.toPx() - GUIDE_HALF_WIDTH.toPx() - 1f
    val faceClip = Path().apply {
        if (isRound) {
            addOval(Rect(faceCenter, faceRadius))
        } else {
            addRect(Rect(Offset.Zero, size))
        }
    }
    return faceClip
}
