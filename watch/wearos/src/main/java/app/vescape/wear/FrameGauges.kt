package app.vescape.wear

import expo.modules.vescapecore.telemetry.UnitPresentation

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.AnchorType
import androidx.wear.compose.foundation.CurvedAlignment
import androidx.wear.compose.foundation.CurvedDirection
import androidx.wear.compose.foundation.CurvedLayout
import androidx.wear.compose.foundation.CurvedTextStyle
import androidx.wear.compose.foundation.curvedColumn
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.curvedText
import kotlin.math.cos
import kotlin.math.sin

/**
 * @parity /watch/watchos/FrameLayout.swift `FrameLayout`
 * @parity /watch/watchos/RimGauge.swift
 * @parity /modules/vescape-core/ios/watch/WatchGauge.swift
 */
@Composable
internal fun FrameLayout(
    frame: WatchFrame,
    muted: Boolean,
    focus: () -> Float = { 0f },
    controlFocus: () -> Float = { 0f },
    weatherFocus: () -> Float = { 0f },
    groupFocus: () -> Float = { 0f },
    onWeatherClick: (() -> Unit)? = null,
    ambient: AmbientMode = AmbientOff,
    showReadouts: Boolean = true,
) {
    val ambientBlind = ambient.active && muted
    val speedColor = ambient.skeleton(if (muted || frame.speed == null) DimText else SpeedColor)
    val dutyColor = ambient.skeleton(if (muted || frame.duty == null) DimText else DutyColor)
    val battColor = when {
        muted || frame.battery == null -> ambient.skeleton(DimText)
        ambient.active && !ambient.lowBit && frame.battery < BATTERY_WARNING_PERCENT -> WarningColor
        else -> ambient.readout(batteryColor(frame.battery))
    }
    val motorColor = laneColor(ambient, frame.motorTemp, muted, MotorTempColor)
    val ctrlColor = laneColor(ambient, frame.ctrlTemp, muted, CtrlTempColor)
    val offset = ambient.burnInOffset()

    val readoutFocus = { maxOf(focus(), controlFocus(), weatherFocus()) }
    WatchMapScene(
        frame = frame, muted = muted, ambient = ambient,
        focus = focus, awayFocus = { maxOf(controlFocus(), weatherFocus(), groupFocus()) },
        readoutFocus = readoutFocus,
        gauges = {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val radius = size.minDimension / 2f - GAUGE_RIM_INSET.toPx()
                val center = Offset(size.width / 2f, size.height / 2f)
                val speedFrac = if (ambientBlind) 0f else ((frame.speed ?: 0.0) / SPEED_MAX).toFloat().coerceIn(0f, 1f)
                val dutyFrac = if (ambientBlind) 0f else ((frame.duty ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
                val battFrac = if (ambientBlind) 0f else ((frame.battery ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)
                val motorFrac = if (ambientBlind) 0f else tempFraction(frame.motorTemp)
                val ctrlFrac = if (ambientBlind) 0f else tempFraction(frame.ctrlTemp)
                val glowDim = ambient.glow(dimGlow(readoutFocus()))
                val motorGlow = (0.08f + 0.40f * motorFrac) * glowDim
                val ctrlGlow = (0.08f + 0.40f * ctrlFrac) * glowDim
                val battGlow = (0.06f + 0.20f * battFrac) * glowDim

                drawGauge(center, radius, 180f, QUARTER_SWEEP, speedFrac, speedColor, style = StrongGaugeStyle, glowStrength = STRONG_GLOW * glowDim)
                drawGauge(center, radius, 360f, -QUARTER_SWEEP, dutyFrac, dutyColor, style = StrongGaugeStyle, glowStrength = STRONG_GLOW * glowDim)
                drawGauge(center, radius, 140f, -BATTERY_SWEEP, battFrac, battColor, style = SoftGaugeStyle, drawHead = false, glowStrength = battGlow)
                drawGauge(center, radius, MOTOR_ARC_START, TEMP_SWEEP, motorFrac, motorColor, style = SoftGaugeStyle, drawHead = false, glowStrength = motorGlow)
                drawGauge(center, radius, CTRL_ARC_START, -TEMP_SWEEP, ctrlFrac, ctrlColor, style = SoftGaugeStyle, drawHead = false, glowStrength = ctrlGlow)
            }
        },
        readouts = {
            if (showReadouts) {
                CurvedTemp(MOTOR_ARC_START + TEMP_SWEEP / 2, temp(frame.motorTemp, ambientBlind), "MOTOR", motorColor, readoutFocus)
                CurvedTemp(CTRL_ARC_START - TEMP_SWEEP / 2, temp(frame.ctrlTemp, ambientBlind), "CTRL", ctrlColor, readoutFocus)
            }

            Column(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .offset(offset.x, offset.y)
                    .padding(top = 8.dp)
                    .graphicsLayer { alpha = fadeOut(readoutFocus()) },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                WatchClock(color = ambient.readout(if (muted) DimText else SecondaryText))
                WeatherReadout(muted = muted || ambient.active, onClick = onWeatherClick)
            }

            if (showReadouts) Row(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .offset(offset.x, offset.y)
                    .fillMaxWidth()
                    .padding(start = 32.dp, end = 32.dp, top = HERO_TOP_INSET)
                    .graphicsLayer {
                        val f = readoutFocus()
                        alpha = fadeOut(f)
                        translationY = -f * HERO_FOCUS_RISE.toPx()
                        scaleX = 1f - HERO_FOCUS_SHRINK * f
                        scaleY = scaleX
                    },
                verticalAlignment = Alignment.Bottom,
            ) {
                LargeGaugeValue(Modifier.weight(1f), if (muted) "Stale Speed" else "Speed", heroValue(frame.speed?.let { UnitPresentation.speedFromKmh(it, SettingsState.settings.value.distanceUnit) }, ambientBlind), UnitPresentation.speedUnit(SettingsState.settings.value.distanceUnit), speedColor)
                LargeGaugeValue(Modifier.weight(1f), if (muted) "Stale Duty" else "Duty", heroValue(frame.duty, ambientBlind), "%", dutyColor)
            }

            if (showReadouts) Text(
                text = if (ambientBlind) DASH else frame.battery?.let(::batteryPercent) ?: DASH,
                style = WatchTypography.mono(MaterialTheme.typography.title3.copy(fontSize = TEMP_FONT_SIZE)),
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
        },
    )
}

@Composable
private fun CurvedTemp(anchorDeg: Float, value: String, label: String, color: Color, focus: () -> Float) {
    CurvedLayout(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                val f = focus()
                alpha = fadeOut(f)
                scaleX = 1f + TEMP_FOCUS_SPREAD * f
                scaleY = scaleX
            }
            .padding(TEMP_LABEL_GAP),
        anchor = anchorDeg,
        anchorType = AnchorType.Center,
        angularDirection = CurvedDirection.Angular.CounterClockwise,
    ) {
        curvedColumn(
            radialDirection = CurvedDirection.Radial.OutsideIn,
            angularAlignment = CurvedAlignment.Angular.Center,
        ) {
            curvedText(
                text = value,
                color = color,
                style = WatchTypography.curvedMono(CurvedTextStyle(fontSize = TEMP_FONT_SIZE)),
            )
            curvedText(
                text = label,
                color = SecondaryText,
                style = WatchTypography.curvedUi(CurvedTextStyle(fontSize = TEMP_LABEL_FONT_SIZE)),
            )
        }
    }
}

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

    drawArc(GuideColor, startDeg, sweepDeg, false, topLeft, arcSize, style = guide)

    val sweptDeg = sweepDeg * fraction
    if (fraction > 0f) {
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

        drawArc(color, startDeg, sweptDeg, false, topLeft, arcSize, style = head)
    }

    if (drawHead) {
        val tipRad = Math.toRadians((startDeg + sweptDeg).toDouble())
        val inner = radius - radius * style.headLenRatio
        val outer = radius + style.headWidth.toPx() / 2f
        val p1 = Offset(center.x + (inner * cos(tipRad)).toFloat(), center.y + (inner * sin(tipRad)).toFloat())
        val p2 = Offset(center.x + (outer * cos(tipRad)).toFloat(), center.y + (outer * sin(tipRad)).toFloat())
        drawLine(color, p1, p2, strokeWidth = style.headWidth.toPx(), cap = StrokeCap.Butt)
    }
}

@Composable
private fun LargeGaugeValue(modifier: Modifier, label: String, value: String, unit: String, color: Color) {
    Column(modifier = modifier.clearAndSetSemantics { contentDescription = "$label $value $unit" }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, style = WatchTypography.mono(MaterialTheme.typography.display1), color = color)
        Text(text = unit, style = WatchTypography.mono(MaterialTheme.typography.caption3), color = SecondaryText)
    }
}

