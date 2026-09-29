package app.vescape.wear

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

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
 * it in screen space.
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
 * @platform-diff The face edge and in range are the round face's circle here; watchOS uses its
 *   rounded-rectangle display for the edge and its rectangle for range.
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
    /** Pixels per metre. */
    val scale = (minOf(width, height) - edgeInsetPx) / clampRouteSpanM(spanM)

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

    /**
     * Pixels along the unit ray [dirX]/[dirY] from the Rider (not the face centre) to the circle of
     * [radius] about the face centre. The Rider sits inside it, so this is the positive root.
     */
    fun rayToCircle(dirX: Float, dirY: Float, radius: Float): Float {
        val fromX = riderX - centerX
        val fromY = riderY - centerY
        val b = fromX * dirX + fromY * dirY
        val c = fromX * fromX + fromY * fromY - radius * radius
        return -b + sqrt((b * b - c).coerceAtLeast(0f))
    }

    /** Where the ray from the Rider leaves the face, [insetPx] inside its edge. */
    fun edgePoint(dirX: Float, dirY: Float, insetPx: Float): EdgePoint {
        val radius = faceRadius - insetPx
        val reach = rayToCircle(dirX, dirY, radius)
        val x = riderX + dirX * reach
        val y = riderY + dirY * reach
        return EdgePoint(x, y, outX = (x - centerX) / radius, outY = (y - centerY) / radius)
    }

    /**
     * [rider]'s mark: a dot on the map while in range, else a triangle on the face edge along the ray
     * from the Rider, longer the closer they are. A stale Rider's triangle is the shortest.
     */
    fun mark(rider: GroupRideFrameRider, sizes: GroupRideMarkSizes): GroupRideMark {
        val placed = place(rider.eastM, rider.northM, sizes.inRangeMarginPx)
        if (placed.inRange) {
            return GroupRideMark(rider, GroupRideMarkKind.Dot, placed.x, placed.y, placed.dirX, placed.dirY, sizes.dotRadiusPx)
        }
        val edge = edgePoint(placed.dirX, placed.dirY, sizes.edgeInsetPx)
        val length = if (rider.stale) {
            sizes.triangleMinPx
        } else {
            val boundaryM = rayToCircle(placed.dirX, placed.dirY, faceRadius - sizes.inRangeMarginPx) / scale
            edgeTriangleLength(rider.distanceM, boundaryM.toDouble(), sizes.triangleMinPx, sizes.triangleMaxPx)
        }
        return GroupRideMark(rider, GroupRideMarkKind.Triangle, edge.x, edge.y, edge.outX, edge.outY, length)
    }

    /** Every Rider's mark, farthest first, so a close Rider lands on top at a similar bearing. */
    fun marks(riders: List<GroupRideFrameRider>, sizes: GroupRideMarkSizes): List<GroupRideMark> =
        riders.sortedByDescending { it.distanceM }.map { mark(it, sizes) }
}

/**
 * A point on the face edge; [outX]/[outY] is the unit outward normal there.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchEdgePoint`
 */
internal data class EdgePoint(val x: Float, val y: Float, val outX: Float, val outY: Float)

/** @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMarkKind` */
internal enum class GroupRideMarkKind { Dot, Triangle }

/**
 * Where and how one Rider is drawn. A dot centres on [x]/[y] with radius [sizePx], and [outX]/[outY]
 * is the ray from the Rider. A triangle's base centre is [x]/[y] on the face edge, [outX]/[outY] the
 * outward normal, [sizePx] its length: the apex sits at base − out × length.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMark`
 */
internal data class GroupRideMark(
    val rider: GroupRideFrameRider,
    val kind: GroupRideMarkKind,
    val x: Float,
    val y: Float,
    val outX: Float,
    val outY: Float,
    val sizePx: Float,
)

/**
 * The pixel measures [HeadingUpMap.mark] needs.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMarkSizes`
 */
internal data class GroupRideMarkSizes(
    /** Dots stay this far inside the face edge, clear of the rim arcs. */
    val inRangeMarginPx: Float,
    /** Triangle bases sit this far inside the face edge. */
    val edgeInsetPx: Float,
    val dotRadiusPx: Float,
    val triangleMinPx: Float,
    val triangleMaxPx: Float,
)

/**
 * A far Rider's triangle length: [maxPx] right at the in-range [boundaryM] on their ray, [minPx] at
 * [GROUP_FAR_M] or beyond, log-scaled between.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `edgeTriangleLength`
 */
internal fun edgeTriangleLength(distanceM: Double, boundaryM: Double, minPx: Float, maxPx: Float): Float {
    val near = boundaryM.coerceIn(1.0, GROUP_FAR_M - 1.0)
    val t = ln(distanceM.coerceAtLeast(near) / near) / ln(GROUP_FAR_M / near)
    return minPx + (maxPx - minPx) * (1.0 - t).toFloat().coerceIn(0f, 1f)
}

/**
 * Beyond this the triangle stops shrinking.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `GROUP_FAR_M`
 */
private const val GROUP_FAR_M = 3_000.0

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
 * the same spot. Riders beyond the map are [GroupRideEdgeLayer]'s.
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
    val stalePulse = rememberStalePulse(group)
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val map = headingUpMap(group)
        if (drawOwnRing) drawRiderDot(Offset(map.riderX, map.riderY), ownColor)
        val staleAlpha = stalePulse()
        val outline = GROUP_OUTLINE.toPx()
        for (mark in map.marks(group.riders, groupRideMarkSizes(navFocus()))) {
            if (mark.kind != GroupRideMarkKind.Dot) continue
            val center = Offset(mark.x, mark.y)
            val markAlpha = if (mark.rider.stale) staleAlpha else 1f
            drawCircle(GROUP_OUTLINE_COLOR, radius = mark.sizePx + outline, center = center, alpha = markAlpha)
            drawCircle(Color(mark.rider.colorArgb), radius = mark.sizePx, center = center, alpha = markAlpha)
        }
    }
}

