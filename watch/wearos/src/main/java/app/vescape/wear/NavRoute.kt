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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import kotlin.math.hypot

/**
 * @parity /watch/watchos/NavRoute.swift `NavRoute`
 */
@Composable
internal fun NavRoute(frame: WatchFrame, route: WatchRoute?, mapView: WatchMapView, muted: Boolean, navFocus: () -> Float = { 0f }) {
    val color = if (muted) DimText else NavColor
    val east = frame.riderEastM
    val north = frame.riderNorthM

    if (route != null && east != null && north != null) {
        RouteLayer(
            route = route,
            remainingM = frame.navDistanceM,
            riderEastM = east.toFloat(),
            riderNorthM = north.toFloat(),
            mapView = mapView,
            color = color,
            navFocus = navFocus,
        )
    }
}

/**
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
    remainingM: Double?,
    riderEastM: Float,
    riderNorthM: Float,
    mapView: WatchMapView,
    color: Color,
    navFocus: () -> Float,
) {
    val isRound = LocalConfiguration.current.isScreenRound
    val (passed, remaining) = splitRoute(route.points, remainingM)
    Canvas(modifier = Modifier.fillMaxSize()) {
        val focus = navFocus().coerceIn(0f, 1f)
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        val offset = mapView.positionOffset
        val rider = Offset(riderEastM - offset.eastM.toFloat(), riderNorthM - offset.northM.toFloat())
        val alpha = ROUTE_ALPHA + (ROUTE_FOCUS_ALPHA - ROUTE_ALPHA) * focus
        val stroke = routeStroke()
        clipPath(mapFaceClip(isRound)) {
            rotate(degrees = -mapView.courseDeg, pivot = center) {
                if (passed.size > 1) {
                    drawPath(routePath(passed, rider, center, scale), color.copy(alpha = alpha * PASSED_ALPHA), style = stroke)
                }
                if (remaining.size > 1) {
                    drawPath(routePath(remaining, rider, center, scale), color.copy(alpha = alpha), style = stroke)
                }
            }
        }
    }
}

// @parity /watch/watchos/NavRoute.swift `splitRoute`
private fun splitRoute(points: List<RoutePoint>, remainingM: Double?): Pair<List<RoutePoint>, List<RoutePoint>> {
    if (remainingM == null || !remainingM.isFinite()) return emptyList<RoutePoint>() to points
    if (remainingM <= 0) return points to emptyList()
    var distanceM = remainingM
    for (index in points.lastIndex downTo 1) {
        val from = points[index - 1]
        val to = points[index]
        val eastM = to.eastM - from.eastM
        val northM = to.northM - from.northM
        val lengthM = hypot(eastM.toDouble(), northM.toDouble())
        if (distanceM < lengthM) {
            val fraction = (1 - distanceM / lengthM).toFloat()
            val split = RoutePoint(from.eastM + eastM * fraction, from.northM + northM * fraction)
            return (points.subList(0, index) + split) to (listOf(split) + points.subList(index, points.size))
        }
        distanceM -= lengthM
    }
    return emptyList<RoutePoint>() to points
}

private fun routePath(points: List<RoutePoint>, rider: Offset, center: Offset, scale: Float): Path =
    polyline(
        points.map { point ->
            Offset(
                center.x + (point.eastM - rider.x) * scale,
                center.y - (point.northM - rider.y) * scale,
            )
        },
    )

private fun polyline(points: List<Offset>): Path = Path().apply {
    moveTo(points[0].x, points[0].y)
    for (index in 1 until points.size) lineTo(points[index].x, points[index].y)
}

private fun DrawScope.routeStroke() = Stroke(
    width = ROUTE_W.toPx(),
    cap = StrokeCap.Round,
    join = StrokeJoin.Round,
    pathEffect = PathEffect.dashPathEffect(floatArrayOf(0.1.dp.toPx(), 4.3.dp.toPx())),
)

private val GUIDE_HALF_WIDTH = 1.dp
private val ROUTE_W = 2.5.dp

private const val ROUTE_ALPHA = 0.55f
private const val ROUTE_FOCUS_ALPHA = 0.85f
private const val PASSED_ALPHA = 0.2f
private val RIDER_DOT_R = 4.dp
private val RIDER_RING_W = 2.dp

internal fun DrawScope.mapFaceClip(isRound: Boolean): Path {
    val faceCenter = Offset(size.width / 2f, size.height / 2f)
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
