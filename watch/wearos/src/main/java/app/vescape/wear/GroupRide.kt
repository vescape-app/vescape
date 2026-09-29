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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.telemetry.UnitPresentation
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider
import kotlin.math.abs
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

    /** The Group Ride page's rows: every other Rider, nearest first, ties by id so rows never swap. */
    fun roster(): List<GroupRideRow> =
        riders.sortedWith(compareBy({ it.distanceM }, { it.id })).map { rider ->
            GroupRideRow(
                rider = rider,
                name = rider.name.takeCodePoints(GROUP_ROW_NAME_CHARS),
                bearingDeg = bearingDeg(rider),
                status = groupRideStatus(rider),
            )
        }
}

/**
 * One Group Ride page row. [name] is cut to [GROUP_ROW_NAME_CHARS] characters.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideRow`
 */
internal data class GroupRideRow(
    val rider: GroupRideFrameRider,
    val name: String,
    val bearingDeg: Double,
    val status: GroupRideStatus,
)

/**
 * A row's one status slot.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `WatchGroupRideStatus`
 */
internal sealed interface GroupRideStatus {
    /** Stale: the Rider's readings are as old as their place, so none is shown. */
    data object Lost : GroupRideStatus

    /** Running hot, at the heat level: a thermometer. */
    data class Hot(val level: TelemetryLevel) : GroupRideStatus

    /** Battery SoC Estimate, coloured by its level. */
    data class Battery(val percent: Int, val level: TelemetryLevel) : GroupRideStatus

    /** No Board Session: a dash. */
    data object NoBoard : GroupRideStatus
}

/**
 * The status slot, first match wins: lost when stale, thermometer when hot, dash without a Board,
 * else battery %. The phone classified the levels; nothing is thresholded here.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `groupRideStatus`
 */
internal fun groupRideStatus(rider: GroupRideFrameRider): GroupRideStatus {
    val battery = rider.batteryPercent
    return when {
        rider.stale -> GroupRideStatus.Lost
        rider.heatLevel != TelemetryLevel.NORMAL -> GroupRideStatus.Hot(rider.heatLevel)
        battery == null -> GroupRideStatus.NoBoard
        else -> GroupRideStatus.Battery(battery, rider.batteryLevel)
    }
}

/** First [count] Unicode scalars, so a cut never splits a surrogate pair. */
private fun String.takeCodePoints(count: Int): String =
    substring(0, offsetByCodePoints(0, minOf(count, codePointCount(0, length))))

/**
 * A Group Ride page name is cut to this many characters.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `GROUP_ROW_NAME_CHARS`
 */
internal const val GROUP_ROW_NAME_CHARS = 5

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
 * gauges. A flagged Rider's dot wears a thin orange or red ring. Without Navigation there is no
 * route to carry the Rider's own ring, so this draws it at the same spot. In nav focus each live dot
 * gets its distance label. Riders beyond the map are [GroupRideEdgeLayer]'s.
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
    val labels = rememberGroupRideLabels()
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val map = headingUpMap(group)
        if (drawOwnRing) drawRiderDot(Offset(map.riderX, map.riderY), ownColor)
        val staleAlpha = stalePulse()
        val focus = navFocus().coerceIn(0f, 1f)
        val outline = GROUP_OUTLINE.toPx()
        val ringGap = GROUP_RING_GAP.toPx()
        val ringWidth = GROUP_RING_WIDTH.toPx()
        val dots = map.marks(group.riders, groupRideMarkSizes(focus)).filter { it.kind == GroupRideMarkKind.Dot }
        for (mark in dots) {
            val center = Offset(mark.x, mark.y)
            val markAlpha = if (mark.rider.stale) staleAlpha else 1f
            flagColor(mark.rider)?.let { color ->
                val radius = mark.sizePx + ringGap
                drawCircle(GROUP_OUTLINE_COLOR, radius = radius, center = center, style = Stroke(ringWidth + outline * 2f))
                drawCircle(color, radius = radius, center = center, style = Stroke(ringWidth))
            }
            drawCircle(GROUP_OUTLINE_COLOR, radius = mark.sizePx + outline, center = center, alpha = markAlpha)
            drawCircle(Color(mark.rider.colorArgb), radius = mark.sizePx, center = center, alpha = markAlpha)
        }
        // Labels over every dot, so a neighbour's dot never cuts one.
        for (mark in dots) labels.draw(this, map, mark, focus)
    }
}

/**
 * Every Rider beyond the nav map, as a triangle in their colour on the face edge, apex inward. Drawn
 * over the rim arcs, so the caller layers it above the gauges. A triangle is always the Rider's own
 * colour; a flag shows only in its nav-focus label. Skipped in ambient like the dots.
 */
