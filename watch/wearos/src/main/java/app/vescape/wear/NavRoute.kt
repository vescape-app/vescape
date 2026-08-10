package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
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
import kotlin.math.cos
import kotlin.math.sin

/**
 * Route polyline under the gauges, drawn heading-up with the rider pinned near the watch centre.
 * Sits at the bottom of the frame's layer stack so gauges, readouts and the nav chevron draw over it.
 *
 * Two sources, in order: the real polyline the phone pushed on [ROUTE_PATH] placed by the frame's
 * rider lanes, or — while nothing has been pushed — a synthesized line from the nav bearing, so the
 * layout still reads on a wrist without a route feed.
 */
@Composable
internal fun NavRoute(frame: WatchFrame, muted: Boolean) {
    val color = if (muted) DimText else NavColor
    val route = RouteState.route.value
    val east = frame.riderEastM
    val north = frame.riderNorthM

    Canvas(modifier = Modifier.fillMaxSize()) {
        // Rider sits below the screen centre so more of the frame is "ahead" than behind.
        val center = Offset(size.width / 2f, size.height / 2f + RIDER_DROP.toPx())

        if (route != null && east != null && north != null) {
            val scale = (size.minDimension - ROUTE_EDGE_INSET.toPx()) / ROUTE_SPAN_M
            val rider = Offset(east.toFloat(), north.toFloat())
            val path = routePath(route, rider, center, scale)
            // Heading-up: rotate the whole map so the current course points at the top of the watch.
            rotate(degrees = -(frame.courseDeg ?: 0.0).toFloat(), pivot = center) {
                drawRoute(path, color)
            }
        } else {
            val reach = size.minDimension * ROUTE_REACH_RATIO
            val bearing = (frame.navBearing ?: 0.0).toFloat()
            val distance = frame.navDistanceM ?: 0.0
            drawRoute(polyline(synthesizeRoute(center, reach, bearing, distance, ROUTE_SEGMENTS)), color)
            drawRoute(
                polyline(synthesizeRoute(center, reach, bearing + 180f, -distance, TRAIL_SEGMENTS)),
                color,
                alphaScale = TRAIL_ALPHA_SCALE,
            )
        }

        // "You are here": filled dot with a halo, at the rider anchor whatever drew the line.
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
private fun DrawScope.drawRoute(path: Path, color: Color, alphaScale: Float = 1f) {
    drawPath(path, color.copy(alpha = 0.16f * alphaScale), style = routeStroke(ROUTE_CASING_W.toPx()))
    drawPath(path, color.copy(alpha = 0.55f * alphaScale), style = routeStroke(ROUTE_W.toPx()))
}

/**
 * Fallback shape for a wrist with no pushed route: the first segment leaves the rider along
 * [bearingDeg] and the rest wanders deterministically off it, so the line moves coherently as the
 * bearing turns. Scaled to run [reach] pixels, which is past the rim on purpose.
 */
private fun synthesizeRoute(
    center: Offset,
    reach: Float,
    bearingDeg: Float,
    distanceM: Double,
    segments: Int,
): List<Offset> {
    val step = reach / segments
    val points = ArrayList<Offset>(segments + 1)
    var at = center
    var heading = bearingDeg - 90f // canvas degrees: 0 = 3 o'clock
    points.add(at)
    for (index in 0 until segments) {
        // Distance seeds the wander so the same bearing does not always draw the same squiggle.
        val phase = index * 0.9f + (distanceM / 400.0).toFloat()
        heading += ROUTE_WANDER_DEG * sin(phase)
        val rad = Math.toRadians(heading.toDouble())
        at = Offset(at.x + (step * cos(rad)).toFloat(), at.y + (step * sin(rad)).toFloat())
        points.add(at)
    }
    return points
}

private fun polyline(points: List<Offset>): Path = Path().apply {
    moveTo(points[0].x, points[0].y)
    for (index in 1 until points.size) lineTo(points[index].x, points[index].y)
}

private fun routeStroke(width: Float) = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round)

/** Metres of route across the watch face — the fixed zoom the wrist draws a real route at. */
private const val ROUTE_SPAN_M = 600f

private const val ROUTE_SEGMENTS = 14
private const val TRAIL_SEGMENTS = 14
private const val TRAIL_ALPHA_SCALE = 0.4f
private const val ROUTE_REACH_RATIO = 0.95f
private const val ROUTE_WANDER_DEG = 11f
private val ROUTE_EDGE_INSET = 24.dp
private val ROUTE_W = 2.dp
private val ROUTE_CASING_W = 6.dp
private val RIDER_DOT_R = 2.5.dp
private val RIDER_DROP = 34.dp
