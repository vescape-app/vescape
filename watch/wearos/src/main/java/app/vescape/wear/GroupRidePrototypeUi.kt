package app.vescape.wear

// PROTOTYPE — the chosen Group Ride design on the Wear Mirror (variants A–K explored, this won):
// - gauges: riders inside the nav map are plain dots in their colour on the map's own projection,
//   drawn over the route but under the gauges and numbers; riders beyond it are triangles in their
//   colour on the screen edge, on the ray from me. A lost rider pulses, faded, in their own colour.
// - nav focus: the same marks, plus "680m" labels with a warning after the distance (orange battery %,
//   red thermometer). The gauges carry no text.
// - page below nav focus: roster sorted by distance (arrow, distance, battery % / heat / lost), with
//   the map and nav readout hidden.
// Overheating is not in Rider Presence yet; the real build needs that flag from the phone.

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import expo.modules.vescapecore.telemetry.UnitPresentation
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal object GroupRidePrototypeUi {

    /** Map dots (and my own ring without nav): under the numbers. */
    @Composable
    fun Underlay(scope: GroupRideProtoScope) = protoKLayer(scope, dots = true)

    /** Bezel ticks: over the rim arcs. */
    @Composable
    fun Overlay(scope: GroupRideProtoScope) = protoKLayer(scope, dots = false)

    @Composable
    private fun protoKLayer(scope: GroupRideProtoScope, dots: Boolean) {
        val riders = scope.riders
        val ambient = scope.ambient
        val unitSystem = SettingsState.settings.value.unitSystem
        val measurer = rememberTextMeasurer()
        // Frame clock only while someone is hot and the panel is awake; ambient never animates.
        val blink: State<Float>? = if (!ambient.active && riders.any { it.overheating && !it.stale }) {
            rememberInfiniteTransition(label = "protoKBlink").animateFloat(
                initialValue = 1f,
                targetValue = PROTO_K_BLINK_MIN_ALPHA,
                animationSpec = infiniteRepeatable(tween(PROTO_K_BLINK_MS), RepeatMode.Reverse),
                label = "protoKBlink",
            )
        } else {
            null
        }
        // Lost riders breathe slowly: "position loading, not current". Ambient holds them still.
        val stalePulse: State<Float>? = if (!ambient.active && riders.any { it.stale }) {
            rememberInfiniteTransition(label = "protoKStale").animateFloat(
                initialValue = PROTO_K_STALE_MAX_ALPHA,
                targetValue = PROTO_K_STALE_MIN_ALPHA,
                animationSpec = infiniteRepeatable(tween(PROTO_K_STALE_PULSE_MS), RepeatMode.Reverse),
                label = "protoKStale",
            )
        } else {
            null
        }

        val meColor = ambient.readout(navColor())
        Canvas(modifier = Modifier.fillMaxSize().graphicsLayer { alpha = fadeOut(scope.otherFocus()) }) {
            // Read inside the draw scope: frames and nav-focus drags repaint without recomposing.
            val frame = TelemetryState.mirrorState.value.frame
            val focus = scope.navFocus().coerceIn(0f, 1f)
            val blinkAlpha = blink?.value ?: 1f
            val staleAlpha = stalePulse?.value ?: PROTO_K_STALE_MIN_ALPHA
            val center = Offset(size.width / 2f, size.height / 2f)
            val me = Offset(center.x, center.y + PROTO_K_RIDER_DROP.toPx())
            // Same projection as NavRoute (target span, not its eased value).
            val spanM = (frame?.routeSpanM ?: PROTO_K_DEFAULT_SPAN_M).toFloat().coerceIn(PROTO_K_MIN_SPAN_M, PROTO_K_MAX_SPAN_M)
            val scale = (size.minDimension - PROTO_K_ROUTE_EDGE_INSET.toPx()) / spanM
            val faceR = size.minDimension / 2f
            val inRangeR = faceR - PROTO_K_IN_RANGE_MARGIN.toPx()
            val edge = faceR - PROTO_K_EDGE_INSET.toPx()
            val outline = PROTO_K_OUTLINE.toPx()
            val labelStyle = WatchTypography.mono(TextStyle(fontSize = PROTO_K_LABEL_SP.sp))

            // No nav, no NavRoute: draw the reference ring ourselves at the same spot.
            if (dots && frame?.navBearing == null) drawRiderDot(me, meColor)

            // Far first, so a close rider lands on top at a similar bearing.
            for (rider in riders.sortedByDescending { it.distanceM }) {
                val rad = Math.toRadians(rider.bearingDeg.toDouble())
                // Heading-up map: my travel direction is screen-up.
                val dir = Offset(sin(rad).toFloat(), -cos(rad).toFloat())
                val point = me + dir * (rider.distanceM.toFloat() * scale)
                val attention = !rider.stale && rider.needsAttention
                val alpha = if (rider.overheating && !rider.stale) blinkAlpha else 1f
                val label = if (focus > 0.01f && !rider.stale) {
                    measurer.measure(protoKDistance(rider.distanceM, unitSystem), labelStyle)
                } else {
                    null
                }
                // Warning rides after the distance: battery % in orange, or a red thermometer.
                val warnLabel = if (label != null && attention && !rider.overheating) {
                    measurer.measure("${rider.battery}%", labelStyle)
                } else {
                    null
                }
                val warnW = when {
                    label == null || !attention -> 0f
                    warnLabel != null -> PROTO_K_WARN_GAP.toPx() + warnLabel.size.width
                    else -> PROTO_K_WARN_GAP.toPx() + label.size.height * PROTO_K_HEAT_ASPECT
                }
                val warnColor = protoKWarnColor(rider, ambient)
                // Label + warning as one unit, nudged off the nav readout by [shift].
                fun drawLabel(topLeft: Offset) {
                    val l = label ?: return
                    val placed = protoKAvoidNav(topLeft, l.size.width + warnW, l.size.height.toFloat(), size.width, size.height, focus)
                    drawText(l, color = ambient.readout(SecondaryText), topLeft = placed, alpha = focus)
                    if (!attention) return
                    val x = placed.x + l.size.width + PROTO_K_WARN_GAP.toPx()
                    if (warnLabel != null) {
                        drawText(warnLabel, color = warnColor, topLeft = Offset(x, placed.y), alpha = focus)
                    } else {
                        val h = l.size.height.toFloat()
                        protoKDrawHeat(warnColor.copy(alpha = focus * alpha), Offset(x, placed.y + h * 0.1f), androidx.compose.ui.geometry.Size(h * PROTO_K_HEAT_ASPECT, h * 0.8f))
                    }
                }

                val inRange = (point - center).getDistance() <= inRangeR
                if (inRange != dots) continue
                if (inRange) {
                    val r = PROTO_K_DOT_R.toPx() + (PROTO_K_FOCUS_DOT_R - PROTO_K_DOT_R).toPx() * focus
                    if (rider.stale) {
                        // Faded dot in their own colour, pulsing: last known place, still loading.
                        drawCircle(PROTO_K_OUTLINE_COLOR, radius = r + outline, center = point, alpha = staleAlpha)
                        drawCircle(ambient.readout(rider.color), radius = r, center = point, alpha = staleAlpha)
                    } else {
                        if (attention) {
                            val ringR = r + PROTO_K_ATTENTION_GAP.toPx()
                            drawCircle(PROTO_K_OUTLINE_COLOR, radius = ringR, center = point, style = Stroke(PROTO_K_ATTENTION_W.toPx() + outline * 2f))
                            drawCircle(protoKWarnColor(rider, ambient), radius = ringR, center = point, style = Stroke(PROTO_K_ATTENTION_W.toPx()), alpha = alpha)
                        }
                        drawCircle(PROTO_K_OUTLINE_COLOR, radius = r + outline, center = point)
                        drawCircle(ambient.readout(rider.color), radius = r, center = point)
                    }
                    if (label != null) {
                        val w = label.size.width + warnW
                        val h = label.size.height.toFloat()
                        val side = if (point.x >= me.x) 1f else -1f
                        val reach = r + (if (attention) PROTO_K_ATTENTION_GAP.toPx() + PROTO_K_ATTENTION_W.toPx() else 0f) + PROTO_K_LABEL_GAP.toPx()
                        val left = if (side > 0f) point.x + reach else point.x - reach - w
                        drawLabel(Offset(left, point.y - h / 2f))
                    }
                    continue
                }

                // Out of range: tick where the ray from me meets the outer edge, oriented radially there.
                val outer = me + dir * protoKRayToCircle(me - center, dir, edge)
                val out = (outer - center) / edge
                val color = ambient.readout(rider.color)
                val innerR = when {
                    rider.stale -> {
                        // Short tick in their colour, pulsing like the lost dot.
                        val len = PROTO_K_STALE_LEN.toPx()
                        protoKTriangle(outer, out, len, outline, color.copy(alpha = staleAlpha))
                        len
                    }
                    else -> {
                        // Log-scaled from "just left the map" to 3 km along this very ray.
                        val boundaryM = protoKRayToCircle(me - center, dir, inRangeR) / scale
                        val near = protoKNearness(rider.distanceM, boundaryM.toDouble())
                        val len = PROTO_K_SHORT.toPx() + (PROTO_K_LONG.toPx() - PROTO_K_SHORT.toPx()) * near
                        // Always the rider's colour; a warning lives only in the nav-focus label.
                        protoKTriangle(outer, out, len, outline, color)
                        len
                    }
                }

                if (label != null) {
                    val w = label.size.width + warnW
                    val h = label.size.height.toFloat()
                    val inward = -out
                    val at = outer + inward * (innerR + PROTO_K_LABEL_GAP.toPx() + protoKExtent(inward, w, h))
                    drawLabel(Offset(at.x - w / 2f, at.y - h / 2f))
                }
            }
        }
    }

    @Composable
    fun Page(scope: GroupRideProtoScope) {
        val ambient = scope.ambient
        val roster = scope.riders.sortedBy { it.distanceM }.take(PROTO_K_MAX_ROWS)

        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            // Map and nav readout are hidden here, so the block centres on the face.
            val limit = minOf(maxWidth, maxHeight) / 2 * PROTO_K_SAFE_RADIUS
            val blockH = PROTO_K_TITLE_H + PROTO_K_TITLE_GAP + PROTO_K_ROW_H * roster.size
            val rowsTop = -blockH / 2 + PROTO_K_TITLE_H + PROTO_K_TITLE_GAP

            Column(
                modifier = Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Top,
            ) {
                Box(modifier = Modifier.height(PROTO_K_TITLE_H), contentAlignment = Alignment.Center) {
                    Text(
                        text = "Group · ${scope.riders.size}",
                        style = MaterialTheme.typography.caption2.copy(fontSize = PROTO_K_TITLE_FONT),
                        color = ambient.readout(SecondaryText),
                        textAlign = TextAlign.Center,
                    )
                }
                Spacer(modifier = Modifier.height(PROTO_K_TITLE_GAP))
                roster.forEachIndexed { i, rider ->
                    // Compact fixed width, narrowed to the safe-circle chord at the row's centre line.
                    val mid = (rowsTop + PROTO_K_ROW_H * i + PROTO_K_ROW_H / 2).value
                    val half = sqrt((limit.value * limit.value - mid * mid).coerceAtLeast(0f))
                    ProtoKRow(rider, ambient, minOf(PROTO_K_ROW_W, (half * 2).dp))
                }
            }
        }
    }
}

