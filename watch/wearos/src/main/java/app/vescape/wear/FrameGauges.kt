package app.vescape.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
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
 * [ambient] is the always-on rendering of this same layout, not a second one: see [AmbientMode] for
 * which lanes keep their reading there and which stay an empty skeleton.
 *
 * This layout is pinned at the root of the mirror, over both pagers: the rim arcs are permanent
 * furniture and never move, whatever page the rider swipes to. It draws above the pages so the
 * forecast readout can be tapped at all; that readout is the only thing here that takes pointer
 * input, and only while [onWeatherClick] is non-null, so a page below is never blocked. The three focus progresses say how
 * far a page has taken over, and each is read as a lambda so dragging never recomposes the layout —
 * everything above the arcs fades and slides in a graphics layer instead.
 *
 * - [focus] — nav focus (up-drag over the gauges): readouts leave, the nav stack stays and grows.
 * - [controlFocus] — the horizontal control pager (Move, diagnostics): readouts and nav stack leave.
 * - [weatherFocus] — the forecast page above: readouts and nav stack leave.
 *
 * The clock and the forecast readout at the top rim gap fade with the readouts; on the weather
 * centre they would otherwise duplicate the fuller forecast underneath.
 */
@Composable
internal fun FrameLayout(
    frame: WatchFrame,
    muted: Boolean,
    focus: () -> Float = { 0f },
    controlFocus: () -> Float = { 0f },
    weatherFocus: () -> Float = { 0f },
    onWeatherClick: (() -> Unit)? = null,
    ambient: AmbientMode = AmbientOff,
) {
    // A stale frame in ambient is the one case with nothing to say: the readings it would keep are
    // exactly the ones that have stopped arriving, so ambient empties every lane instead.
    val ambientBlind = ambient.active && muted
    val speedColor = ambient.skeleton(if (muted || frame.speed == null) DimText else SpeedColor)
    val dutyColor = ambient.skeleton(if (muted || frame.duty == null) DimText else DutyColor)
    // Low battery keeps its warning colour into ambient: it is the one reading a glance must not
    // mistake for ordinary state. A low-bit panel cannot render it, so there it falls back to tint.
    val battColor = when {
        muted || frame.battery == null -> ambient.skeleton(DimText)
        ambient.active && !ambient.lowBit && frame.battery < BATTERY_WARNING_PERCENT -> WarningColor
        else -> ambient.readout(batteryColor(frame.battery))
    }
    val motorColor = laneColor(ambient, frame.motorTemp, muted, MotorTempColor)
    val ctrlColor = laneColor(ambient, frame.ctrlTemp, muted, CtrlTempColor)
    val offset = ambient.burnInOffset()

    // Readouts leave for any focus mode; the nav stack survives nav focus alone.
    val readoutFocus = { maxOf(focus(), controlFocus(), weatherFocus()) }
    val navStackAlpha = { fadeOut(maxOf(controlFocus(), weatherFocus())) }

    val navBearing = frame.navBearing
    val navDistance = frame.navDistanceM
    val hasNav = navBearing != null && navDistance != null

    Box(modifier = Modifier.fillMaxSize()) {
        // Bottom layer: route ahead + rider dot, under every gauge and readout. Ambient skips it:
        // the lanes animate their zoom, and a moving map is the most expensive thing on the panel.
        if (hasNav && !ambient.active) {
            Box(modifier = Modifier.fillMaxSize().graphicsLayer { alpha = navStackAlpha() }) {
                NavRoute(frame = frame, muted = muted, navFocus = focus)
            }
        }

        // Rim gauges on one shared screen-centred circle.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val radius = size.minDimension / 2f - GAUGE_RIM_INSET.toPx()
            val center = Offset(size.width / 2f, size.height / 2f)
            // Every lane keeps its last reading in ambient; a frame that has stopped arriving
            // empties all of them at once.
            val speedFrac = if (ambientBlind) 0f else ((frame.speed ?: 0.0) / SPEED_MAX).toFloat().coerceIn(0f, 1f)
            val dutyFrac = if (ambientBlind) 0f else ((frame.duty ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
            val battFrac = if (ambientBlind) 0f else ((frame.battery ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
            val motorFrac = if (ambientBlind) 0f else tempFraction(frame.motorTemp)
            val ctrlFrac = if (ambientBlind) 0f else tempFraction(frame.ctrlTemp)
            // Read in the draw scope, so a drag repaints the arcs without recomposing them.
            // The wedge fills recede on a focused page: the rim lines still carry the values, but
            // their glow stops competing with whatever took the centre of the circle.
            val glowDim = ambient.glow(dimGlow(readoutFocus()))
            val motorGlow = (0.08f + 0.40f * motorFrac) * glowDim
            val ctrlGlow = (0.08f + 0.40f * ctrlFrac) * glowDim
            val battGlow = (0.06f + 0.20f * battFrac) * glowDim

            // Speed: left (180°) -> top, sweep clockwise.
            drawGauge(center, radius, 180f, QUARTER_SWEEP, speedFrac, speedColor, style = StrongGaugeStyle, glowStrength = STRONG_GLOW * glowDim)
            // Duty: right (360°) -> top, sweep counter-clockwise.
            drawGauge(center, radius, 360f, -QUARTER_SWEEP, dutyFrac, dutyColor, style = StrongGaugeStyle, glowStrength = STRONG_GLOW * glowDim)
            // Battery: bottom arc, left (140°) -> right (40°) through 90°.
            drawGauge(center, radius, 140f, -BATTERY_SWEEP, battFrac, battColor, style = SoftGaugeStyle, drawHead = false, glowStrength = battGlow)
            // Temps: small arcs in the gaps beside the battery gauge, growing from the bottom.
            drawGauge(center, radius, MOTOR_ARC_START, TEMP_SWEEP, motorFrac, motorColor, style = SoftGaugeStyle, drawHead = false, glowStrength = motorGlow)
            drawGauge(center, radius, CTRL_ARC_START, -TEMP_SWEEP, ctrlFrac, ctrlColor, style = SoftGaugeStyle, drawHead = false, glowStrength = ctrlGlow)
        }

        // Navigation, only while the phone is sending it: chevron on the rim + distance above the
        // battery %. No destination means no nav lanes, and the frame renders exactly as before.
        if (hasNav) {
            NavPointer(
                bearingDeg = navBearing!!,
                distanceM = navDistance!!,
                muted = muted || ambient.active,
                focus = focus,
                stackAlpha = navStackAlpha,
            )
        } else {
            // Nav focus with nothing to show would be a blank circle. Say why, but only once the
            // drag is nearly done, so it never flickers under the departing readouts.
            NavAbsentHint(focus = focus, stackAlpha = navStackAlpha)
        }

        // Temp readouts ride their own arc: curved text just inside the gauge line, centred on the
        // arc's mid-angle. Colour carries which is which (red = motor, orange = controller).
        CurvedTemp(MOTOR_ARC_START + TEMP_SWEEP / 2f, temp(frame.motorTemp, ambientBlind), "MOTOR", motorColor, readoutFocus)
        CurvedTemp(CTRL_ARC_START - TEMP_SWEEP / 2f, temp(frame.ctrlTemp, ambientBlind), "CTRL", ctrlColor, readoutFocus)

        // ── Top: wall clock at the rim gap, forecast under it ──
        // Its own stack, so the heroes below never move when the forecast appears or disappears.
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(offset.x, offset.y)
                .padding(top = 8.dp)
                .graphicsLayer { alpha = fadeOut(readoutFocus()) },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Both survive ambient unchanged: the mirror hides the system clock, and a forecast is
            // the slowest-moving thing on the screen.
            WatchClock(color = ambient.readout(if (muted) DimText else SecondaryText))
            WeatherReadout(muted = muted || ambient.active, onClick = onWeatherClick)
        }

        // ── Speed + duty: pinned to the rim, not stacked under the clock ──
        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(offset.x, offset.y)
                .fillMaxWidth()
                .padding(start = 32.dp, end = 32.dp, top = HERO_TOP_INSET)
                .graphicsLayer {
                    val f = readoutFocus()
                    alpha = fadeOut(f)
                    // Values retreat into the arcs they belong to: speed/duty up to the top
                    // rim, battery down to the bottom one.
                    translationY = -f * HERO_FOCUS_RISE.toPx()
                    scaleX = 1f - HERO_FOCUS_SHRINK * f
                    scaleY = scaleX
                },
            verticalAlignment = Alignment.Bottom,
        ) {
            // Ambient keeps the slots, the sizes and the units, and only drains the colour, so
            // waking lights the numbers where they already were instead of rebuilding the screen.
            LargeGaugeValue(Modifier.weight(1f), heroValue(frame.speed, ambientBlind), "km/h", speedColor)
            LargeGaugeValue(Modifier.weight(1f), heroValue(frame.duty, ambientBlind), "%", dutyColor)
        }

        // ── Bottom: battery % above the bottom gauge ──
        Text(
            // Same size as the curved temp values so the three secondary readouts match.
            text = if (ambientBlind) DASH else frame.battery?.let { "${format(it, 0)}%" } ?: DASH,
            style = MaterialTheme.typography.title3.copy(fontSize = TEMP_FONT_SIZE),
            color = battColor,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .offset(offset.x, offset.y)
                .padding(bottom = 16.dp)
                .graphicsLayer {
                    val f = readoutFocus()
                    alpha = fadeOut(f)
                    translationY = f * BATTERY_FOCUS_DROP.toPx()
                },
        )
    }
}

/**
 * What the nav focus page shows when the phone is not navigating: a centred, dim two-liner that
 * fades in as the readouts leave. Alpha is read inside the graphics layer so the drag never
 * recomposes.
 */
@Composable
private fun NavAbsentHint(focus: () -> Float, stackAlpha: () -> Float) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp)
            .graphicsLayer { alpha = fadeIn(focus()) * stackAlpha() },
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
    glowStrength: Float = STRONG_GLOW,
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

