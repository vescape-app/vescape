package app.vescape.wear

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * The joined Group Ride as the wrist knows it: the latest Group Ride Frame, with the Rider's course
 * held across frames that carry none, so a stopped Rider keeps the last heading-up direction.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRide`
 */
internal data class WatchGroupRide(
    /** The Rider's course, degrees clockwise from north; 0 (north-up) until one has ever arrived. */
    val courseDeg: Double,
    val spanM: Double,
    val riders: List<GroupRideFrameRider>,
) {
    /** Where [rider] is relative to the Rider's travel direction: 0 ahead, 90 right, 180 behind. */
    fun bearingDeg(rider: GroupRideFrameRider): Double =
        relativeBearingDeg(rider.eastM, rider.northM, courseDeg)
}

/**
 * Wrist-side Group Ride state. A frame lands here from [MainActivity]; [refresh] drops the group once
 * frames stop, which is also how leaving the ride, the phone losing the wrist and ambient all clear
 * it — the phone simply stops sending.
 */
internal object GroupRideState {
    val group = mutableStateOf<WatchGroupRide?>(null)
    private var lastFrameAtMs: Long? = null

    fun accept(frame: GroupRideFrame, nowMs: Long = SystemClock.elapsedRealtime()) {
        group.value = WatchGroupRide(
            courseDeg = frame.courseDeg ?: group.value?.courseDeg ?: 0.0,
            spanM = frame.spanM,
            riders = frame.riders,
        )
        lastFrameAtMs = nowMs
    }

    fun refresh(nowMs: Long = SystemClock.elapsedRealtime()) {
        val at = lastFrameAtMs ?: return
        if (nowMs - at > GROUP_RIDE_TIMEOUT_MS) {
            group.value = null
            lastFrameAtMs = null
        }
    }
}

/** Three missed 1 Hz frames and the group is gone from the wrist. */
private const val GROUP_RIDE_TIMEOUT_MS = 3_500L

/**
 * One point placed on the heading-up nav map. [dirX]/[dirY] is the unit ray from the Rider towards
 * it in screen space, so a caller drawing something on the face edge (#527) has the ray already.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchMapPlacement`
 */
internal data class MapPlacement(
    val x: Float,
    val y: Float,
    val dirX: Float,
    val dirY: Float,
    /** Inside the face, clear of the rim arcs by the placing caller's margin. */
    val inRange: Boolean,
)

/**
 * The nav route's heading-up projection, in pixels: the Rider sits [RIDER_DROP] below the face
 * centre, their course points up, and [clampRouteSpanM] metres span the face minus
 * [ROUTE_EDGE_INSET]. A Group Ride dot and the route line share this so a Rider on the route is drawn
 * on it.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchMapProjection`
 * @platform-diff In range is the round face's circle here; watchOS uses its rectangular display.
 */
internal class HeadingUpMap(
    width: Float,
    height: Float,
    riderDropPx: Float,
    edgeInsetPx: Float,
    spanM: Double?,
    private val courseDeg: Double,
) {
    val centerX = width / 2f
    val centerY = height / 2f
    val riderX = centerX
    val riderY = centerY + riderDropPx
    val faceRadius = minOf(width, height) / 2f
    private val scale = (minOf(width, height) - edgeInsetPx) / clampRouteSpanM(spanM)

    /** Place a point [eastM]/[northM] metres from the Rider. In range = within the face less [marginPx]. */
    fun place(eastM: Double, northM: Double, marginPx: Float): MapPlacement {
        val rad = Math.toRadians(relativeBearingDeg(eastM, northM, courseDeg))
        val dirX = sin(rad).toFloat()
        val dirY = -cos(rad).toFloat()
        val reach = (hypot(eastM, northM) * scale).toFloat()
        val x = riderX + dirX * reach
        val y = riderY + dirY * reach
        return MapPlacement(x, y, dirX, dirY, inRange = hypot(x - centerX, y - centerY) <= faceRadius - marginPx)
    }
}

/**
 * Bearing of an east/north offset relative to [courseDeg], degrees clockwise in 0..360: 0 straight
 * ahead, 90 right, 180 behind.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `relativeBearingDeg`
 */
internal fun relativeBearingDeg(eastM: Double, northM: Double, courseDeg: Double): Double {
    val absolute = Math.toDegrees(atan2(eastM, northM))
    return ((absolute - courseDeg) % 360.0 + 360.0) % 360.0
}

/**
 * Every other Rider who fits on the nav map, as a dot in their colour, over the route and under the
 * gauges. Without Navigation there is no route to carry the Rider's own ring, so this draws it at
 * the same spot. Riders beyond the map are not drawn here.
 *
 * Read in the draw scope: frames and nav-focus drags repaint without recomposing. The caller skips
 * this in ambient, where the group is hidden.
 */
@Composable
internal fun GroupRideLayer(
    muted: Boolean,
    drawOwnRing: Boolean,
    navFocus: () -> Float,
    alpha: () -> Float,
) {
    val group = GroupRideState.group.value ?: return
    val ownColor = if (muted) DimText else navColor()
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val map = HeadingUpMap(size.width, size.height, RIDER_DROP.toPx(), ROUTE_EDGE_INSET.toPx(), group.spanM, group.courseDeg)
        if (drawOwnRing) drawRiderDot(Offset(map.riderX, map.riderY), ownColor)
        val focus = navFocus().coerceIn(0f, 1f)
        val radius = GROUP_DOT_R.toPx() + (GROUP_FOCUS_DOT_R - GROUP_DOT_R).toPx() * focus
        val outline = GROUP_DOT_OUTLINE.toPx()
        val margin = GROUP_IN_RANGE_MARGIN.toPx()
        // Far first, so a close Rider lands on top at a similar bearing.
        for (rider in group.riders.sortedByDescending { it.distanceM }) {
            val placed = map.place(rider.eastM, rider.northM, margin)
            if (!placed.inRange) continue
            val center = Offset(placed.x, placed.y)
            val dotAlpha = if (rider.stale) GROUP_STALE_ALPHA else 1f
            drawCircle(GROUP_DOT_OUTLINE_COLOR, radius = radius + outline, center = center, alpha = dotAlpha)
            drawCircle(Color(rider.colorArgb), radius = radius, center = center, alpha = dotAlpha)
        }
    }
}

/** Dots stay this far inside the face edge, clear of the rim arcs. */
private val GROUP_IN_RANGE_MARGIN = 38.dp
private val GROUP_DOT_R = 3.dp
/** On the nav-focus page, where the map is the page. */
private val GROUP_FOCUS_DOT_R = 4.5.dp
private val GROUP_DOT_OUTLINE = 0.75.dp
private val GROUP_DOT_OUTLINE_COLOR = Color(0xE6000000)
/** A Rider the phone has not heard from for a while: last known place, faded. */
private const val GROUP_STALE_ALPHA = 0.45f
