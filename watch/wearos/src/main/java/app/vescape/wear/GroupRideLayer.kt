package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.vescapecore.watch.GroupRideFrameRider

/**
 * Every other Rider who fits on the nav map, as a dot in their colour, over the route and under the
 * gauges. The Rider's own ring is a separate layer above these marks. In nav focus each live dot
 * gets its distance label, which carries any flag. Riders beyond the map are [GroupRideEdgeLayer]'s.
 *
 * Read in the draw scope: frames and nav-focus drags repaint without recomposing. The caller skips
 * this in ambient, where the group is hidden.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `GroupRideLayer`
 */
@Composable
internal fun GroupRideLayer(
    group: WatchGroupRide,
    mapView: WatchMapView,
    navFocus: () -> Float,
    alpha: () -> Float,
) {
    val stalePulse = rememberStalePulse(group)
    val labels = rememberGroupRideLabels()
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val map = watchMapProjection(mapView)
        val staleAlpha = stalePulse()
        val focus = navFocus().coerceIn(0f, 1f)
        val outline = GROUP_OUTLINE.toPx()
        val marks = map.marks(group.riders, groupRideMarkSizes(focus))
        for (mark in marks) {
            if (mark.kind != WatchGroupRideMarkKind.Dot) continue
            val center = Offset(mark.x, mark.y)
            val markAlpha = if (mark.rider.stale) staleAlpha else 1f
            drawCircle(GROUP_OUTLINE_COLOR, radius = mark.sizePx + outline, center = center, alpha = markAlpha)
            drawCircle(Color(mark.rider.colorArgb), radius = mark.sizePx, center = center, alpha = markAlpha)
        }
        // Labels over every dot, so a neighbour's dot never cuts one.
        labels.draw(this, map, marks, WatchGroupRideMarkKind.Dot, focus)
    }
}

/**
 * Every Rider beyond the nav map, as a triangle in their colour on the face edge, apex inward. Drawn
 * over the rim arcs, so the caller layers it above the gauges. A triangle is always the Rider's own
 * colour; a flag shows only in its nav-focus label. Skipped in ambient like the dots.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `GroupRideEdgeLayer`
 */
@Composable
internal fun GroupRideEdgeLayer(group: WatchGroupRide, mapView: WatchMapView, navFocus: () -> Float, alpha: () -> Float) {
    val stalePulse = rememberStalePulse(group)
    val labels = rememberGroupRideLabels()
    Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha() }) {
        val staleAlpha = stalePulse()
        val focus = navFocus().coerceIn(0f, 1f)
        val outline = GROUP_OUTLINE.toPx()
        val map = watchMapProjection(mapView)
        val marks = map.marks(group.riders, groupRideMarkSizes(focus))
        for (mark in marks) {
            if (mark.kind != WatchGroupRideMarkKind.Triangle) continue
            val color = Color(mark.rider.colorArgb).copy(alpha = if (mark.rider.stale) staleAlpha else 1f)
            drawEdgeTriangle(mark, outline, color)
        }
        labels.draw(this, map, marks, WatchGroupRideMarkKind.Triangle, focus)
    }
}

/**
 * Nav-focus distance labels, measured, placed and drawn in the draw scope. Grey distance, then a
 * flag: a thermometer when the Rider runs hot, else their battery % when it is low, each in its
 * level's colour. Stale Riders get none; their distance is as old as their place. Both layers place
 * every label against every mark ([placeLabels]) and each draws its own kind's, so a dot's label and
 * a triangle's never collide.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `drawGroupRideLabels`
 */
private class GroupRideLabels(private val measurer: TextMeasurer) {
    private class Label(val distance: TextLayoutResult, val heatColor: Color?, val battery: TextLayoutResult?, val size: Size)

