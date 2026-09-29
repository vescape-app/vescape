package app.vescape.wear

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import expo.modules.vescapecore.watch.GroupRideFrameRider
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * One point placed on the heading-up nav map. [dirX]/[dirY] is the unit ray from the Rider towards
 * it in screen space.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchMapPlacement`
 */
internal data class WatchMapPlacement(
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
internal class WatchMapProjection(
    width: Float,
    height: Float,
    riderDropPx: Float,
    edgeInsetPx: Float,
    spanM: Double?,
    private val courseDeg: Double,
) {
    companion object {
        /**
         * The Rider sits this far below the face centre, so more of the map is ahead than behind.
         *
         * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `riderDrop`
         */
        val RIDER_DROP = 34.dp

        /**
         * Face margin the map's span is fitted inside. Shared by every heading-up map layer.
         *
         * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `edgeInset`
         */
        val ROUTE_EDGE_INSET = 24.dp

        /**
         * Fallback metres of route across the watch face until the phone publishes its camera span.
         *
         * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `defaultSpanM`
         */
        private const val DEFAULT_ROUTE_SPAN_M = 600.0
        private const val MIN_ROUTE_SPAN_M = 150f
        private const val MAX_ROUTE_SPAN_M = 2_000f

        /**
         * Metres of world across the watch face for a phone map span: the phone's own, clamped to
         * what a wrist can draw, or the fallback until the phone has published one. Every heading-up
         * map layer (route, Group Ride) takes its zoom from here.
         *
         * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `clampedSpanM`
         */
        fun clampRouteSpanM(spanM: Double?): Float =
            (spanM ?: DEFAULT_ROUTE_SPAN_M).toFloat().coerceIn(MIN_ROUTE_SPAN_M, MAX_ROUTE_SPAN_M)
    }

    val centerX = width / 2f
    val centerY = height / 2f
    val riderX = centerX
    val riderY = centerY + riderDropPx
    val faceRadius = minOf(width, height) / 2f
    /** Pixels per metre. */
    val scale = (minOf(width, height) - edgeInsetPx) / clampRouteSpanM(spanM)

    /** Place a point [eastM]/[northM] metres from the Rider. In range = within the face less [marginPx]. */
    fun place(eastM: Double, northM: Double, marginPx: Float): WatchMapPlacement {
        val rad = Math.toRadians(relativeBearingDeg(eastM, northM, courseDeg))
        val dirX = sin(rad).toFloat()
        val dirY = -cos(rad).toFloat()
        val reach = (hypot(eastM, northM) * scale).toFloat()
        val x = riderX + dirX * reach
        val y = riderY + dirY * reach
        return WatchMapPlacement(x, y, dirX, dirY, inRange = hypot(x - centerX, y - centerY) <= faceRadius - marginPx)
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
    fun edgePoint(dirX: Float, dirY: Float, insetPx: Float): WatchEdgePoint {
        val radius = faceRadius - insetPx
        val reach = rayToCircle(dirX, dirY, radius)
        val x = riderX + dirX * reach
        val y = riderY + dirY * reach
        return WatchEdgePoint(x, y, outX = (x - centerX) / radius, outY = (y - centerY) / radius)
    }

    /**
     * [rider]'s mark: a dot on the map while in range, else a triangle on the face edge along the ray
     * from the Rider, longer the closer they are. A stale Rider's triangle is the shortest.
     */
    fun mark(rider: GroupRideFrameRider, sizes: WatchGroupRideMarkSizes): WatchGroupRideMark {
        val placed = place(rider.eastM, rider.northM, sizes.inRangeMarginPx)
        if (placed.inRange) {
            return WatchGroupRideMark(rider, WatchGroupRideMarkKind.Dot, placed.x, placed.y, placed.dirX, placed.dirY, sizes.dotRadiusPx)
        }
        val edge = edgePoint(placed.dirX, placed.dirY, sizes.edgeInsetPx)
        val length = if (rider.stale) {
            sizes.triangleMinPx
        } else {
            val boundaryM = rayToCircle(placed.dirX, placed.dirY, faceRadius - sizes.inRangeMarginPx) / scale
            edgeTriangleLength(rider.distanceM, boundaryM.toDouble(), sizes.triangleMinPx, sizes.triangleMaxPx)
        }
        return WatchGroupRideMark(rider, WatchGroupRideMarkKind.Triangle, edge.x, edge.y, edge.outX, edge.outY, length)
    }

    /** Every Rider's mark, farthest first, so a close Rider lands on top at a similar bearing. */
    fun marks(riders: List<GroupRideFrameRider>, sizes: WatchGroupRideMarkSizes): List<WatchGroupRideMark> =
        riders.sortedByDescending { it.distanceM }.map { mark(it, sizes) }
}

/**
 * A point on the face edge; [outX]/[outY] is the unit outward normal there.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchEdgePoint`
 */