@Composable
internal fun GroupRideEdgeLayer(navFocus: () -> Float, alpha: () -> Float) {
    val group = GroupRideState.group.value ?: return
    val stalePulse = rememberStalePulse(group)
    val labels = rememberGroupRideLabels()
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val staleAlpha = stalePulse()
        val focus = navFocus().coerceIn(0f, 1f)
        val outline = GROUP_OUTLINE.toPx()
        val map = headingUpMap(group)
        val triangles = map.marks(group.riders, groupRideMarkSizes(focus)).filter { it.kind == GroupRideMarkKind.Triangle }
        for (mark in triangles) {
            val color = Color(mark.rider.colorArgb).copy(alpha = if (mark.rider.stale) staleAlpha else 1f)
            drawEdgeTriangle(mark, outline, color)
        }
        for (mark in triangles) labels.draw(this, map, mark, focus)
    }
}

/**
 * A live Rider's flag colour: orange for a warning, red for critical, the worse of battery and heat.
 * Null for a Rider with nothing to flag, and for a stale one — their readings are as old as their
 * place.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `flagColor`
 */
private fun flagColor(rider: GroupRideFrameRider): Color? =
    if (rider.stale) null else levelColor(rider.flagLevel)

internal fun levelColor(level: TelemetryLevel): Color? = when (level) {
    TelemetryLevel.NORMAL -> null
    TelemetryLevel.WARNING -> WarningColor
    TelemetryLevel.CRITICAL -> CriticalColor
}

/**
 * A Rider's compact distance: "680m", "2.1km" in the Rider's units. The wrist's own distance
 * formatting without the space, so the label stays short beside its mark.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `groupRideDistanceLabel`
 */
internal fun groupRideDistanceLabel(distanceM: Double, unitSystem: String): String =
    UnitPresentation.distance(distanceM, unitSystem).replace(" ", "")

/**
 * Top-left of a [width] × [height] label for [mark]: beside a dot on the side away from the Rider,
 * or the other side when that would run off the face, [gapPx] clear of it and of its flag ring when
 * it wears one ([ringPx] further out); inward of a triangle's apex by [gapPx]. Then
 * [clearOfNavReadout].
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `labelOrigin`
 * @platform-diff "Off the face" is the round face's circle here; watchOS uses its display's width.
 */
internal fun HeadingUpMap.labelTopLeft(
    mark: GroupRideMark,
    width: Float,
    height: Float,
    gapPx: Float,
    ringPx: Float,
    navFocus: Float,
    faceWidth: Float,
    faceHeight: Float,
): Offset {
    val (left, top) = when (mark.kind) {
        GroupRideMarkKind.Dot -> {
            val reach = mark.sizePx + (if (flagColor(mark.rider) != null) ringPx else 0f) + gapPx
            val top = mark.y - height / 2f
            val right = mark.x + reach
            val left = mark.x - reach - width
            val (away, toward) = if (mark.x >= riderX) right to left else left to right
            (if (onFace(away, top, width, height)) away else toward) to top
        }
        GroupRideMarkKind.Triangle -> {
            // Inward along the edge normal, far enough that the box's own half-extent clears the apex.
            val inX = -mark.outX
            val inY = -mark.outY
            val extent = minOf(
                if (abs(inX) > 1e-3f) width / 2f / abs(inX) else Float.MAX_VALUE,
                if (abs(inY) > 1e-3f) height / 2f / abs(inY) else Float.MAX_VALUE,
            )
            val reach = mark.sizePx + gapPx + extent
            (mark.x + inX * reach - width / 2f) to (mark.y + inY * reach - height / 2f)
        }
    }
    return Offset(left, clearOfNavReadout(left, top, width, height, navFocus, faceWidth, faceHeight))
}

/** Whether a label box lies wholly inside the round face. */
private fun HeadingUpMap.onFace(left: Float, top: Float, width: Float, height: Float): Boolean {
    val farX = maxOf(abs(left - centerX), abs(left + width - centerX))
    val farY = maxOf(abs(top - centerY), abs(top + height - centerY))
    return hypot(farX, farY) <= faceRadius
}

/**
 * [top] for a label box, slid up until it clears the nav distance readout. The readout drops and
 * grows with [navFocus]; at full focus it spans about x 29–71% and y 82–94% of the face.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `clearOfNavReadout`
 */
internal fun clearOfNavReadout(
    left: Float,
    top: Float,
    width: Float,
    height: Float,
    navFocus: Float,
    faceWidth: Float,
    faceHeight: Float,
): Float {
    val readoutTop = faceHeight * (NAV_READOUT_TOP + NAV_READOUT_FOCUS_DROP * navFocus)
    val overlapsX = left < faceWidth * NAV_READOUT_RIGHT && left + width > faceWidth * NAV_READOUT_LEFT
    val overlapsY = top + height > readoutTop && top < faceHeight * NAV_READOUT_BOTTOM
    return if (overlapsX && overlapsY) readoutTop - height else top
}

/**
 * Nav-focus distance labels, measured and drawn in the draw scope. Grey distance, then a flag: a
 * thermometer when the Rider runs hot, else their battery % when it is low, each in its level's
 * colour. Stale Riders get none; their distance is as old as their place.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `drawGroupRideLabel`
 */
