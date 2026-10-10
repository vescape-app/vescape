package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
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
internal fun RiderPosition(color: Color, loading: Boolean) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawRiderDot(WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx()), color)
        }
        if (loading) RiderLoadingHalo(color)
    }
}

/** A separate, small drawing surface keeps the loading animation out of the map and gauges.
 * @parity /watch/watchos/RiderTrail.swift `RiderLoadingHalo`
 */
@Composable
private fun RiderLoadingHalo(color: Color) {
    val rotation = rememberInfiniteTransition(label = "route loading").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(1200, easing = LinearEasing)),
        label = "loading ring rotation",
    )
    Canvas(
        Modifier.offset(y = WatchMapProjection.RIDER_DROP).size(24.dp)
            .graphicsLayer { rotationZ = rotation.value }
            .semantics {
                contentDescription = "Loading route"
                progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
            },
    ) {
        val inset = 1.dp.toPx()
        val diameter = size.width - 2 * inset
        val stroke = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round)
        drawCircle(color.copy(alpha = 0.18f), radius = diameter / 2, style = stroke)
        drawArc(
            color, startAngle = -90f, sweepAngle = 100f, useCenter = false,
            topLeft = Offset(inset, inset), size = Size(diameter, diameter), style = stroke,
        )
    }
}