private fun temp(value: Double?, blind: Boolean = false): String =
    if (blind) DASH else value?.let { "${format(it, 0)}°" } ?: DASH

private fun heroValue(value: Double?, blind: Boolean): String =
    if (blind) DASH else value?.let { format(it, 0) } ?: DASH

private fun batteryColor(value: Double?): Color = when {
    value == null -> SecondaryText
    value < BATTERY_WARNING_PERCENT -> WarningColor
    else -> BatteryColor
}

private const val BATTERY_WARNING_PERCENT = 20.0

/**
 * A lane's colour. Ambient only tints as a [readout] what it actually has: an absent or frozen lane
 * is a [skeleton] there, so a missing reading never renders brighter than a real one.
 */
private fun laneColor(ambient: AmbientMode, value: Double?, muted: Boolean, color: Color): Color =
    if (muted || value == null) ambient.skeleton(DimText) else ambient.readout(color)

// Top rim gauges: 90° quarter-circles, small gap at top center. Battery: shallow bottom arc.
private const val TOP_GAP = 2f
private const val QUARTER_SWEEP = 90f - TOP_GAP
private const val BATTERY_SWEEP = 100f

/** Distance from the layout edge to the gauge circle every rim arc is drawn on. */
internal val GAUGE_RIM_INSET = 3.dp

