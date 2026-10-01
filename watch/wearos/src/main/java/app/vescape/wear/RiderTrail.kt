package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.WatchTrailPoint

/** Phone-owned recent path, fading toward its oldest fix like the main map.
 * @parity /watch/watchos/RiderTrail.swift `RiderTrail`
 */
@Composable
internal fun RiderTrail(points: List<WatchTrailPoint>, mapView: WatchMapView, color: Color) {
    val isRound = LocalConfiguration.current.isScreenRound
    Canvas(Modifier.fillMaxSize()) {
        val center = WatchMapProjection.riderPoint(size.width, size.height, WatchMapProjection.RIDER_DROP.toPx())
        val scale = WatchMapProjection.pixelsPerMetre(size.width, size.height, WatchMapProjection.ROUTE_EDGE_INSET.toPx(), mapView.spanM)
        fun point(p: WatchTrailPoint) = Offset(center.x + p.eastM.toFloat() * scale, center.y - p.northM.toFloat() * scale)
        clipPath(mapFaceClip(isRound)) {
            rotate(-mapView.courseDeg, center) {
                for (i in 1 until points.size) {
                    drawLine(color, point(points[i - 1]), point(points[i]), strokeWidth = 3.dp.toPx(),
                        cap = StrokeCap.Round, alpha = 0.85f * i / (points.size - 1))
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