@Composable
private fun ProtoKRow(rider: ProtoRider, ambient: AmbientMode, width: Dp) {
    val nameColor = ambient.readout(PrimaryText)
    val dimColor = ambient.readout(SecondaryText)
    val dotColor = ambient.readout(rider.color)
    Row(
        modifier = Modifier
            .width(width)
            .height(PROTO_K_ROW_H)
            .graphicsLayer { alpha = if (rider.stale) PROTO_K_STALE_ROW_ALPHA else 1f },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(modifier = Modifier.size(PROTO_K_ROW_DOT)) { drawCircle(dotColor) }
        Text(
            text = rider.name.take(PROTO_K_NAME_CHARS),
            style = MaterialTheme.typography.caption1.copy(fontSize = PROTO_K_NAME_FONT),
            color = nameColor,
            maxLines = 1,
            overflow = TextOverflow.Clip,
            modifier = Modifier.padding(start = 4.dp, end = 2.dp).weight(1f),
        )
        Canvas(modifier = Modifier.size(PROTO_K_ARROW_BOX)) {
            rotate(rider.bearingDeg) { protoKDrawArrow(dimColor) }
        }
        Text(
            text = UnitPresentation.distance(rider.distanceM, SettingsState.settings.value.unitSystem),
            style = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = PROTO_K_DIST_FONT)),
            color = nameColor,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(PROTO_K_DIST_W),
        )
        Spacer(modifier = Modifier.width(3.dp))
        Box(modifier = Modifier.width(PROTO_K_CHIP_W), contentAlignment = Alignment.CenterEnd) {
            ProtoKChip(rider, ambient)
        }
    }
}