internal data class WatchEdgePoint(val x: Float, val y: Float, val outX: Float, val outY: Float)

/** @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMarkKind` */
internal enum class WatchGroupRideMarkKind { Dot, Triangle }

/**
 * Where and how one Rider is drawn. A dot centres on [x]/[y] with radius [sizePx], and [outX]/[outY]
 * is the ray from the Rider. A triangle's base centre is [x]/[y] on the face edge, [outX]/[outY] the
 * outward normal, [sizePx] its length: the apex sits at base − out × length.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMark`
 */
internal data class WatchGroupRideMark(
    val rider: GroupRideFrameRider,
    val kind: WatchGroupRideMarkKind,
    val x: Float,
    val y: Float,
    val outX: Float,
    val outY: Float,
    val sizePx: Float,
)

/**
 * The pixel measures [WatchMapProjection.mark] needs.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideMarkSizes`
 */
internal data class WatchGroupRideMarkSizes(
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
 * Every nav-focus label's top-left, aligned with [marks]: [labels] holds each mark's label size, or
 * null for a mark without one. Nearest Rider first, so the closest keep their natural spot. Each
 * label tries, in order: beside a dot on the side away from the Rider, then toward it (both on the
 * face), or inward of a triangle's apex; each of those slid up off the nav readout; then nudged by
 * [LABEL_NUDGE_STEPS] label heights — up or down beside a dot, either way along the edge beside a
 * triangle. The first spot [gapPx] clear of the nav readout and clear of every label already placed
 * and every other mark wins. None clear, and the label is dropped (null): its mark stays, and the
 * Group Ride page has the details. A label never sits more than one label height from its natural
 * spot.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `placeLabels`
 * @platform-diff "On the face" is the round face's circle here; watchOS uses its display's rectangle.
 */
internal fun WatchMapProjection.placeLabels(
    marks: List<WatchGroupRideMark>,
    labels: List<Size?>,
    gapPx: Float,
    navFocus: Float,
    faceWidth: Float,
    faceHeight: Float,
): List<Offset?> {
    // [gapPx] clear of the readout too, so a label never reads as part of it.
    val readout = navReadoutBounds(navFocus, faceWidth, faceHeight).inflate(gapPx)
    val obstacles = marks.map { it.bounds() }
    val placed = arrayOfNulls<Rect>(marks.size)
    val order = marks.indices.filter { labels[it] != null }
        .sortedWith(compareBy({ marks[it].rider.distanceM }, { marks[it].rider.id }))
    for (i in order) {
        val size = labels[i] ?: continue
        placed[i] = labelSpots(marks[i], size, gapPx, readout)
            .map { Rect(it, size) }
            .firstOrNull { box ->
                !box.overlaps(readout) &&
                    placed.none { it != null && it.overlaps(box) } &&
                    obstacles.indices.none { it != i && obstacles[it].overlaps(box) }
            }
    }
    return placed.map { it?.topLeft }
}

/** [placeLabels]'s candidate top-lefts for one label, most natural first. */
private fun WatchMapProjection.labelSpots(
    mark: WatchGroupRideMark,
    size: Size,
    gapPx: Float,
    readout: Rect,
): Sequence<Offset> = sequence {
    val (width, height) = size
    val bases: List<Offset>
    val nudge: Offset
    when (mark.kind) {
        WatchGroupRideMarkKind.Dot -> {
            val reach = mark.sizePx + gapPx
            val top = mark.y - height / 2f
            val right = Offset(mark.x + reach, top)
            val left = Offset(mark.x - reach - width, top)
            bases = (if (mark.x >= riderX) listOf(right, left) else listOf(left, right))
                .filter { onFace(Rect(it, size)) }
            nudge = Offset(0f, -1f)
        }
        WatchGroupRideMarkKind.Triangle -> {
            // Inward along the edge normal, far enough that the box's own half-extent clears the apex.
            val inX = -mark.outX
            val inY = -mark.outY
            val extent = minOf(
                if (abs(inX) > 1e-3f) width / 2f / abs(inX) else Float.MAX_VALUE,
                if (abs(inY) > 1e-3f) height / 2f / abs(inY) else Float.MAX_VALUE,
            )
            val reach = mark.sizePx + gapPx + extent
            bases = listOf(Offset(mark.x + inX * reach - width / 2f, mark.y + inY * reach - height / 2f))
            nudge = Offset(-mark.outY, mark.outX)
        }
    }
    for (base in bases) {
        yield(base)
        // Up until clear of the readout, but no further than a nudge would go.
        if (Rect(base, size).overlaps(readout) && base.y + height - readout.top <= height * LABEL_NUDGE_STEPS.last()) {
            yield(Offset(base.x, readout.top - height))
        }
    }
    for (base in bases) for (step in LABEL_NUDGE_STEPS) for (sign in NUDGE_SIGNS) {
        yield(base + nudge * (step * height * sign))
    }
}

/**
 * A mark's footprint for [placeLabels]: a dot's circle, or a box around a triangle, centred between
 * base and apex and wide enough for the base at any angle.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `bounds`
 */
private fun WatchGroupRideMark.bounds(): Rect = when (kind) {
    WatchGroupRideMarkKind.Dot -> Rect(Offset(x, y), sizePx)
    // Centred between base and apex; wide enough for the base at any angle on the rim.
    WatchGroupRideMarkKind.Triangle -> Rect(Offset(x - outX * sizePx / 2f, y - outY * sizePx / 2f), sizePx * TRIANGLE_FOOTPRINT)
}

/** Whether a label box lies wholly inside the round face. */
private fun WatchMapProjection.onFace(box: Rect): Boolean {
    val farX = maxOf(abs(box.left - centerX), abs(box.right - centerX))
    val farY = maxOf(abs(box.top - centerY), abs(box.bottom - centerY))
    return hypot(farX, farY) <= faceRadius
}

/**
 * The nav distance readout's keep-out box. It drops and grows with [navFocus]; at full focus it spans
 * about x 29–71% and y 82–94% of the face.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `navReadoutBounds`
 */
internal fun navReadoutBounds(navFocus: Float, faceWidth: Float, faceHeight: Float) = Rect(
    left = faceWidth * NAV_READOUT_LEFT,
    top = faceHeight * (NAV_READOUT_TOP + NAV_READOUT_FOCUS_DROP * navFocus),
    right = faceWidth * NAV_READOUT_RIGHT,
    bottom = faceHeight * NAV_READOUT_BOTTOM,
)

/**
 * A crowded label's nudges, in label heights; the last is the farthest a label strays from its mark.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `LABEL_NUDGE_STEPS`
 */
private val LABEL_NUDGE_STEPS = floatArrayOf(0.5f, 1f)
/** Up first beside a dot (the readout is below); either way along the edge beside a triangle. */
private val NUDGE_SIGNS = floatArrayOf(1f, -1f)
/**
 * A triangle's footprint half-size as a share of its length.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `TRIANGLE_FOOTPRINT`
 */
private const val TRIANGLE_FOOTPRINT = 0.6f

/**
 * The nav distance readout at full nav focus, as shares of the face: x 29–71%, y 82–94%. Its top
 * rides up by [NAV_READOUT_FOCUS_DROP] before focus, where it sits smaller and higher.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `NAV_READOUT_KEEP_OUT`
 * @platform-diff watchOS keeps out x 25–75%: its readout takes more of the narrow 40 mm display.
 */
private const val NAV_READOUT_LEFT = 0.29f
private const val NAV_READOUT_RIGHT = 0.71f
private const val NAV_READOUT_TOP = 0.745f
private const val NAV_READOUT_FOCUS_DROP = 0.075f
private const val NAV_READOUT_BOTTOM = 0.94f