private class GroupRideLabels(private val measurer: TextMeasurer) {
    fun draw(scope: DrawScope, map: HeadingUpMap, mark: GroupRideMark, focus: Float) = with(scope) {
        if (focus <= LABEL_MIN_FOCUS || mark.rider.stale) return@with
        val rider = mark.rider
        val style = WatchTypography.mono(TextStyle(fontSize = GROUP_LABEL_FONT))
        val unitSystem = SettingsState.settings.value.unitSystem
        val distance = measurer.measure(groupRideDistanceLabel(rider.distanceM, unitSystem), style)
        val heatColor = levelColor(rider.heatLevel)
        val batteryColor = levelColor(rider.batteryLevel).takeIf { heatColor == null && rider.batteryPercent != null }
        val battery = batteryColor?.let { measurer.measure("${rider.batteryPercent}%", style) }
        val height = distance.size.height.toFloat()
        val gap = GROUP_LABEL_FLAG_GAP.toPx()
        val flagWidth = when {
            heatColor != null -> gap + height * THERMOMETER_ASPECT
            battery != null -> gap + battery.size.width
            else -> 0f
        }
        val width = distance.size.width + flagWidth
        val at = map.labelTopLeft(
            mark,
            width,
            height,
            gapPx = GROUP_LABEL_GAP.toPx(),
            ringPx = (GROUP_RING_GAP + GROUP_RING_WIDTH).toPx(),
            navFocus = focus,
            faceWidth = size.width,
            faceHeight = size.height,
        )
        drawText(distance, color = SecondaryText, topLeft = at, alpha = focus)
        val flagX = at.x + distance.size.width + gap
        if (heatColor != null) {
            drawThermometer(heatColor.copy(alpha = focus), Offset(flagX, at.y + height * 0.1f), Size(height * THERMOMETER_ASPECT, height * 0.8f))
        } else if (battery != null) {
            drawText(battery, color = batteryColor, topLeft = Offset(flagX, at.y), alpha = focus)
        }
    }
}

@Composable
private fun rememberGroupRideLabels(): GroupRideLabels {
    val measurer = rememberTextMeasurer(cacheSize = GROUP_LABEL_CACHE)
    return remember(measurer) { GroupRideLabels(measurer) }
}

/**
 * Thermometer in [box] at [origin]: stroked stem, filled bulb, a short mercury line up the stem.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `drawThermometer`
 */
internal fun DrawScope.drawThermometer(color: Color, origin: Offset, box: Size) = translate(origin.x, origin.y) {
    val stroke = THERMOMETER_STROKE.toPx()
    val cx = box.width / 2f
    val stemWidth = box.width * 0.28f
    val bulbRadius = box.width * 0.24f
    val bulb = Offset(cx, box.height - bulbRadius - stroke / 2f)
    val stemTop = stroke / 2f
    val stemBottom = bulb.y - bulbRadius * 0.6f
    drawRoundRect(
        color,
        Offset(cx - stemWidth / 2f, stemTop),
        Size(stemWidth, stemBottom - stemTop),
        CornerRadius(stemWidth / 2f),
        style = Stroke(stroke),
    )
    drawCircle(color, radius = bulbRadius, center = bulb)
    drawLine(color, bulb, Offset(cx, stemTop + (stemBottom - stemTop) * 0.35f), strokeWidth = stemWidth * 0.45f)
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
/** A flagged dot's ring: this far outside the dot, this thick. */
private val GROUP_RING_GAP = 2.5.dp
private val GROUP_RING_WIDTH = 1.5.dp
private val GROUP_LABEL_FONT = 9.sp
/** Label clear of its dot, ring or triangle apex. */
private val GROUP_LABEL_GAP = 3.dp
/** Between the distance and its flag. */
private val GROUP_LABEL_FLAG_GAP = 3.dp
/** Labels are not drawn at all until nav focus is under way. */
private const val LABEL_MIN_FOCUS = 0.01f
/** Up to 32 Riders, two strings each, at the frame rate a nav-focus drag runs. */
private const val GROUP_LABEL_CACHE = 64
/** Thermometer width as a share of the label's line height. */
private const val THERMOMETER_ASPECT = 0.5f
private val THERMOMETER_STROKE = 1.3.dp

/**
 * The nav distance readout at full nav focus, as shares of the face: x 29–71%, y 82–94%. Its top
 * rides up by [NAV_READOUT_FOCUS_DROP] before focus, where it sits smaller and higher.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjection.swift `NAV_READOUT_KEEP_OUT`
 */
private const val NAV_READOUT_LEFT = 0.29f
private const val NAV_READOUT_RIGHT = 0.71f
private const val NAV_READOUT_TOP = 0.745f
private const val NAV_READOUT_FOCUS_DROP = 0.075f
private const val NAV_READOUT_BOTTOM = 0.94f
private val GROUP_OUTLINE_COLOR = Color(0xE6000000)
/** A Rider the phone has not heard from for a while: last known place, faded and pulsing. */
private const val GROUP_STALE_MAX_ALPHA = 0.7f
private const val GROUP_STALE_MIN_ALPHA = 0.2f
private const val GROUP_STALE_PULSE_MS = 700L
