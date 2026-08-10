package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.cos
import kotlin.math.sin

/**
 * Wrist layout for a live Watch Frame. Three quarter-style gauges hug the watch rim — speed
 * top-left, duty top-right (almost touching at top center), battery across the bottom — styled like
 * the phone's DualGauge: thin gray guide, radial gradient fill from the centre, a strong rim line,
 * and a head tick at the current value. Temps + battery % sit inside, with the wall clock
 * ([WatchClock]) at the top rim gap since the fullscreen mirror hides the system time. [muted] dims
 * every value so a frozen (stale) reading is never shown as live.
 */
@Composable
internal fun FrameLayout(frame: WatchFrame, muted: Boolean) {
    val speedColor = if (muted) DimText else SpeedColor
    val dutyColor = if (muted) DimText else DutyColor
    val battColor = if (muted) DimText else batteryColor(frame.battery)
    val motorColor = if (muted) DimText else MotorTempColor
    val ctrlColor = if (muted) DimText else CtrlTempColor

    Box(modifier = Modifier.fillMaxSize()) {
        // Rim gauges on one shared screen-centred circle.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val radius = size.minDimension / 2f - HEAD_W.toPx()
            val center = Offset(size.width / 2f, size.height / 2f)
            val speedFrac = (frame.speed / SPEED_MAX).toFloat().coerceIn(0f, 1f)
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
            drawGauge(center, radius, 144f, TEMP_SWEEP, motorFrac, motorColor, style = SoftGaugeStyle, drawHead = false, glowStrength = motorGlow)
            drawGauge(center, radius, 36f, -TEMP_SWEEP, ctrlFrac, ctrlColor, style = SoftGaugeStyle, drawHead = false, glowStrength = ctrlGlow)
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // ── Top: wall clock at the rim gap, then speed + duty values ──
            WatchClock(modifier = Modifier.padding(top = 8.dp), color = if (muted) DimText else SecondaryText)

            Row(
                modifier = Modifier.fillMaxWidth().weight(1f).padding(start = 32.dp, end = 32.dp, bottom = 8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                LargeGaugeValue(Modifier.weight(1f), format(frame.speed, 0), "km/h", speedColor)
                LargeGaugeValue(Modifier.weight(1f), frame.duty?.let { format(it, 0) } ?: "--", "%", dutyColor)
            }

            // ── Bottom: temps near center, nudged toward their side gauges, battery % above bottom gauge ──
            Column(
                modifier = Modifier.fillMaxWidth().weight(1f).padding(bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp, start = 24.dp, end = 24.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    SmallGaugeValue(
                        Modifier.weight(1f),
                        temp(frame.motorTemp),
                        "Motor",
                        motorColor,
                        horizontalAlignment = Alignment.Start,
                    )
                    SmallGaugeValue(
                        Modifier.weight(1f),
                        temp(frame.ctrlTemp),
                        "Ctrl",
                        ctrlColor,
                        horizontalAlignment = Alignment.End,
                    )
                }
                Text(
                    text = frame.battery?.let { "${format(it, 0)}%" } ?: "--",
                    style = MaterialTheme.typography.title3,
                    color = battColor,
                )
            }
        }
    }
}

/** Ambient rendering of a frame: a single dim speed hero. */
@Composable
internal fun AmbientLayout(frame: WatchFrame) {
    Text(
        text = format(frame.speed, 0),
        style = MaterialTheme.typography.display1,
        color = AmbientText,
        textAlign = TextAlign.Center,
    )
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

/** Smaller value + label for the temperature readouts. */
@Composable
private fun SmallGaugeValue(
    modifier: Modifier,
    value: String,
    unit: String,
    color: Color,
    horizontalAlignment: Alignment.Horizontal = Alignment.CenterHorizontally,
) {
    Column(modifier = modifier, horizontalAlignment = horizontalAlignment) {
        Text(text = value, style = MaterialTheme.typography.title3, color = color)
        Text(text = unit, style = MaterialTheme.typography.caption3, color = SecondaryText)
    }
}

private fun format(value: Double, decimals: Int): String = String.format("%.${decimals}f", value)

private fun temp(value: Double?): String = value?.let { "${format(it, 0)}°" } ?: "--"

private fun batteryColor(value: Double?): Color = when {
    value == null -> SecondaryText
    value < 20.0 -> WarningColor
    else -> BatteryColor
}

// Top rim gauges: 90° quarter-circles, small gap at top center. Battery: shallow bottom arc.
private const val TOP_GAP = 2f
private const val QUARTER_SWEEP = 90f - TOP_GAP
private const val BATTERY_SWEEP = 100f

private val HEAD_W = 3.dp

private const val SPEED_MAX = 50.0

private const val TEMP_MIN = 10.0
private const val TEMP_MAX = 80.0
private const val TEMP_SWEEP = 32f

private fun tempFraction(value: Double?): Float =
    (((value ?: TEMP_MIN) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)).toFloat().coerceIn(0f, 1f)

private data class GaugeStyle(
    val guideWidth: Dp,
    val headWidth: Dp,
    val headLenRatio: Float,
)

private val StrongGaugeStyle = GaugeStyle(2.dp, 4.dp, 0.18f)
private val SoftGaugeStyle = GaugeStyle(1.dp, 2.dp, 0.10f)