    fun draw(scope: DrawScope, map: WatchMapProjection, marks: List<WatchGroupRideMark>, kind: WatchGroupRideMarkKind, focus: Float) = with(scope) {
        if (focus <= LABEL_MIN_FOCUS) return@with
        val labels = marks.map { if (it.rider.stale) null else measure(it.rider) }
        val placed = map.placeLabels(marks, labels.map { it?.size }, gapPx = GROUP_LABEL_GAP.toPx(), navFocus = focus)
        val gap = GROUP_LABEL_FLAG_GAP.toPx()
        for (i in marks.indices) {
            val label = labels[i] ?: continue
            val at = placed[i] ?: continue
            if (marks[i].kind != kind) continue
            val height = label.size.height
            drawText(label.distance, color = SecondaryText, topLeft = at, alpha = focus)
            val flagX = at.x + label.distance.size.width + gap
            if (label.heatColor != null) {
                val box = Size(height * THERMOMETER_ASPECT, height * THERMOMETER_HEIGHT)
                drawThermometer(label.heatColor.copy(alpha = focus), Offset(flagX, at.y + (height - box.height) / 2f), box)
            } else if (label.battery != null) {
                drawText(label.battery, topLeft = Offset(flagX, at.y), alpha = focus)
            }
        }
    }

    private fun DrawScope.measure(rider: GroupRideFrameRider): Label {
        val style = WatchTypography.mono(TextStyle(fontSize = GROUP_LABEL_FONT))
        val unitSystem = SettingsState.settings.value.unitSystem
        val distance = measurer.measure(groupRideDistanceLabel(rider.distanceM, unitSystem), style)
        val flag = groupRideLabelFlag(rider)
        val heatColor = (flag as? WatchGroupRideStatus.Hot)?.let { telemetryLevelColor(it.level) }
        val battery = (flag as? WatchGroupRideStatus.Battery)?.let { low ->
            telemetryLevelColor(low.level)?.let { measurer.measure("${low.percent}%", style.copy(color = it)) }
        }
        val height = distance.size.height.toFloat()
        val gap = GROUP_LABEL_FLAG_GAP.toPx()
        val flagWidth = when {
            heatColor != null -> gap + height * THERMOMETER_ASPECT
            battery != null -> gap + battery.size.width
            else -> 0f
        }
        return Label(distance, heatColor, battery, Size(distance.size.width + flagWidth, height))
    }
}

@Composable
private fun rememberGroupRideLabels(): GroupRideLabels {
    val measurer = rememberTextMeasurer(cacheSize = GROUP_LABEL_CACHE)
    return remember(measurer) { GroupRideLabels(measurer) }
}

/**
 * Thermometer in [box] at [origin]: a round bulb the full box width, under an outlined stem half as
 * wide, its lower part filled. The bulb against the narrow stem is what reads as a
 * thermometer at label size rather than a pill.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `drawThermometer`
 */
internal fun DrawScope.drawThermometer(color: Color, origin: Offset, box: Size) = translate(origin.x, origin.y) {
    val stroke = THERMOMETER_STROKE.toPx()
    val cx = box.width / 2f
    val bulbRadius = box.width / 2f
    val bulb = Offset(cx, box.height - bulbRadius)
    val stemWidth = box.width * THERMOMETER_STEM
    val stemTop = stroke / 2f
    val stemBottom = bulb.y
    drawRoundRect(
        color,
        Offset(cx - stemWidth / 2f, stemTop),
        Size(stemWidth, stemBottom - stemTop),
        CornerRadius(stemWidth / 2f),
        style = Stroke(stroke),
    )
    drawCircle(color, radius = bulbRadius, center = bulb)
    val mercuryTop = stemBottom - (stemBottom - stemTop) * THERMOMETER_FILL
    drawRect(color, Offset(cx - stemWidth / 2f, mercuryTop), Size(stemWidth, stemBottom - mercuryTop))
}

/**
 * The Group Ride's heading-up map on this canvas: the nav route's own projection, at the zoom and
 * course the route is drawn with this frame. Read in the draw scope, so an easing only repaints.
 */
internal fun DrawScope.watchMapProjection(mapView: WatchMapView) =
    WatchMapProjection(
        size.width,
        size.height,
        WatchMapProjection.RIDER_DROP.toPx(),
        WatchMapProjection.ROUTE_EDGE_INSET.toPx(),
        mapView.spanM.toDouble(),
        mapView.courseDeg.toDouble(),
    )

