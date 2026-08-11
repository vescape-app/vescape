package app.vescape.wear

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
 * Until those arrive — a route pushed but no fix yet — only the rider dot draws, so the wrist never
 * shows a line the rider is not actually on.
 */
@Composable
internal fun NavRoute(frame: WatchFrame, muted: Boolean) {
    val color = if (muted) DimText else NavColor
    val route = RouteState.route.value
    val east = frame.riderEastM
    val north = frame.riderNorthM
    val targetRouteSpanM = (frame.routeSpanM ?: DEFAULT_ROUTE_SPAN_M).toFloat()
        .coerceIn(MIN_ROUTE_SPAN_M, MAX_ROUTE_SPAN_M)
    val routeSpanM by animateFloatAsState(
        targetValue = targetRouteSpanM,
        animationSpec = tween(durationMillis = ROUTE_ZOOM_EASE_MS, easing = FastOutSlowInEasing),
        label = "routeZoom",
    )

    Canvas(modifier = Modifier.fillMaxSize()) {
        // Rider sits below the screen centre so more of the frame is "ahead" than behind.
        val center = Offset(size.width / 2f, size.height / 2f + RIDER_DROP.toPx())

        if (route != null && east != null && north != null) {
            val scale = (size.minDimension - ROUTE_EDGE_INSET.toPx()) / routeSpanM
            val rider = Offset(east.toFloat(), north.toFloat())
            val path = routePath(route, rider, center, scale)
            // Heading-up: rotate the whole map so the current course points at the top of the watch.
            rotate(degrees = -(frame.courseDeg ?: 0.0).toFloat(), pivot = center) {
                drawRoute(path, color)
            }
        }

        // "You are here": filled dot with a halo, at the rider anchor.
        drawCircle(color.copy(alpha = 0.20f), radius = RIDER_DOT_R.toPx() * 2.2f, center = center)
        drawCircle(color, radius = RIDER_DOT_R.toPx(), center = center)
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

/** Casing under the line keeps it readable where it crosses a gauge fill. */
private fun DrawScope.drawRoute(path: Path, color: Color) {
    drawPath(path, color.copy(alpha = 0.16f), style = routeStroke(ROUTE_CASING_W.toPx()))
    drawPath(path, color.copy(alpha = 0.55f), style = routeStroke(ROUTE_W.toPx()))
}

private fun polyline(points: List<Offset>): Path = Path().apply {
    moveTo(points[0].x, points[0].y)
    for (index in 1 until points.size) lineTo(points[index].x, points[index].y)
}

private fun routeStroke(width: Float) = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round)

/** Fallback metres of route across the watch face until the phone publishes its camera span. */
private const val DEFAULT_ROUTE_SPAN_M = 600.0
private const val MIN_ROUTE_SPAN_M = 150f
private const val MAX_ROUTE_SPAN_M = 2_000f
private const val ROUTE_ZOOM_EASE_MS = 350

private val ROUTE_EDGE_INSET = 24.dp
private val ROUTE_W = 2.dp
private val ROUTE_CASING_W = 6.dp
private val RIDER_DOT_R = 2.5.dp
private val RIDER_DROP = 34.dp
