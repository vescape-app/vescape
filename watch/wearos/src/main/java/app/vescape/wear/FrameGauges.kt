package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.AnchorType
import androidx.wear.compose.foundation.CurvedAlignment
import androidx.wear.compose.foundation.CurvedDirection
import androidx.wear.compose.foundation.CurvedLayout
import androidx.wear.compose.foundation.CurvedTextStyle
import androidx.wear.compose.foundation.curvedColumn
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.curvedText
import kotlin.math.cos
import kotlin.math.sin

/**
 * Wrist layout for a live Watch Frame. Three quarter-style gauges hug the watch rim — speed
 * top-left, duty top-right (almost touching at top center), battery across the bottom — styled like
 * the phone's DualGauge: thin gray guide, radial gradient fill from the centre, a strong rim line,
 * and a head tick at the current value. Temps + battery % sit inside, with the wall clock
 * ([WatchClock]) and the forecast ([WeatherReadout]) at the top rim gap since the fullscreen mirror
 * hides the system time and the rider cannot see the phone's weather pill, and the
 * navigation overlay ([NavPointer]) on top whenever the phone is sending a destination. [muted] dims
 * every value so a frozen (stale) reading is never shown as live.
 *
 * [focus] is the nav-focus progress (0 = full telemetry, 1 = navigation only), read as a lambda so
 * dragging never recomposes the layout: the numeric readouts fade and slide away in a graphics
 * layer while the rim gauges, clock, forecast and the whole nav stack stay put.
 */