/**
 * Every Rider beyond the nav map, as a triangle in their colour on the face edge, apex inward. Drawn
 * over the rim arcs, so the caller layers it above the gauges. Skipped in ambient like the dots.
 */
@Composable
internal fun GroupRideEdgeLayer(alpha: () -> Float) {
    val group = GroupRideState.group.value ?: return
    val stalePulse = rememberStalePulse(group)
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val staleAlpha = stalePulse()
        val outline = GROUP_OUTLINE.toPx()
        for (mark in headingUpMap(group).marks(group.riders, groupRideMarkSizes(navFocus = 0f))) {
            if (mark.kind != GroupRideMarkKind.Triangle) continue
            val color = Color(mark.rider.colorArgb).copy(alpha = if (mark.rider.stale) staleAlpha else 1f)
            drawEdgeTriangle(mark, outline, color)
        }
    }
}

/** The Group Ride's heading-up map on this canvas: the nav route's own projection. */
internal fun DrawScope.headingUpMap(group: WatchGroupRide) =
    HeadingUpMap(size.width, size.height, RIDER_DROP.toPx(), ROUTE_EDGE_INSET.toPx(), group.spanM, group.courseDeg)

/** Mark sizes on this canvas; dots grow towards the nav-focus page, where the map is the page. */
internal fun DrawScope.groupRideMarkSizes(navFocus: Float) = GroupRideMarkSizes(
    inRangeMarginPx = GROUP_IN_RANGE_MARGIN.toPx(),
    edgeInsetPx = GROUP_EDGE_INSET.toPx(),
    dotRadiusPx = GROUP_DOT_R.toPx() + (GROUP_FOCUS_DOT_R - GROUP_DOT_R).toPx() * navFocus.coerceIn(0f, 1f),
    triangleMinPx = GROUP_TRIANGLE_MIN.toPx(),
    triangleMaxPx = GROUP_TRIANGLE_MAX.toPx(),
)

/** Base centred on the edge, apex inward, thin dark outline under the fill so it reads over the arcs. */
private fun DrawScope.drawEdgeTriangle(mark: GroupRideMark, outline: Float, color: Color) {
    val length = mark.sizePx
    val sideX = -mark.outY * length * GROUP_TRIANGLE_BASE / 2f
    val sideY = mark.outX * length * GROUP_TRIANGLE_BASE / 2f
    val path = Path().apply {
        moveTo(mark.x + sideX, mark.y + sideY)
        lineTo(mark.x - sideX, mark.y - sideY)
        lineTo(mark.x - mark.outX * length, mark.y - mark.outY * length)
        close()
    }
    drawPath(path, GROUP_OUTLINE_COLOR.copy(alpha = GROUP_OUTLINE_COLOR.alpha * color.alpha), style = Stroke(width = outline * 2f, join = StrokeJoin.Round))
    drawPath(path, color)
}

/**
 * A stale Rider's opacity, read in the draw scope. It pulses on the frame clock only while [group]
 * has a stale Rider; the caller is not composed in ambient, so ambient never animates. Both layers
 * take their phase from the same frame time, so a stale dot and a stale triangle pulse together.
 */
@Composable
private fun rememberStalePulse(group: WatchGroupRide): () -> Float {
    val frameMs = remember { mutableLongStateOf(0L) }
    val pulsing = group.riders.any { it.stale }
    if (pulsing) {
        LaunchedEffect(Unit) {
            while (true) withFrameMillis { frameMs.longValue = it }
        }
    }
    return remember { { staleAlpha(frameMs.longValue) } }
}

/**
 * Opacity [GROUP_STALE_MAX_ALPHA] → [GROUP_STALE_MIN_ALPHA] and back, [GROUP_STALE_PULSE_MS] each way.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `staleOpacity`
 */
private fun staleAlpha(frameMs: Long): Float {
    val phase = (frameMs % (GROUP_STALE_PULSE_MS * 2)).toFloat() / GROUP_STALE_PULSE_MS
    val t = if (phase <= 1f) phase else 2f - phase
    return GROUP_STALE_MAX_ALPHA + (GROUP_STALE_MIN_ALPHA - GROUP_STALE_MAX_ALPHA) * t
}

/** Dots stay this far inside the face edge, clear of the rim arcs. */
private val GROUP_IN_RANGE_MARGIN = 38.dp
private val GROUP_DOT_R = 3.dp
/** On the nav-focus page, where the map is the page. */
private val GROUP_FOCUS_DOT_R = 4.5.dp
/** Triangle bases sit in the outermost pixels, over the rim arcs. */
private val GROUP_EDGE_INSET = 1.dp
private val GROUP_TRIANGLE_MIN = 7.dp
private val GROUP_TRIANGLE_MAX = 12.dp
/** Triangle base width as a share of its length. */
private const val GROUP_TRIANGLE_BASE = 0.9f
private val GROUP_OUTLINE = 0.75.dp
private val GROUP_OUTLINE_COLOR = Color(0xE6000000)
/** A Rider the phone has not heard from for a while: last known place, faded and pulsing. */
private const val GROUP_STALE_MAX_ALPHA = 0.7f
private const val GROUP_STALE_MIN_ALPHA = 0.2f
private const val GROUP_STALE_PULSE_MS = 700L