private fun format(value: Double, decimals: Int): String = String.format("%.${decimals}f", value)

private fun temp(value: Double?, blind: Boolean = false): String =
    if (blind) DASH else value?.let { "${format(it, 0)}°" } ?: DASH

private fun heroValue(value: Double?, blind: Boolean): String =
    if (blind) DASH else value?.let { format(it, 0) } ?: DASH

/** @parity /modules/vescape-core/ios/watch/WatchGauge.swift `batteryPercent` */
internal fun batteryPercent(value: Double): String = "${format(value, 0)}%"

internal fun batteryColor(value: Double?): Color = when {
    value == null -> SecondaryText
    value < BATTERY_WARNING_PERCENT -> WarningColor
    else -> BatteryColor
}

/** @parity /modules/vescape-core/ios/watch/WatchGauge.swift `batteryWarningPercent` */
internal const val BATTERY_WARNING_PERCENT = 20.0

private fun laneColor(ambient: AmbientMode, value: Double?, muted: Boolean, color: Color): Color =
    if (muted || value == null) ambient.skeleton(DimText) else ambient.readout(color)

private const val TOP_GAP = 2f
private const val QUARTER_SWEEP = 90f - TOP_GAP
private const val BATTERY_SWEEP = 100f

internal val GAUGE_RIM_INSET = 3.dp