@Composable
internal fun FrameLayout(
    frame: WatchFrame,
    muted: Boolean,
    focus: () -> Float = { 0f },
    onWeatherClick: () -> Unit = {},
) {
    val speedColor = if (muted || frame.speed == null) DimText else SpeedColor
    val dutyColor = if (muted || frame.duty == null) DimText else DutyColor
    val battColor = if (muted || frame.battery == null) DimText else batteryColor(frame.battery)
    val motorColor = if (muted || frame.motorTemp == null) DimText else MotorTempColor
    val ctrlColor = if (muted || frame.ctrlTemp == null) DimText else CtrlTempColor

    val navBearing = frame.navBearing
    val navDistance = frame.navDistanceM
    val hasNav = navBearing != null && navDistance != null

    Box(modifier = Modifier.fillMaxSize()) {
        // Bottom layer: route ahead + rider dot, under every gauge and readout.
        if (hasNav) {
            NavRoute(frame = frame, muted = muted)
        }

        // Rim gauges on one shared screen-centred circle.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val radius = size.minDimension / 2f - GAUGE_RIM_INSET.toPx()
            val center = Offset(size.width / 2f, size.height / 2f)
            val speedFrac = ((frame.speed ?: 0.0) / SPEED_MAX).toFloat().coerceIn(0f, 1f)
            val dutyFrac = ((frame.duty ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
            val battFrac = ((frame.battery ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
            val motorFrac = tempFraction(frame.motorTemp)
            val ctrlFrac = tempFraction(frame.ctrlTemp)
            val motorGlow = 0.08f + 0.40f * motorFrac
            val ctrlGlow = 0.08f + 0.40f * ctrlFrac
            val battGlow = 0.06f + 0.20f * battFrac

            // Speed: left (180°) -> top, sweep clockwise.
            drawGauge(center, radius, 180f, QUARTER_SWEEP, speedFrac, speedColor, style = StrongGaugeStyle)
            // Duty: right (360°) -> top, sweep counter-clockwise.
            drawGauge(center, radius, 360f, -QUARTER_SWEEP, dutyFrac, dutyColor, style = StrongGaugeStyle)
            // Battery: bottom arc, left (140°) -> right (40°) through 90°.
            drawGauge(center, radius, 140f, -BATTERY_SWEEP, battFrac, battColor, style = SoftGaugeStyle, drawHead = false, glowStrength = battGlow)
            // Temps: small arcs in the gaps beside the battery gauge, growing from the bottom.
            drawGauge(center, radius, MOTOR_ARC_START, TEMP_SWEEP, motorFrac, motorColor, style = SoftGaugeStyle, drawHead = false, glowStrength = motorGlow)
            drawGauge(center, radius, CTRL_ARC_START, -TEMP_SWEEP, ctrlFrac, ctrlColor, style = SoftGaugeStyle, drawHead = false, glowStrength = ctrlGlow)
        }

        // Navigation, only while the phone is sending it: chevron on the rim + distance above the
        // battery %. No destination means no nav lanes, and the frame renders exactly as before.
        if (hasNav) {
            NavPointer(bearingDeg = navBearing!!, distanceM = navDistance!!, muted = muted, focus = focus)
        } else {
            // Nav focus with nothing to show would be a blank circle. Say why, but only once the
            // drag is nearly done, so it never flickers under the departing readouts.
            NavAbsentHint(focus)
        }

        // Temp readouts ride their own arc: curved text just inside the gauge line, centred on the
        // arc's mid-angle. Colour carries which is which (red = motor, orange = controller).
        CurvedTemp(MOTOR_ARC_START + TEMP_SWEEP / 2f, temp(frame.motorTemp), "MOTOR", motorColor, focus)
        CurvedTemp(CTRL_ARC_START - TEMP_SWEEP / 2f, temp(frame.ctrlTemp), "CTRL", ctrlColor, focus)

        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // ── Top: wall clock at the rim gap, then speed + duty values ──
            WatchClock(modifier = Modifier.padding(top = 8.dp), color = if (muted) DimText else SecondaryText)
            // Forecast under the clock — absent entirely until the phone pushes one, and gone
            // again in nav focus, where only the clock and the nav stack survive.
            WeatherReadout(
                muted = muted,
                onClick = onWeatherClick,
                modifier = Modifier.graphicsLayer { alpha = fadeOut(focus()) },
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(start = 32.dp, end = 32.dp, bottom = 8.dp)
                    .graphicsLayer {
                        val f = focus()
                        alpha = fadeOut(f)
                        // Values retreat into the arcs they belong to: speed/duty up to the top
                        // rim, battery down to the bottom one.
                        translationY = -f * HERO_FOCUS_RISE.toPx()
                        scaleX = 1f - HERO_FOCUS_SHRINK * f
                        scaleY = scaleX
                    },
                verticalAlignment = Alignment.Bottom,
            ) {
                LargeGaugeValue(Modifier.weight(1f), frame.speed?.let { format(it, 0) } ?: DASH, "km/h", speedColor)
                LargeGaugeValue(Modifier.weight(1f), frame.duty?.let { format(it, 0) } ?: DASH, "%", dutyColor)
            }

            // ── Bottom: battery % above the bottom gauge ──
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(bottom = 16.dp)
                    .graphicsLayer {
                        val f = focus()
                        alpha = fadeOut(f)
                        translationY = f * BATTERY_FOCUS_DROP.toPx()
                    },
                contentAlignment = Alignment.BottomCenter,
            ) {
                Text(
                    // Same size as the curved temp values so the three secondary readouts match.
                    text = frame.battery?.let { "${format(it, 0)}%" } ?: DASH,
                    style = MaterialTheme.typography.title3.copy(fontSize = TEMP_FONT_SIZE),
                    color = battColor,
                )
            }
        }
    }
}

/**
 * What the nav focus page shows when the phone is not navigating: a centred, dim two-liner that
 * fades in as the readouts leave. Alpha is read inside the graphics layer so the drag never
 * recomposes.
 */
@Composable
private fun NavAbsentHint(focus: () -> Float) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp)
            .graphicsLayer { alpha = fadeIn(focus()) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_ph_map_pin),
            contentDescription = null,
            tint = DimText,
            modifier = Modifier.size(HINT_ICON_SIZE),
        )
        Text(
            text = "No navigation",
            style = MaterialTheme.typography.title3.copy(fontSize = TEMP_FONT_SIZE),
            color = SecondaryText,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            text = "Set a destination on your phone",
            style = MaterialTheme.typography.caption2.copy(fontSize = HINT_FONT_SIZE),
            color = DimText,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/** Ambient rendering of a frame: a single dim speed hero. */
@Composable
internal fun AmbientLayout(frame: WatchFrame) {
    Text(
        text = frame.speed?.let { format(it, 0) } ?: DASH,
        style = MaterialTheme.typography.display1,
        color = AmbientText,
        textAlign = TextAlign.Center,
    )
}

/**
 * A temperature value bent along the rim, sitting just inside the gauge line at [anchorDeg]
 * (canvas degrees: 0 = 3 o'clock, clockwise), with a tiny [label] stacked one ring further in.
 * Counter-clockwise angular direction keeps bottom-half text upright.
 */
@Composable
private fun CurvedTemp(anchorDeg: Float, value: String, label: String, color: Color, focus: () -> Float) {
    CurvedLayout(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                val f = focus()
                alpha = fadeOut(f)
                // Nudged outward into the rim, the same direction the heroes leave in.
                scaleX = 1f + TEMP_FOCUS_SPREAD * f
                scaleY = scaleX
            }
            .padding(TEMP_LABEL_GAP),
        anchor = anchorDeg,
        anchorType = AnchorType.Center,
        angularDirection = CurvedDirection.Angular.CounterClockwise,
    ) {
        // Outside in: value hugs the arc, label sits above it (toward the watch centre).
        curvedColumn(
            radialDirection = CurvedDirection.Radial.OutsideIn,
            angularAlignment = CurvedAlignment.Angular.Center,
        ) {
            curvedText(text = value, color = color, style = CurvedTextStyle(fontSize = TEMP_FONT_SIZE))
            curvedText(text = label, color = SecondaryText, style = CurvedTextStyle(fontSize = TEMP_LABEL_FONT_SIZE))
        }
    }
}

/**
 * One DualGauge-style arc. [sweepDeg] may be negative to flip fill direction. Layers: thin gray
 * guide, radial gradient wedge from the centre, a strong rim line, and a head tick at the tip.
 */