@Composable
private fun ProtoKChip(rider: ProtoRider, ambient: AmbientMode) {
    val chipStyle = WatchTypography.mono(MaterialTheme.typography.caption2.copy(fontSize = PROTO_K_CHIP_FONT))
    when {
        rider.stale -> Text(text = "lost", style = chipStyle, color = ambient.readout(DimText))
        rider.overheating -> {
            val heat = ambient.readout(MotorTempColor)
            Canvas(modifier = Modifier.size(PROTO_K_CHIP_GLYPH)) { protoKDrawHeat(heat) }
        }
        rider.battery == null -> Text(text = DASH, style = chipStyle, color = ambient.readout(DimText))
        else -> Text(
            text = "${rider.battery}%",
            style = chipStyle,
            color = ambient.readout(if (rider.lowBattery) WarningColor else SecondaryText),
        )
    }
}

/** Distance along unit [dir] from [from] (relative to the circle centre, inside it) to a circle of radius [r]. */
private fun protoKRayToCircle(from: Offset, dir: Offset, r: Float): Float {
    val b = from.x * dir.x + from.y * dir.y
    val c = from.x * from.x + from.y * from.y - r * r
    return -b + sqrt((b * b - c).coerceAtLeast(0f))
}

/** Radial bar from the outer edge inward, dark halo first so it reads over the rim arcs. */
/** Triangle with its base on the edge and its apex pointing inward, towards me. */
private fun DrawScope.protoKTriangle(outer: Offset, out: Offset, length: Float, outline: Float, color: Color) {
    val side = Offset(-out.y, out.x) * (length * PROTO_K_TRIANGLE_BASE / 2f)
    val path = Path().apply {
        moveTo(outer.x + side.x, outer.y + side.y)
        lineTo(outer.x - side.x, outer.y - side.y)
        val apex = outer - out * length
        lineTo(apex.x, apex.y)
        close()
    }
    drawPath(path, PROTO_K_OUTLINE_COLOR, style = Stroke(width = outline * 2f, join = StrokeJoin.Round))
    drawPath(path, color)
}