internal val GAUGE_INNER_INSET = 14.dp

private const val SPEED_MAX = 50.0

/** @parity /src/modules/board/constants/telemetry.ts `RIM_TEMP_RANGE` */
private const val TEMP_MIN = 20.0
private const val TEMP_MAX = 100.0
private const val TEMP_SWEEP = 32f
private const val MOTOR_ARC_START = 144f
private const val CTRL_ARC_START = 36f

internal fun fadeOut(focus: Float): Float = (1f - focus * FOCUS_FADE_RATE).coerceIn(0f, 1f)

internal const val FOCUS_FADE_RATE = 1.8f

private const val STRONG_GLOW = 0.38f

internal fun dimGlow(focus: Float): Float = 1f - focus.coerceIn(0f, 1f) * GLOW_FOCUS_DIM

private const val GLOW_FOCUS_DIM = 0.55f

private val HERO_TOP_INSET = 56.dp
/** @parity /watch/watchos/FrameLayout.swift `HERO_FOCUS_RISE` */
private val HERO_FOCUS_RISE = 30.dp
/** @parity /watch/watchos/FrameLayout.swift `HERO_FOCUS_SHRINK` */
private const val HERO_FOCUS_SHRINK = 0.12f
/** @parity /watch/watchos/FrameLayout.swift `BATTERY_FOCUS_DROP` */
private val BATTERY_FOCUS_DROP = 18.dp
/** @parity /watch/watchos/FrameLayout.swift `TEMP_FOCUS_SPREAD` */
private const val TEMP_FOCUS_SPREAD = 0.06f

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