private fun DrawScope.drawGauge(
    center: Offset,
    radius: Float,
    startDeg: Float,
    sweepDeg: Float,
    fraction: Float,
    color: Color,
    style: GaugeStyle,
    drawHead: Boolean = true,
    glowStrength: Float = 0.38f,
) {
    val topLeft = Offset(center.x - radius, center.y - radius)
    val arcSize = Size(radius * 2f, radius * 2f)
    val guide = Stroke(width = style.guideWidth.toPx(), cap = StrokeCap.Butt)
    val head = Stroke(width = style.headWidth.toPx(), cap = StrokeCap.Butt)

    // Thin gray guide across the whole arc.
    drawArc(GuideColor, startDeg, sweepDeg, false, topLeft, arcSize, style = guide)

    val sweptDeg = sweepDeg * fraction
    if (fraction > 0f) {
        // Radial gradient fill from the inside out (soft but longer glow near rim).
        val brush = Brush.radialGradient(
            0f to Color.Transparent,
            0.5f to Color.Transparent,
            0.8f to color.copy(alpha = glowStrength * 0.40f),
            0.95f to color.copy(alpha = glowStrength * 0.74f),
            1f to color.copy(alpha = glowStrength),
            center = center,
            radius = radius,
        )
        drawArc(brush, startDeg, sweptDeg, true, topLeft, arcSize)

        // Strong rim line over the filled span.
        drawArc(color, startDeg, sweptDeg, false, topLeft, arcSize, style = head)
    }

    // Head tick at the current value — omitted when drawHead is false.
    if (drawHead) {
        val tipRad = Math.toRadians((startDeg + sweptDeg).toDouble())
        val inner = radius - radius * style.headLenRatio
        val outer = radius + style.headWidth.toPx() / 2f
        val p1 = Offset(center.x + (inner * cos(tipRad)).toFloat(), center.y + (inner * sin(tipRad)).toFloat())
        val p2 = Offset(center.x + (outer * cos(tipRad)).toFloat(), center.y + (outer * sin(tipRad)).toFloat())
        drawLine(color, p1, p2, strokeWidth = style.headWidth.toPx(), cap = StrokeCap.Butt)
    }
}

/** Larger centered hero value + unit for speed and duty. */
@Composable
private fun LargeGaugeValue(modifier: Modifier, value: String, unit: String, color: Color) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, style = MaterialTheme.typography.display1, color = color)
        Text(text = unit, style = MaterialTheme.typography.caption3, color = SecondaryText)
    }
}

private fun format(value: Double, decimals: Int): String = String.format("%.${decimals}f", value)

private fun temp(value: Double?): String = value?.let { "${format(it, 0)}°" } ?: DASH

private fun batteryColor(value: Double?): Color = when {
    value == null -> SecondaryText
    value < 20.0 -> WarningColor
    else -> BatteryColor
}

// Top rim gauges: 90° quarter-circles, small gap at top center. Battery: shallow bottom arc.
private const val TOP_GAP = 2f
private const val QUARTER_SWEEP = 90f - TOP_GAP
private const val BATTERY_SWEEP = 100f

/** Distance from the layout edge to the gauge circle every rim arc is drawn on. */
internal val GAUGE_RIM_INSET = 3.dp

private const val SPEED_MAX = 50.0

private const val TEMP_MIN = 10.0
private const val TEMP_MAX = 80.0
private const val TEMP_SWEEP = 32f
private const val MOTOR_ARC_START = 144f
private const val CTRL_ARC_START = 36f

/** Telemetry readouts clear out ahead of the drag, so nav is alone well before the page settles. */
internal fun fadeOut(focus: Float): Float = (1f - focus * FOCUS_FADE_RATE).coerceIn(0f, 1f)

internal const val FOCUS_FADE_RATE = 1.8f

/** The no-nav hint arrives only after the readouts are gone, so the two never overlap. */
private fun fadeIn(focus: Float): Float =
    ((focus - HINT_FADE_ONSET) / (1f - HINT_FADE_ONSET)).coerceIn(0f, 1f)

private const val HINT_FADE_ONSET = 0.6f
private val HINT_FONT_SIZE = 11.sp
private val HINT_ICON_SIZE = 22.dp

private val HERO_FOCUS_RISE = 30.dp
private const val HERO_FOCUS_SHRINK = 0.12f
private val BATTERY_FOCUS_DROP = 18.dp
private const val TEMP_FOCUS_SPREAD = 0.06f

// Curved temp text: clears the rim line with a small gap so it reads above the arc.
private val TEMP_LABEL_GAP = 7.dp
private val TEMP_FONT_SIZE = 15.sp
private val TEMP_LABEL_FONT_SIZE = 7.sp

private fun tempFraction(value: Double?): Float =
    (((value ?: TEMP_MIN) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)).toFloat().coerceIn(0f, 1f)

private data class GaugeStyle(
    val guideWidth: Dp,
    val headWidth: Dp,
    val headLenRatio: Float,
)

private val StrongGaugeStyle = GaugeStyle(2.dp, 4.dp, 0.18f)
private val SoftGaugeStyle = GaugeStyle(1.dp, 2.dp, 0.10f)
