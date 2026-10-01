package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.WatchTrailPoint
import kotlin.math.hypot

/** Phone-owned recent path, fading by travelled distance within a quarter of the map span.
 * @parity /watch/watchos/RiderTrail.swift `RiderTrail`
 */
@Composable
internal fun RiderTrail(points: List<WatchTrailPoint>, mapView: WatchMapView, color: Color) {
    val isRound = LocalConfiguration.current.isScreenRound
    Canvas(Modifier.fillMaxSize()) {
        if (points.size < 2) return@Canvas
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        fun point(p: WatchTrailPoint) = Offset(center.x + p.eastM.toFloat() * scale, center.y - p.northM.toFloat() * scale)
        // Fade over nearby travelled metres, not sample count across kilometres of offscreen history.
        val distanceFromTip = DoubleArray(points.size)
        for (i in points.lastIndex - 1 downTo 0) {
            distanceFromTip[i] = distanceFromTip[i + 1] + hypot(
                points[i + 1].eastM - points[i].eastM,
                points[i + 1].northM - points[i].northM,
            )
        }
        val fadeM = minOf(distanceFromTip[0], mapView.spanM * 0.25).coerceAtLeast(1.0)
        fun alpha(i: Int) = (0.85 * (1.0 - distanceFromTip[i] / fadeM).coerceIn(0.0, 1.0)).toFloat()
        val path = Path().apply {
            val first = point(points.first())
            moveTo(first.x, first.y)
            points.drop(1).forEach { p -> point(p).let { lineTo(it.x, it.y) } }
        }
        clipPath(mapFaceClip(isRound)) {
            rotate(-mapView.courseDeg, center) {
                // Suppress an overlapping planned route under the ridden path, including its faded tail.
                drawPath(path, Color.Black, style = Stroke(7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                for (i in 1 until points.size) {
                    if (alpha(i) == 0f || distanceFromTip[i - 1] == distanceFromTip[i]) continue
                    val start = point(points[i - 1])
                    val end = point(points[i])
                    drawLine(
                        brush = Brush.linearGradient(listOf(color.copy(alpha = alpha(i - 1)), color.copy(alpha = alpha(i))), start, end),
                        start = start, end = end, strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round,
                    )
                }
            }
        }
    }
}

/** One position ring, above the paths and other Riders, whether or not Navigation is active.
 * @parity /watch/watchos/RiderTrail.swift `RiderPosition`
 */
@Composable
internal fun RiderPosition(color: Color) {
    Canvas(Modifier.fillMaxSize()) {
        drawRiderDot(WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx()), color)
    }
}