/**
 * Distance from the layout edge to the inner circle a centre page may use. Everything outside it
 * belongs to the pinned rim arcs, so a page that ignores this insets its content into them.
 */
internal val GAUGE_INNER_INSET = 14.dp

private const val SPEED_MAX = 50.0

private const val TEMP_MIN = 10.0
private const val TEMP_MAX = 80.0
private const val TEMP_SWEEP = 32f
private const val MOTOR_ARC_START = 144f
private const val CTRL_ARC_START = 36f

/** Telemetry readouts clear out ahead of the drag, so nav is alone well before the page settles. */
internal fun fadeOut(focus: Float): Float = (1f - focus * FOCUS_FADE_RATE).coerceIn(0f, 1f)

internal const val FOCUS_FADE_RATE = 1.8f

/** Gradient fill strength on the gauges page; every arc scales its glow off this. */
private const val STRONG_GLOW = 0.38f

/** How far the wedge fills recede once a page has taken focus. Rim lines are left alone. */
internal fun dimGlow(focus: Float): Float = 1f - focus.coerceIn(0f, 1f) * GLOW_FOCUS_DIM

private const val GLOW_FOCUS_DIM = 0.55f

/** The no-nav hint arrives only after the readouts are gone, so the two never overlap. */
private fun fadeIn(focus: Float): Float =
    ((focus - HINT_FADE_ONSET) / (1f - HINT_FADE_ONSET)).coerceIn(0f, 1f)

private const val HINT_FADE_ONSET = 0.6f
private val HINT_FONT_SIZE = 11.sp
private val HINT_ICON_SIZE = 22.dp

/** Heroes sit on a fixed rim offset; the clock/forecast stack floats above them independently. */
private val HERO_TOP_INSET = 56.dp
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