/** Distance from a box centre to its edge along unit direction [dir]. */
private fun protoKExtent(dir: Offset, w: Float, h: Float): Float = min(
    if (abs(dir.x) > 1e-3f) (w / 2f) / abs(dir.x) else Float.MAX_VALUE,
    if (abs(dir.y) > 1e-3f) (h / 2f) / abs(dir.y) else Float.MAX_VALUE,
)

/** 1 right at the in-range boundary, 0 at ≥3 km, log in between. */
private fun protoKNearness(distanceM: Double, boundaryM: Double): Float {
    val near = boundaryM.coerceIn(1.0, PROTO_K_FAR_M - 1.0)
    val t = ln(distanceM.coerceAtLeast(near) / near) / ln(PROTO_K_FAR_M / near)
    return (1.0 - t).toFloat().coerceIn(0f, 1f)
}

/** Orange for low battery, red for overheating; white on a low-bit ambient panel. */
private fun protoKWarnColor(rider: ProtoRider, ambient: AmbientMode): Color = when {
    ambient.active && ambient.lowBit -> Color.White
    rider.overheating -> MotorTempColor
    else -> WarningColor
}

/** Small filled arrow pointing up (straight ahead) before rotation, centred in the canvas. */
private fun DrawScope.protoKDrawArrow(color: Color) {
    val c = Offset(size.width / 2f, size.height / 2f)
    val h = size.minDimension * 0.42f
    val w = size.minDimension * 0.30f
    val path = Path().apply {
        moveTo(c.x, c.y - h)
        lineTo(c.x + w, c.y + h)
        lineTo(c.x, c.y + h * 0.45f)
        lineTo(c.x - w, c.y + h)
        close()
    }
    drawPath(path, color)
}

/** Thermometer: stroked stem, filled bulb, a short mercury line up the stem. */
private fun DrawScope.protoKDrawHeat(
    color: Color,
    origin: Offset = Offset.Zero,
    box: androidx.compose.ui.geometry.Size = size,
) = translate(origin.x, origin.y) { protoKHeatIn(color, box) }

private fun DrawScope.protoKHeatIn(color: Color, size: androidx.compose.ui.geometry.Size) {
    val stroke = 1.3.dp.toPx()
    val cx = size.width / 2f
    val stemW = size.width * 0.28f
    val bulbR = size.width * 0.24f
    val bulbC = Offset(cx, size.height - bulbR - stroke / 2f)
    val stemTop = stroke / 2f
    val stemBottom = bulbC.y - bulbR * 0.6f
    drawRoundRect(
        color,
        Offset(cx - stemW / 2f, stemTop),
        androidx.compose.ui.geometry.Size(stemW, stemBottom - stemTop),
        androidx.compose.ui.geometry.CornerRadius(stemW / 2f),
        style = Stroke(stroke),
    )
    drawCircle(color, radius = bulbR, center = bulbC)
    drawLine(color, bulbC, Offset(cx, stemTop + (stemBottom - stemTop) * 0.35f), strokeWidth = stemW * 0.45f)
}

