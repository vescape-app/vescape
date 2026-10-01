package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.WatchTrailPoint
import kotlin.math.hypot

/** Phone-owned recent path: the phone map's 3 dp stroke, transparent-to-60% full-path gradient.
 * @platform-diff Watch trail peaks at 60% opacity to distinguish it from the route; phone uses 85%.
 * @parity /src/screens/main/map/LiveMapLayers.tsx
 * @parity /src/modules/map/constants/mapStyles.ts
 * @parity /watch/watchos/RiderTrail.swift `RiderTrail`
 */
@Composable
internal fun RiderTrail(points: List<WatchTrailPoint>, mapView: WatchMapView, color: Color) {
    val isRound = LocalConfiguration.current.isScreenRound
    val layerPaint = remember { Paint() }
    Canvas(Modifier.fillMaxSize()) {
        val points = movingTrail(points, mapView.positionOffset)
        if (points.size < 2) return@Canvas
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        fun point(p: WatchTrailPoint) = Offset(center.x + p.eastM.toFloat() * scale, center.y - p.northM.toFloat() * scale)
        // Use the phone map's full-path gradient, with a fainter watch default to separate it from the route.
        val distanceFromTip = DoubleArray(points.size)
        for (i in points.lastIndex - 1 downTo 0) {
            distanceFromTip[i] = distanceFromTip[i + 1] + hypot(
                points[i + 1].eastM - points[i].eastM,
                points[i + 1].northM - points[i].northM,
            )
        }
        val fadeM = distanceFromTip[0].coerceAtLeast(1e-6)
        fun alpha(i: Int) = (0.60 * (1.0 - distanceFromTip[i] / fadeM).coerceIn(0.0, 1.0)).toFloat()
        // Isolate the trail, then replace overlapping cap pixels. Source-over would compound their
        // alpha into bright beads; copying directly onto the map would erase the route beneath it.
        drawContext.canvas.saveLayer(Rect(Offset.Zero, size), layerPaint)
        clipPath(mapFaceClip(isRound)) {
            rotate(-mapView.courseDeg, center) {
                for (i in 1 until points.size) {
                    if (alpha(i) == 0f || distanceFromTip[i - 1] == distanceFromTip[i]) continue
                    val start = point(points[i - 1])
                    val end = point(points[i])
                    drawLine(
                        brush = Brush.linearGradient(listOf(color.copy(alpha = alpha(i - 1)), color.copy(alpha = alpha(i))), start, end),
                        start = start, end = end, strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round,
                        blendMode = BlendMode.Src,
                    )
                }
            }
        }
        drawContext.canvas.restore()
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