/**
 * Mark sizes on this canvas; dots grow towards the nav-focus page, where the map is the page.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `groupRideMarkSizes`
 */
internal fun DrawScope.groupRideMarkSizes(navFocus: Float) = WatchGroupRideMarkSizes(
    inRangeMarginPx = GROUP_IN_RANGE_MARGIN.toPx(),
    edgeInsetPx = GROUP_EDGE_INSET.toPx(),
    dotRadiusPx = GROUP_DOT_R.toPx() + (GROUP_FOCUS_DOT_R - GROUP_DOT_R).toPx() * navFocus.coerceIn(0f, 1f),
    triangleMinPx = GROUP_TRIANGLE_MIN.toPx(),
    triangleMaxPx = GROUP_TRIANGLE_MAX.toPx(),
)

/**
 * Base centred on the edge, apex inward, thin dark outline under the fill so it reads over the arcs.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `triangle`
 */
private fun DrawScope.drawEdgeTriangle(mark: WatchGroupRideMark, outline: Float, color: Color) {
    val (a, b, apex) = mark.triangleCorners()
    val path = Path().apply {
        moveTo(a.x, a.y)
        lineTo(b.x, b.y)
        lineTo(apex.x, apex.y)
        close()
    }
    drawPath(path, GROUP_OUTLINE_COLOR.copy(alpha = GROUP_OUTLINE_COLOR.alpha * color.alpha), style = Stroke(width = outline * 2f, join = StrokeJoin.Round))
    drawPath(path, color)
}

/**
 * A stale Rider's opacity, read in the draw scope. It pulses on the frame clock only while [group]
 * has a stale Rider; the caller is not composed in ambient, so ambient never animates. Both layers
 * take their phase from the same frame time, so a stale dot and a stale triangle pulse together.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `GroupRideCanvas`
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

/**
 * Dots stay this far inside the face edge, clear of the rim arcs.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `GROUP_IN_RANGE_MARGIN`
 */
private val GROUP_IN_RANGE_MARGIN = 38.dp
private val GROUP_DOT_R = 3.dp
/** On the nav-focus page, where the map is the page. */
private val GROUP_FOCUS_DOT_R = 4.5.dp
/**
 * Triangle bases sit in the outermost pixels, over the rim arcs.
 *
 * @parity /watch/watchos/GroupRideLayer.swift `GROUP_EDGE_INSET`
 */
private val GROUP_EDGE_INSET = 1.dp
private val GROUP_TRIANGLE_MIN = 7.dp
private val GROUP_TRIANGLE_MAX = 12.dp
private val GROUP_OUTLINE = 0.75.dp
private val GROUP_LABEL_FONT = 9.sp
/** Label clear of its dot or triangle apex. */
private val GROUP_LABEL_GAP = 3.dp
/** Between the distance and its flag. */
private val GROUP_LABEL_FLAG_GAP = 3.dp
/** Labels are not drawn at all until nav focus is under way. */
private const val LABEL_MIN_FOCUS = 0.01f
/** Up to 32 Riders, two strings each, at the frame rate a nav-focus drag runs. */
private const val GROUP_LABEL_CACHE = 64
/** A label's thermometer box as shares of its line height. */
private const val THERMOMETER_ASPECT = 0.45f
private const val THERMOMETER_HEIGHT = 1f
/** Stem width as a share of the bulb's; mercury as a share of the stem's height. */
private const val THERMOMETER_STEM = 0.5f
private const val THERMOMETER_FILL = 0.5f
private val THERMOMETER_STROKE = 0.8.dp

private val GROUP_OUTLINE_COLOR = Color(0xE6000000)
/** A Rider the phone has not heard from for a while: last known place, faded and pulsing. */
private const val GROUP_STALE_MAX_ALPHA = 0.7f
private const val GROUP_STALE_MIN_ALPHA = 0.2f
private const val GROUP_STALE_PULSE_MS = 700L