/** "680m", "2.3km": no space, so the label stays short on the rim. */
private fun protoKDistance(m: Double, unitSystem: String): String =
    UnitPresentation.distance(m, unitSystem).replace(" ", "")

/**
 * In nav focus the nav readout grows at the bottom (≈ x 31–69%, y 82–94% of the face). A label that
 * would land on it slides up until clear.
 */
private fun protoKAvoidNav(topLeft: Offset, w: Float, h: Float, faceW: Float, faceH: Float, focus: Float): Offset {
    val navLeft = faceW * 0.29f
    val navRight = faceW * 0.71f
    val navTop = faceH * (0.745f + 0.075f * focus)
    val overlapsX = topLeft.x < navRight && topLeft.x + w > navLeft
    if (!overlapsX || topLeft.y + h <= navTop) return topLeft
    return Offset(topLeft.x, navTop - h)
}

// Nav map projection — mirrors NavRoute's private constants.
private val PROTO_K_RIDER_DROP = 34.dp
private val PROTO_K_ROUTE_EDGE_INSET = 24.dp
private const val PROTO_K_DEFAULT_SPAN_M = 600.0
private const val PROTO_K_MIN_SPAN_M = 150f
private const val PROTO_K_MAX_SPAN_M = 2_000f

// In-range map dots: kept clear of the rim arcs.
private val PROTO_K_IN_RANGE_MARGIN = 38.dp
private val PROTO_K_DOT_R = 3.dp
private val PROTO_K_FOCUS_DOT_R = 4.5.dp
private val PROTO_K_ATTENTION_GAP = 2.5.dp
private val PROTO_K_ATTENTION_W = 1.5.dp

// Bezel ticks: outermost ~10 px of a 454 px face, over the rim arcs (GAUGE_RIM_INSET 3 dp).
private val PROTO_K_EDGE_INSET = 1.dp
private val PROTO_K_LONG = 12.dp
private val PROTO_K_SHORT = 7.dp
private val PROTO_K_STALE_LEN = 7.dp
/** Base width as a share of the triangle's length. */
private const val PROTO_K_TRIANGLE_BASE = 0.9f
private const val PROTO_K_STALE_MAX_ALPHA = 0.7f
private const val PROTO_K_STALE_MIN_ALPHA = 0.2f
private const val PROTO_K_STALE_PULSE_MS = 700
private val PROTO_K_OUTLINE = 0.75.dp
private val PROTO_K_WARN_GAP = 3.dp
private const val PROTO_K_HEAT_ASPECT = 0.5f
private val PROTO_K_LABEL_GAP = 3.dp
private const val PROTO_K_LABEL_SP = 9f
private const val PROTO_K_FAR_M = 3000.0
private const val PROTO_K_BLINK_MS = 1200
private const val PROTO_K_BLINK_MIN_ALPHA = 0.25f
private val PROTO_K_OUTLINE_COLOR = Color(0xE6000000)

// Roster page (454px ≈ 227dp screen), centred; rows stay inside 0.8 × radius.
private const val PROTO_K_MAX_ROWS = 5
private const val PROTO_K_SAFE_RADIUS = 0.8f
private const val PROTO_K_NAME_CHARS = 5
private val PROTO_K_ROW_H = 22.dp
private val PROTO_K_ROW_W = 150.dp
private val PROTO_K_TITLE_H = 14.dp
private val PROTO_K_TITLE_GAP = 4.dp
private val PROTO_K_TITLE_FONT = 11.sp
private val PROTO_K_NAME_FONT = 13.sp
private val PROTO_K_DIST_FONT = 11.sp
private val PROTO_K_CHIP_FONT = 11.sp
private val PROTO_K_ROW_DOT = 6.dp
private val PROTO_K_ARROW_BOX = 10.dp
private val PROTO_K_DIST_W = 48.dp
private val PROTO_K_CHIP_W = 30.dp
private val PROTO_K_CHIP_GLYPH = 12.dp
private const val PROTO_K_STALE_ROW_ALPHA = 0.4f
